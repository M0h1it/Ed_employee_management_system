"""
app/api/v1/face.py

Two audiences, two auth models, one file because they share the matching
concepts:

  ADMIN ENROLMENT   — POST /employees/{id}/face      (user token, face.enrol)
  KIOSK PUNCH+MATCH — POST /kiosk/punch               (device code, no user)

EMBEDDINGS ONLY. NEVER THE PHOTOGRAPH.
-----------------------------------------
The source image is used in-memory to produce a 512-float embedding, then
discarded. Nothing here writes an uploaded or captured frame to disk except
the one confirmation photo kept per successful punch (photo_ref on
PunchEvent), which is the row the retention-cleanup job (Phase 3, item 9)
is responsible for deleting after the retention window. This file does not
implement that job — it only ever WRITES that one photo, never reads or
prunes the backlog.
"""

from datetime import datetime, timezone
from pathlib import Path
import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_device, requires
from app.core.audit import record_audit
from app.core.db import get_session
from app.core.security import verify_password
from app.domain.attendance_rules import PunchDirection, PunchSource, build_idempotency_key, is_currently_in
from app.domain.attendance_rules import Punch as DomainPunch
from app.models import Device, Employee, FaceTemplate, PunchEvent, User
from app.schemas.common import Single
from app.schemas.face import EnrolResult, KioskOutcome, KioskPunchResult, PinPunchRequest, PinPunchResult
from app.services import face_engine

router = APIRouter(tags=["face", "kiosk"])

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 5 * 1024 * 1024   # 5 MB — a phone photo before compression, not a raw dump
MAX_TEMPLATES_PER_EMPLOYEE = 5

MATCH_THRESHOLD = 0.85
UNSURE_THRESHOLD = 0.70
AUTO_ENROL_THRESHOLD = 0.92

# Separate directory from photos.py's UPLOAD_DIR (employee profile photos),
# despite an identical on-disk pattern, because the two have completely
# different retention rules: a profile photo lives indefinitely; a punch
# confirmation photo is deleted after PUNCH_PHOTO_RETENTION_DAYS (see the
# cleanup job, scripts/cleanup_punch_photos.py) — 90 days per
# PHASE-3-BRIEF.md's consent section. Keeping them in separate directories
# means the cleanup job can walk one folder without needing to distinguish
# file provenance from the filename alone.
PUNCH_PHOTO_DIR = Path("uploads/punch_photos")
PUNCH_PHOTO_DIR.mkdir(parents=True, exist_ok=True)
PUNCH_PHOTO_RETENTION_DAYS = 90

QUALITY_MESSAGES = {
    "UNREADABLE_IMAGE": "That file could not be read as an image.",
    "NO_FACE_FOUND": "No face was found in this photo.",
    "MULTIPLE_FACES": "More than one face was found in this photo. Use a photo of one person only.",
    "FACE_TOO_SMALL": "The face is too small in this photo. Move closer or crop tighter.",
    "LOW_QUALITY": "This photo is too unclear to enrol. Try better lighting and a straight-on angle.",
}


async def _read_capped(file: UploadFile, cap: int) -> bytes:
    data = await file.read(cap + 1)
    if len(data) > cap:
        raise HTTPException(422, detail={"error": {
            "code": "FILE_TOO_LARGE", "message": "That image is too large."}})
    if not data:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Please provide an image."}})
    return data


# ---------------------------------------------------------------------------
# Admin enrolment
# ---------------------------------------------------------------------------

