"""
app/api/v1/settings.py

Own profile, and company attendance policy.
"""

from datetime import date, time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor, requires
from app.core.audit import record_audit
from app.core.db import get_session
from app.core.timeutil import local_today
from app.models import Employee, Shift, ShiftPolicyVersion
from app.schemas.common import Single

router = APIRouter(tags=["settings"])


class OrgSettings(BaseModel):
    shiftStart: str
    shiftEnd: str
    graceMinutes: int
    minHours: float
    companyName: str


class OrgSettingsUpdate(BaseModel):
    shiftStart: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    shiftEnd: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    graceMinutes: int | None = Field(default=None, ge=0, le=120)
    minHours: float | None = Field(default=None, ge=1, le=16)
    # The date this policy takes effect — defaults to today when omitted.
    # This is what makes a change stop being retroactive: a version row
    # effective from this date means every day BEFORE it keeps matching
    # whichever version (or the pre-versioning fallback) was already
    # correct for it. Backdating this is deliberately still possible (an
    # admin fixing a policy that should have applied from an earlier date)
    # rather than clamped to "today or later" — the same trust already
    # extended to a manual punch or a correction with an admin-chosen time.
    effectiveFrom: date | None = None


class ProfileUpdate(BaseModel):
    # Only what a person may change about themselves. Name, department and
    # employee code are absent on purpose — those are the administrator's to
    # set, and letting people rewrite their own name in an attendance record is
    # exactly the wrong affordance.
    email: EmailStr | None = None
    phone: str | None = Field(default=None, pattern=r"^[6-9]\d{9}$")


def _shift_out(shift: Shift) -> OrgSettings:
    return OrgSettings(
        shiftStart=shift.start_time.strftime("%H:%M"),
        shiftEnd=shift.end_time.strftime("%H:%M"),
        graceMinutes=shift.grace_minutes,
        minHours=float(shift.min_hours),
        companyName="SmartPunch",
    )


@router.get("/settings", response_model=Single[OrgSettings])
async def get_settings(
    _: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    shift = (await session.execute(select(Shift).order_by(Shift.name))).scalars().first()
    if shift is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "No shift is configured."}})
    return Single(data=_shift_out(shift))


@router.patch("/settings", response_model=Single[OrgSettings])
async def update_settings(
    body: OrgSettingsUpdate,
    request: Request,
    actor: Actor = Depends(requires("settings.manage")),
    session: AsyncSession = Depends(get_session),
):
    """
    Updates the CURRENT policy (the `shifts` row, unchanged from before) AND
    records a ShiftPolicyVersion effective from body.effectiveFrom (today,
    if not given).

    Why both: nine other places in this codebase read `shifts` for "what is
    the policy right now" and have no reason to care about history — see
    the migration's own docstring for the full list. Those keep working
    unmodified. The four places that actually compute a specific day's
    attendance (attendance.py, corrections.py, dashboard.py, export.py) go
    through pick_shift_for_date() instead, which is what makes a change
    here stop being retroactive for days before effectiveFrom — the
    opposite of this endpoint's own historical behaviour, which is why this
    docstring used to say "THIS CHANGE IS RETROACTIVE, AND THAT IS
    INTENDED": that was true before shift policy versioning existed, and is
    the specific behaviour this change replaces.

    Punch records themselves are never altered, exactly as before.
    """
    shift = (await session.execute(select(Shift).order_by(Shift.name))).scalars().first()
    if shift is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "No shift is configured."}})

    before = {
        "shiftStart": shift.start_time.strftime("%H:%M"),
        "shiftEnd": shift.end_time.strftime("%H:%M"),
        "graceMinutes": shift.grace_minutes,
        "minHours": float(shift.min_hours),
    }

    def parse(value: str) -> time:
        hour, minute = value.split(":")
        return time(int(hour), int(minute))

    if body.shiftStart:
        shift.start_time = parse(body.shiftStart)
    if body.shiftEnd:
        shift.end_time = parse(body.shiftEnd)
    if body.graceMinutes is not None:
        shift.grace_minutes = body.graceMinutes
    if body.minHours is not None:
        shift.min_hours = body.minHours

    if shift.end_time <= shift.start_time:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED",
            "message": "Please fix the highlighted fields.",
            "fields": {"shiftEnd": "The shift must end after it starts"}}})

    effective_from = body.effectiveFrom or local_today()

    # UPSERT on (shift_id, effective_from) — the unique constraint the
    # migration created. Saving the policy twice for the same
    # effective_from (a typo, then an immediate correction) updates that
    # one version rather than erroring on a duplicate or silently creating
    # two versions that would tie for the same day.
    existing_version = (await session.execute(
        select(ShiftPolicyVersion).where(
            ShiftPolicyVersion.shift_id == shift.id,
            ShiftPolicyVersion.effective_from == effective_from,
        )
    )).scalar_one_or_none()

    if existing_version is not None:
        existing_version.start_time = shift.start_time
        existing_version.end_time = shift.end_time
        existing_version.grace_minutes = shift.grace_minutes
        existing_version.min_hours = shift.min_hours
    else:
        session.add(ShiftPolicyVersion(
            shift_id=shift.id,
            start_time=shift.start_time,
            end_time=shift.end_time,
            grace_minutes=shift.grace_minutes,
            min_hours=shift.min_hours,
            effective_from=effective_from,
        ))

    # The audit record now includes the effective date — "what changed" was
    # already here; "from when" is the other half of the same fact, and
    # without it the audit log cannot explain why two different attendance
    # exports covering the same past days show different numbers.
    await record_audit(
        session, actor_user_id=actor.user_id, action="settings.update",
        entity="shift", entity_id=shift.id, request=request,
        before=before,
        after={
            "shiftStart": shift.start_time.strftime("%H:%M"),
            "shiftEnd": shift.end_time.strftime("%H:%M"),
            "graceMinutes": shift.grace_minutes,
            "minHours": float(shift.min_hours),
            "effectiveFrom": effective_from.isoformat(),
        },
    )
    await session.commit()
    await session.refresh(shift)
    return Single(data=_shift_out(shift))


