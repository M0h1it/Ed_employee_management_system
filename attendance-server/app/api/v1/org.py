"""
app/api/v1/org.py

Reference data: departments and shifts.

Read-only list for departments is available to anyone signed in — a filter
dropdown needs the department list, and the names are not sensitive.
Creating a department is gated by settings.manage, the same permission that
already governs shift/grace-period policy in app/api/v1/settings.py — both
are org-wide configuration, not something every signed-in user should be
able to change.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor, requires
from app.core.audit import record_audit
from app.core.db import get_session
from app.models import Department, Shift
from app.schemas.common import Single
from app.schemas.employee import DepartmentOut, ShiftOut
from app.schemas.org import DepartmentCreate

router = APIRouter(tags=["org"])


@router.get("/departments", response_model=Single[list[DepartmentOut]])
async def list_departments(
    _: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    rows = (await session.execute(select(Department).order_by(Department.name))).scalars().all()
    return Single(data=[DepartmentOut.model_validate(d) for d in rows])


@router.post("/departments", response_model=Single[DepartmentOut], status_code=201)
async def create_department(
    body: DepartmentCreate,
    request: Request,
    actor: Actor = Depends(requires("settings.manage")),
    session: AsyncSession = Depends(get_session),
):
    """
    The one thing this file's own docstring used to say was still
    missing — department.name is UNIQUE at the database level (see
    app/models/org.py), so a duplicate name is caught here as a clean 422
    rather than surfacing as a raw database IntegrityError to the client.
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Please fix the highlighted fields.",
            "fields": {"name": "A department needs a name"}}})

    department = Department(name=name)
    session.add(department)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Please fix the highlighted fields.",
            "fields": {"name": "A department with this name already exists"}}})

    await record_audit(
        session, actor_user_id=actor.user_id, action="department.create",
        entity="department", entity_id=department.id, request=request,
        after={"name": department.name},
    )
    await session.commit()
    await session.refresh(department)

    return Single(data=DepartmentOut.model_validate(department))


@router.get("/shifts", response_model=Single[list[ShiftOut]])
async def list_shifts(
    _: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    rows = (await session.execute(select(Shift).order_by(Shift.name))).scalars().all()
    return Single(
        data=[
            ShiftOut(
                id=s.id,
                name=s.name,
                startTime=s.start_time.strftime("%H:%M"),
                endTime=s.end_time.strftime("%H:%M"),
                graceMinutes=s.grace_minutes,
                minHours=float(s.min_hours),
            )
            for s in rows
        ]
    )