@router.post("/employees/{employee_id}/face", response_model=Single[EnrolResult], status_code=201)
async def enrol_face(
    employee_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    actor: Actor = Depends(requires("face.enrol")),
    session: AsyncSession = Depends(get_session),
):
    """
    Admin uploads one photo. Reuses the same quality gate that guards
    auto-enrolment later, so a photo that would never pass on its own never
    gets in through the front door either.

    On success this becomes the employee's FIRST template if they have none,
    or is ADDED if they already have some — capped at 5 total, oldest first
    out, same rule the auto-enrolment path (kiosk punch handler, below)
    follows for consistency.
    """
    employee = (await session.execute(
        select(Employee).where(Employee.id == employee_id))).scalar_one_or_none()
    if employee is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Employee not found."}})

    data = await _read_capped(file, MAX_UPLOAD_BYTES)

    result = face_engine.analyze_single_face(data)
    if not result.ok:
        raise HTTPException(422, detail={"error": {
            "code": result.reason,
            "message": QUALITY_MESSAGES.get(result.reason, "This photo could not be used."),
            "fields": {"file": QUALITY_MESSAGES.get(result.reason, "Try a different photo")},
        }})

    # `data` and the decoded frame go out of scope after this function
    # returns; nothing here persists the photo bytes anywhere.
    await _add_template(
        session, employee_id=employee_id, embedding=result.face.embedding,
        quality_score=result.face.quality_score,
    )

    await record_audit(
        session, actor_user_id=actor.user_id, action="face.enrol",
        entity="employee", entity_id=employee.id, request=request,
        after={"qualityScore": result.face.quality_score, "source": "admin_upload"},
    )
    await session.commit()

    count = await _template_count(session, employee_id)
    return Single(data=EnrolResult(
        employeeId=employee_id, templateCount=count, qualityScore=result.face.quality_score,
    ))


async def _template_count(session: AsyncSession, employee_id: UUID) -> int:
    rows = (await session.execute(
        select(FaceTemplate.id).where(
            FaceTemplate.employee_id == employee_id, FaceTemplate.is_active.is_(True)
        ))).scalars().all()
    return len(rows)


async def _add_template(
    session: AsyncSession, *, employee_id: UUID, embedding: list[float], quality_score: float,
) -> None:
    """
    Inserts a template, then trims to MAX_TEMPLATES_PER_EMPLOYEE by deleting
    the OLDEST active rows if the cap is exceeded — "oldest dropped" per the
    brief. Runs in the caller's transaction; the caller commits.
    """
    session.add(FaceTemplate(
        employee_id=employee_id, embedding=embedding, quality_score=quality_score, is_active=True,
    ))
    await session.flush()

    existing = (await session.execute(
        select(FaceTemplate)
        .where(FaceTemplate.employee_id == employee_id, FaceTemplate.is_active.is_(True))
        .order_by(FaceTemplate.created_at.asc())
    )).scalars().all()

    overflow = len(existing) - MAX_TEMPLATES_PER_EMPLOYEE
    for old in existing[:max(0, overflow)]:
        await session.delete(old)


# ---------------------------------------------------------------------------
# Kiosk: face punch
# ---------------------------------------------------------------------------

