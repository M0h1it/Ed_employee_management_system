"""
app/api/v1/corrections.py

Fixing a mistaken or missing punch — without editing the punch.

THE ONE RULE THIS FILE EXISTS TO PROTECT
-----------------------------------------
punch_events is append-only. The first time somebody disputes their hours, that
table is the evidence; if rows can be rewritten there is no evidence, only a
record saying whatever the last person to touch it wanted.

So a correction is a separate row: approved, attributed, dated, and layered on
top. Expanding a day still shows the original punches underneath. That is the
difference between "the kiosk recorded 09:47, corrected to 09:05 by Marcus on
the 14th because the reader failed" and "it says 09:05".
"""

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor, requires
from app.core.audit import record_audit
from app.core.db import get_session
from app.core.timeutil import local_now, local_today, to_local
from app.domain.attendance_rules import (
    Punch,
    PunchDirection,
    PunchSource,
    ShiftRule,
    build_day,
)
from app.models import Correction, Employee, PunchEvent, Shift, User
from app.schemas.common import Paginated, Single, page_meta
from app.schemas.correction import CorrectionCreate, CorrectionDecision, CorrectionOut

router = APIRouter(tags=["corrections"])


async def _current_times(
    session: AsyncSession, employee_id: UUID, day: date
) -> tuple[datetime | None, datetime | None]:
    """What the register says right now, before any correction."""
    rows = (await session.execute(
        select(PunchEvent).where(
            PunchEvent.employee_id == employee_id,
            func.date(PunchEvent.ts) >= day - timedelta(days=1),
            func.date(PunchEvent.ts) <= day + timedelta(days=1),
        ))).scalars().all()

    punches = [
        Punch(ts=to_local(p.ts), direction=PunchDirection(p.direction.value),
              source=PunchSource(p.source.value))
        for p in rows if to_local(p.ts).date() == day
    ]
    if not punches:
        return None, None

    shift_row = (await session.execute(select(Shift).order_by(Shift.name))).scalars().first()
    from datetime import time as _time
    shift = ShiftRule(
        start_time=shift_row.start_time if shift_row else _time(9, 0),
        end_time=shift_row.end_time if shift_row else _time(18, 0),
        grace_minutes=shift_row.grace_minutes if shift_row else 15,
        min_hours=float(shift_row.min_hours) if shift_row else 8.0,
    )
    result = build_day(day=day, punches=punches, shift=shift, now=local_now())
    return result.first_in, result.last_out


def _to_out(
    correction: Correction,
    employee: Employee | None,
    requester: str,
    approver: str | None,
    current_in: datetime | None,
    current_out: datetime | None,
) -> CorrectionOut:
    return CorrectionOut(
        id=correction.id,
        employeeId=correction.employee_id,
        employeeName=employee.name if employee else "",
        employeePhotoUrl=employee.photo_url if employee else None,
        date=correction.date,
        reason=correction.reason,
        # Converted to local, same as currentIn and currentOut below.
        #
        # These were returned as raw UTC while the current times came back
        # local, so one row showed "current 09:17, proposed 03:00" for a
        # proposal of 08:30 — and an approver comparing them would have been
        # looking at a five-and-a-half hour difference that did not exist.
        proposedIn=to_local(correction.proposed_in) if correction.proposed_in else None,
        proposedOut=to_local(correction.proposed_out) if correction.proposed_out else None,
        currentIn=current_in,
        currentOut=current_out,
        status=correction.status,
        requestedBy=correction.requested_by,
        requestedByName=requester,
        approvedBy=correction.approved_by,
        approvedByName=approver,
        approvedAt=correction.approved_at,
        createdAt=correction.created_at,
    )


@router.get("/corrections", response_model=Paginated[CorrectionOut])
async def list_corrections(
    employeeId: str | None = None,
    correctionStatus: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=25, ge=1, le=100),
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    # Anyone may see their own; seeing everyone's needs the permission. Applied
    # to the filter, not checked afterwards.
    if actor.can("corrections.view_all"):
        scoped: UUID | None = None
        if employeeId and employeeId != "me":
            try:
                scoped = UUID(employeeId)
            except ValueError:
                raise HTTPException(422, detail={"error": {
                    "code": "VALIDATION_FAILED", "message": "employeeId is not a valid id."}})
        elif employeeId == "me":
            scoped = actor.employee_id
    else:
        scoped = actor.employee_id

    stmt = select(Correction)
    if scoped:
        stmt = stmt.where(Correction.employee_id == scoped)
    if correctionStatus:
        stmt = stmt.where(Correction.status == correctionStatus)

    total = (await session.execute(
        select(func.count()).select_from(stmt.subquery()))).scalar_one()

    stmt = (
        stmt.order_by((Correction.status != "pending"), Correction.date.desc())
        .offset((page - 1) * pageSize).limit(pageSize)
    )
    rows = (await session.execute(stmt)).scalars().all()

    employee_ids = {r.employee_id for r in rows}
    employees = {
        e.id: e for e in (await session.execute(
            select(Employee).where(Employee.id.in_(employee_ids)))).scalars()
    } if employee_ids else {}

    user_ids = {r.requested_by for r in rows if r.requested_by} | {
        r.approved_by for r in rows if r.approved_by}
    names = {
        u.id: (u.employee.name if u.employee else u.username)
        for u in (await session.execute(
            select(User).options(selectinload(User.employee)).where(User.id.in_(user_ids)))).scalars()
    } if user_ids else {}

    data = []
    for r in rows:
        current_in, current_out = await _current_times(session, r.employee_id, r.date)
        data.append(_to_out(
            r, employees.get(r.employee_id),
            names.get(r.requested_by, "Removed account"),
            names.get(r.approved_by) if r.approved_by else None,
            current_in, current_out,
        ))

    return Paginated(data=data, meta=page_meta(page=page, page_size=pageSize, total=total))


