"""
app/api/v1/settings.py

Own profile, and company attendance policy.
"""

from datetime import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor, requires
from app.core.audit import record_audit
from app.core.db import get_session
from app.models import Employee, Shift
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
        companyName="Nexus Operations",
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
    THIS CHANGE IS RETROACTIVE, AND THAT IS INTENDED.

    Attendance days are derived from punch events rather than stored, so
    narrowing the grace period reclassifies people who were on time last month.
    That is what makes a policy change work without a migration — and it is
    also something nobody should discover by accident, which is why the UI
    confirms it in as many words before sending this request.

    Punch records themselves are never altered.
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

    # A policy change is RETROACTIVE — it reclassifies every past day, because
    # days are derived from punches rather than stored. Recording the old rule
    # is the only way to explain later why last month's figures moved.
    await record_audit(
        session, actor_user_id=actor.user_id, action="settings.update",
        entity="shift", entity_id=shift.id, request=request,
        before=before,
        after={
            "shiftStart": shift.start_time.strftime("%H:%M"),
            "shiftEnd": shift.end_time.strftime("%H:%M"),
            "graceMinutes": shift.grace_minutes,
            "minHours": float(shift.min_hours),
        },
    )
    await session.commit()
    await session.refresh(shift)
    return Single(data=_shift_out(shift))


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