async def _best_match(session: AsyncSession, embedding: list[float]) -> tuple[Employee | None, float]:
    """
    Nearest template by cosine similarity, using pgvector's <=> operator
    (cosine DISTANCE, so similarity = 1 - distance) against the ivfflat index
    on face_templates.embedding — the index this table was built with from
    the start, per the Phase 2 brief.

    Returns (employee, similarity) for the closest active template's owner,
    or (None, 0.0) if there are no active templates at all.
    """
    from pgvector.sqlalchemy import Vector
    from sqlalchemy import cast, literal

    vec = cast(embedding, Vector(face_engine.EMBEDDING_DIM))
    stmt = (
        select(FaceTemplate, (1 - FaceTemplate.embedding.cosine_distance(vec)).label("similarity"))
        .where(FaceTemplate.is_active.is_(True))
        .order_by(FaceTemplate.embedding.cosine_distance(vec))
        .limit(1)
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        return None, 0.0

    template, similarity = row
    employee = (await session.execute(
        select(Employee).where(Employee.id == template.employee_id))).scalar_one_or_none()
    return employee, float(similarity)


def _save_punch_photo(frame_bytes: bytes) -> str | None:
    """
    Writes the one frame used for matching to disk and returns its
    photo_ref path — mirrors photos.py's upload pattern (random filename,
    magic-byte-free since this is always a JPEG straight from the capture
    pipeline, not a user-controlled upload). This is the ONLY place a
    captured frame is ever persisted; every other frame from a punch
    attempt (the other 2 of the kiosk's 3-frame capture, and every frame
    from a failed/UNSURE attempt) is used in memory and discarded, exactly
    as this file's own header comment describes.

    Returns None on a write failure (disk full, permissions) rather than
    raising — a punch that succeeded but has no photo on disk is a smaller
    problem than rejecting a real attendance event because a confirmation
    photo could not be written. Callers must handle the None case; it is
    not an exceptional path to ignore.
    """
    filename = f"{uuid4().hex}.jpg"
    try:
        (PUNCH_PHOTO_DIR / filename).write_bytes(frame_bytes)
    except OSError:
        return None
    return f"/uploads/punch_photos/{filename}"


async def _write_punch(
    session: AsyncSession, *, employee: Employee, device: Device, ts: datetime,
    device_ts: datetime | None, confidence: float | None, source: PunchSource,
    photo_ref: str | None,
) -> tuple[PunchEvent, PunchDirection, bool]:
    """
    Shared by the face path and the PIN path. Returns (punch, direction,
    was_duplicate) — was_duplicate=True means the row already existed and
    nothing new was written, which the kiosk (and its offline replay queue)
    must treat as success, not an error, exactly like the manual-punch
    endpoint's 409-is-fine rule.
    """
    recent = (await session.execute(
        select(PunchEvent)
        .where(PunchEvent.employee_id == employee.id)
        .order_by(PunchEvent.ts.desc())
        .limit(20)
    )).scalars().all()

    domain_punches = [DomainPunch(ts=p.ts, direction=PunchDirection(p.direction.value)) for p in recent]
    direction = PunchDirection.OUT if is_currently_in(domain_punches) else PunchDirection.IN

    key = build_idempotency_key(str(employee.id), ts, direction)
    existing = (await session.execute(
        select(PunchEvent).where(PunchEvent.idempotency_key == key))).scalar_one_or_none()
    if existing:
        return existing, direction, True

    punch = PunchEvent(
        employee_id=employee.id, ts=ts, direction=direction.value, device_id=device.id,
        source=source.value, confidence=confidence, photo_ref=photo_ref,
        idempotency_key=key, device_ts=device_ts,
    )
    session.add(punch)
    await session.flush()
    return punch, direction, False


@router.post("/kiosk/punch", response_model=Single[KioskPunchResult])
async def kiosk_punch(
    request: Request,
    frames: list[UploadFile] = File(...),
    device_ts: str | None = Form(default=None),
    confirm_employee_id: str | None = Form(default=None),
    device: Device = Depends(get_current_device),
    session: AsyncSession = Depends(get_session),
):
    """
    The core kiosk state-machine endpoint: liveness -> embedding -> nearest
    template -> direction from last punch -> write.

    device_ts is a multipart FORM field, not a query parameter — it travels
    in the same FormData/multipart body as frames, so a client builds one
    request object for this call instead of splitting it between a URL and
    a body. Nothing here treats device_ts as security-sensitive (it's just
    the tablet's own clock, see the migration note on punch_events.device_ts
    for why it's advisory only), so unlike PinPunchRequest this is a small
    ergonomics fix, not a leak fix.

    Deliberately returns 200 with an `outcome` field for every non-match
    case (UNSURE, NO_MATCH, LIVENESS_FAILED) rather than a 4xx — these are
    all things the kiosk UI needs to render a specific next screen for, not
    error conditions. A genuine error (bad device auth, unreadable request)
    is the only thing that raises.

    confirm_employee_id IS HOW THE KIOSK'S "Are you X? [Yes]" ANSWERS
    ----------------------------------------------------------------------
    Set when the person tapped Yes on the UNSURE screen. Re-sending the
    SAME captured frames on "Yes" (rather than re-running the whole capture
    sequence) means the embedding — and therefore the similarity score —
    is IDENTICAL to what just produced UNSURE. Without this parameter,
    "Yes" would recompute the exact same sub-threshold similarity every
    time and loop back into UNSURE forever, which is a real bug this
    parameter fixes, not a hypothetical one.

    A confirmed id is only honoured if it matches the CURRENT request's own
    best-match employee, and that match is still at least UNSURE_THRESHOLD
    — it lowers the bar from MATCH_THRESHOLD (0.85) down to
    UNSURE_THRESHOLD (0.70) for a specific, already-shown candidate, it
    does not let a client assert an arbitrary employee id with no
    supporting similarity at all. The employee already had to be the
    best-guess match with a real, if borderline, score before their own
    "Yes" can push it over the line.
    """
    if len(frames) < 2:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "At least two frames are required."}})

    frame_bytes = [await _read_capped(f, MAX_UPLOAD_BYTES) for f in frames]

    if not face_engine.check_liveness(frame_bytes):
        return Single(data=KioskPunchResult(
            outcome=KioskOutcome.liveness_failed,
            message="Please look directly at the camera.",
        ))

    # Match against the middle frame — sharpest average case with a 3-frame
    # capture (the first is often mid-motion from raising the tablet's gaze,
    # the last from turning away toward the greeting).
    analysis = face_engine.analyze_single_face(frame_bytes[len(frame_bytes) // 2])
    if not analysis.ok:
        logger.info("kiosk_punch: no_match — quality check failed (%s), device=%s",
                     analysis.reason, device.id)
        return Single(data=KioskPunchResult(
            outcome=KioskOutcome.no_match,
            message="No face could be matched. Try again, or use your PIN.",
        ))

    employee, similarity = await _best_match(session, analysis.face.embedding)

    if employee is None or similarity < UNSURE_THRESHOLD:
        # This is the ONLY place a failed match's actual similarity score
        # is recorded anywhere — record_audit only fires on a successful
        # MATCH (see the call near the end of this function), so without
        # this line there is no way to tell "the closest template was 0.02
        # away" (a real bug worth chasing) from "the closest template was
        # 0.55 away" (working as intended, just not a match) after the
        # fact. INFO level, not audit: this is diagnostic noise for
        # operators, not an event about a person that belongs in the
        # tamper-evident audit trail.
        embedding_debug = analysis.face.embedding
        logger.info("kiosk_punch: no_match — best similarity=%.3f (threshold=%.2f), "
                     "closest_employee=%s, device=%s, query_embedding_len=%s, "
                     "query_embedding_type=%s, query_embedding_sample=%s",
                     similarity, UNSURE_THRESHOLD,
                     employee.id if employee else None, device.id,
                     len(embedding_debug) if embedding_debug is not None else None,
                     type(embedding_debug).__name__,
                     embedding_debug[:5] if embedding_debug else None)
        return Single(data=KioskPunchResult(
            outcome=KioskOutcome.no_match, confidence=similarity,
            message="No match found. Try again, or use your PIN.",
        ))

    if similarity < MATCH_THRESHOLD:
        # A prior "Yes" on THIS SAME employee, at THIS SAME (already
        # UNSURE-qualifying) similarity, promotes the match rather than
        # returning UNSURE again — see this function's own docstring for
        # why re-running the check unconditionally here would loop forever.
        confirmed = confirm_employee_id is not None and confirm_employee_id == str(employee.id)
        if not confirmed:
            logger.info("kiosk_punch: unsure — similarity=%.3f (match_threshold=%.2f), "
                         "employee=%s, device=%s",
                         similarity, MATCH_THRESHOLD, employee.id, device.id)
            return Single(data=KioskPunchResult(
                outcome=KioskOutcome.unsure, employeeId=employee.id, employeeName=employee.name,
                photoUrl=employee.photo_url, confidence=similarity,
                message=f"Are you {employee.name}?",
            ))
        logger.info("kiosk_punch: confirmed by employee — similarity=%.3f promoted to match, "
                     "employee=%s, device=%s", similarity, employee.id, device.id)

    now = datetime.now(timezone.utc)
    parsed_device_ts = _parse_device_ts(device_ts)

    # The same frame already analysed above (the middle of the 3 captured)
    # becomes the punch's confirmation photo — no extra frame is chosen or
    # re-read, and every other frame from this attempt is never written to
    # disk (see _save_punch_photo's own docstring).
    punch_photo_ref = _save_punch_photo(frame_bytes[len(frame_bytes) // 2])

    punch, direction, _dup = await _write_punch(
        session, employee=employee, device=device, ts=now, device_ts=parsed_device_ts,
        confidence=similarity, source=PunchSource.kiosk, photo_ref=punch_photo_ref,
    )

    # Auto-enrolment: a high-confidence live punch frame becomes a new
    # template, so accuracy improves across lighting and days without anyone
    # being called in for a photo session. Quality-gated the same as any
    # other enrolment — a lucky high-similarity match on a poor-quality frame
    # still has to pass analyze_single_face's own checks below, which it
    # already did to get this far (`analysis.ok` above), so this reuses that
    # same successful detection rather than re-running it.
    if similarity >= AUTO_ENROL_THRESHOLD:
        await _add_template(
            session, employee_id=employee.id, embedding=analysis.face.embedding,
            quality_score=analysis.face.quality_score,
        )

    await record_audit(
        session, actor_user_id=None, action="punch.kiosk_face",
        entity="punch", entity_id=punch.id, request=request,
        after={"employee": employee.name, "direction": direction.value,
               "confidence": similarity, "deviceId": str(device.id), "deviceName": device.name},
    )
    await session.commit()

    greeting = "Good morning" if direction == PunchDirection.IN else "Good evening"
    closing = f"Checked in at {now.strftime('%I:%M %p')}" if direction == PunchDirection.IN \
        else "See you tomorrow"

    return Single(data=KioskPunchResult(
        outcome=KioskOutcome.match, employeeId=employee.id, employeeName=employee.name,
        photoUrl=employee.photo_url, direction=direction.value, confidence=similarity,
        punchedAt=now, message=f"{greeting}, {employee.name}. {closing}",
    ))


def _parse_device_ts(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Kiosk: PIN fallback
# ---------------------------------------------------------------------------

@router.get("/kiosk/whoami")
async def kiosk_whoami(device: Device = Depends(get_current_device)):
    """
    A cheap, side-effect-free way for the kiosk app to answer "is my stored
    device code still valid" — used by the setup screen right after a code
    is entered (immediate feedback on a typo, rather than the admin only
    finding out when the first real punch fails), and safe to call as a
    periodic health-check too, since it does nothing but authenticate.

    Deliberately not named /kiosk/ping or /kiosk/health: this returns which
    device the code belongs to, which a generic health-check name would not
    suggest, and get_current_device already updates last_seen_at as a side
    effect of being called at all — exactly the same "was this tablet
    actually heard from" signal DevicesPanel.tsx shows in the admin list.
    """
    return {"data": {"deviceId": str(device.id), "deviceName": device.name}}


@router.post("/kiosk/pin-punch", response_model=Single[PinPunchResult])
async def kiosk_pin_punch(
    body: PinPunchRequest,
    request: Request,
    device: Device = Depends(get_current_device),
    session: AsyncSession = Depends(get_session),
):
    """
    The fallback for: declined enrolment, two failed match attempts, or
    the device is offline (in which case the kiosk queues this call locally
    and replays it — which is exactly why _write_punch's duplicate check
    matters here as much as it does on the face path).

    Identified by EMPLOYEE CODE (e.g. "EMP-0042"), not username or employee
    id. This was username in an earlier version of this endpoint; it changed
    because pin_hash carries no UNIQUE constraint (see the users table) — a
    PIN alone can collide between two people, since it's a random 6-digit
    value from a 1,000,000-value space, not something anyone chose. Looking
    someone up by PIN alone would silently punch in whichever employee that
    PIN happened to also belong to. Employee code is already UNIQUE
    (app/models/employee.py) and is short enough to type on a kiosk's
    numeric-biased input, unlike a login username which was designed for a
    keyboard, not a tablet standing on a wall.

    body/pin arrive as a JSON body (PinPunchRequest), not query parameters —
    a PIN belongs in a body for the same reason a password does: query
    strings are what get written into access logs.
    """
    employee = (await session.execute(
        select(Employee).where(Employee.emp_code == body.employeeCode)
    )).scalar_one_or_none()

    # Same message regardless of which part was wrong — confirming an
    # employee code exists to an unauthenticated kiosk caller is exactly the
    # enumeration leak the login endpoint already avoids for usernames, and
    # an employee code is arguably easier to guess than a username, so this
    # matters at least as much here.
    invalid = HTTPException(401, detail={"error": {
        "code": "INVALID_PIN", "message": "That employee code or PIN was not recognised."}})

    if employee is None:
        raise invalid

    user = (await session.execute(
        select(User).where(User.employee_id == employee.id, User.is_active.is_(True))
    )).scalar_one_or_none()

    if user is None or not user.pin_hash or not verify_password(body.pin, user.pin_hash):
        raise invalid

    now = datetime.now(timezone.utc)
    punch, direction, _dup = await _write_punch(
        session, employee=employee, device=device, ts=now, device_ts=None,
        confidence=None, source=PunchSource.pin, photo_ref=None,
    )

    await record_audit(
        session, actor_user_id=user.id, action="punch.kiosk_pin",
        entity="punch", entity_id=punch.id, request=request,
        after={"employee": employee.name, "direction": direction.value,
               "deviceId": str(device.id), "deviceName": device.name},
    )
    await session.commit()

    message = "Checked in." if direction == PunchDirection.IN else "Checked out. See you tomorrow."
    return Single(data=PinPunchResult(
        employeeId=employee.id, employeeName=employee.name,
        direction=direction.value, punchedAt=now, message=message,
    ))