class ShiftPolicyVersionOut(BaseModel):
    id: str
    shiftStart: str
    shiftEnd: str
    graceMinutes: int
    minHours: float
    effectiveFrom: date
    createdAt: str


@router.get("/settings/history", response_model=Single[list[ShiftPolicyVersionOut]])
async def list_settings_history(
    actor: Actor = Depends(requires("settings.manage")),
    session: AsyncSession = Depends(get_session),
):
    """
    Every saved policy version, newest effective_from first — what
    OrgPanel's history list on the settings screen renders. Gated the same
    as changing the policy (settings.manage), not merely viewing it
    (get_settings has no permission check beyond being signed in) — this is
    the audit trail for a company-wide policy, not something every
    employee needs to see just to check their own shift times.
    """
    shift = (await session.execute(select(Shift).order_by(Shift.name))).scalars().first()
    if shift is None:
        return Single(data=[])

    rows = (await session.execute(
        select(ShiftPolicyVersion)
        .where(ShiftPolicyVersion.shift_id == shift.id)
        .order_by(ShiftPolicyVersion.effective_from.desc())
    )).scalars().all()

    return Single(data=[
        ShiftPolicyVersionOut(
            id=str(v.id),
            shiftStart=v.start_time.strftime("%H:%M"),
            shiftEnd=v.end_time.strftime("%H:%M"),
            graceMinutes=v.grace_minutes,
            minHours=float(v.min_hours),
            effectiveFrom=v.effective_from,
            createdAt=v.created_at.isoformat(),
        )
        for v in rows
    ])


@router.patch("/me/profile")
async def update_own_profile(
    body: ProfileUpdate,
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    """
    A person editing their OWN contact details.

    No permission is required beyond being signed in, because the row is scoped
    to the caller — there is no id in the path to tamper with. That is a safer
    shape than /employees/{id} with an ownership check, because there is nothing
    to get wrong.
    """
    employee = (await session.execute(
        select(Employee).where(Employee.id == actor.employee_id))).scalar_one()

    if body.email and body.email.lower() != employee.email:
        clash = (await session.execute(
            select(Employee).where(
                func.lower(Employee.email) == body.email.lower(),
                Employee.id != employee.id))).scalar_one_or_none()
        if clash:
            raise HTTPException(422, detail={"error": {
                "code": "VALIDATION_FAILED",
                "message": "Please fix the highlighted fields.",
                "fields": {"email": "This email is already in use"}}})
        employee.email = body.email.lower()

    if body.phone:
        employee.phone = body.phone

    await session.commit()
    await session.refresh(employee)
    return {"data": {"id": str(employee.id), "email": employee.email, "phone": employee.phone}}