@router.post("/corrections", response_model=Single[CorrectionOut],
             status_code=status.HTTP_201_CREATED)
async def request_correction(
    body: CorrectionCreate,
    request: Request,
    actor: Actor = Depends(requires("corrections.request")),
    session: AsyncSession = Depends(get_session),
):
    employee_id = body.employeeId or actor.employee_id

    if employee_id != actor.employee_id and not actor.can("corrections.approve"):
        raise HTTPException(403, detail={"error": {
            "code": "FORBIDDEN", "message": "You can only request corrections for yourself."}})

    if body.date > local_today():
        # A day that has not happened has nothing to correct, and allowing it
        # would let somebody pre-write their own attendance.
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Please fix the highlighted fields.",
            "fields": {"date": "You cannot correct a day that has not happened yet"}}})

    employee = (await session.execute(
        select(Employee).where(Employee.id == employee_id))).scalar_one_or_none()
    if employee is None:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Please fix the highlighted fields.",
            "fields": {"employeeId": "Choose an employee"}}})

    # One pending or approved correction per person per day. Two approved
    # corrections for one day make the rollup ambiguous about which one wins.
    clash = (await session.execute(
        select(Correction).where(
            Correction.employee_id == employee_id,
            Correction.date == body.date,
            Correction.status.in_(["pending", "approved"]),
        ))).scalar_one_or_none()
    if clash:
        raise HTTPException(409, detail={"error": {
            "code": "EXISTING_CORRECTION",
            "message": f"There is already a {clash.status} correction for this day."}})

    correction = Correction(
        employee_id=employee_id,
        date=body.date,
        reason=body.reason.strip(),
        proposed_in=body.proposedIn,
        proposed_out=body.proposedOut,
        requested_by=actor.user_id,
        status="pending",
    )
    session.add(correction)
    await session.flush()

    await record_audit(
        session, actor_user_id=actor.user_id, action="correction.request",
        entity="correction", entity_id=correction.id, request=request,
        after={"employee": employee.name, "date": body.date, "reason": correction.reason,
               "proposedIn": body.proposedIn, "proposedOut": body.proposedOut},
    )
    await session.commit()
    await session.refresh(correction)

    current_in, current_out = await _current_times(session, employee_id, body.date)
    return Single(data=_to_out(
        correction, employee, actor.employee.name, None, current_in, current_out))


@router.patch("/corrections/{correction_id}", response_model=Single[CorrectionOut])
async def decide_correction(
    correction_id: UUID,
    body: CorrectionDecision,
    request: Request,
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    """
    Approve, reject, or withdraw.

    NOBODY APPROVES THEIR OWN CORRECTION — not even an owner. A person editing
    their own recorded hours with no second signature is the exact thing an
    append-only punch table was built to prevent, and routing it through a
    "correction" would put the hole back with extra steps.
    """
    correction = (await session.execute(
        select(Correction).where(Correction.id == correction_id))).scalar_one_or_none()
    if correction is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Correction not found."}})

    is_mine = correction.employee_id == actor.employee_id

    if body.status == "cancelled":
        if not is_mine and not actor.can("corrections.approve"):
            raise HTTPException(403, detail={"error": {
                "code": "FORBIDDEN", "message": "You can only withdraw your own request."}})
    else:
        if not actor.can("corrections.approve"):
            raise HTTPException(403, detail={"error": {
                "code": "FORBIDDEN", "message": "You cannot approve corrections."}})
        if is_mine:
            raise HTTPException(403, detail={"error": {
                "code": "SELF_APPROVAL",
                "message": "You cannot approve a correction to your own attendance."}})
        if correction.status != "pending":
            raise HTTPException(409, detail={"error": {
                "code": "ALREADY_DECIDED",
                "message": f"This correction was already {correction.status}."}})

    before = correction.status
    correction.status = body.status
    if body.status in ("approved", "rejected"):
        correction.approved_by = actor.user_id
        correction.approved_at = datetime.now(timezone.utc)
    else:
        correction.approved_by = None
        correction.approved_at = None

    await record_audit(
        session, actor_user_id=actor.user_id, action=f"correction.{body.status}",
        entity="correction", entity_id=correction.id, request=request,
        before={"status": before},
        after={"status": body.status, "date": correction.date,
               "proposedIn": correction.proposed_in, "proposedOut": correction.proposed_out},
    )
    await session.commit()
    await session.refresh(correction)

    employee = (await session.execute(
        select(Employee).where(Employee.id == correction.employee_id))).scalar_one_or_none()
    requester = (await session.execute(
        select(User).options(selectinload(User.employee))
        .where(User.id == correction.requested_by))).scalar_one_or_none()
    approver = None
    if correction.approved_by:
        row = (await session.execute(
            select(User).options(selectinload(User.employee))
            .where(User.id == correction.approved_by))).scalar_one_or_none()
        approver = row.employee.name if row and row.employee else None

    current_in, current_out = await _current_times(session, correction.employee_id, correction.date)
    return Single(data=_to_out(
        correction, employee,
        requester.employee.name if requester and requester.employee else "Removed account",
        approver, current_in, current_out,
    ))
