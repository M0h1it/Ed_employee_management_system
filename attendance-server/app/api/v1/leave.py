"""
app/api/v1/leave.py

Leave requests and company holidays.

WHY THIS MATTERS MORE THAN IT LOOKS
------------------------------------
Without either of these, a zero-punch day has exactly one meaning: ABSENT. So
somebody on approved leave and somebody who simply did not turn up are
indistinguishable, and a public holiday reads as the entire company failing to
appear.

The tables and the rollup have handled both since the first migration. What was
missing was any way to PUT a row in them — which meant in practice they would
have stayed empty and every absence figure would have been wrong.
"""

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor, requires
from app.core.audit import record_audit
from app.core.db import get_session
from app.models import Employee, Holiday, Leave, LeaveStatus, LeaveType, User
from app.schemas.common import Paginated, Single, page_meta
from app.schemas.leave import (
    HolidayCreate,
    HolidayOut,
    LeaveCreate,
    LeaveDecision,
    LeaveOut,
)

router = APIRouter(tags=["leave"])


def working_days(from_date: date, to_date: date, holidays: set[date]) -> int:
    """
    Weekends and company holidays do not count against a leave balance.

    Counting raw calendar days would charge somebody two days for a Saturday
    and Sunday they were never going to work — the kind of arithmetic that
    turns into an argument the first month it is noticed.
    """
    total = 0
    current = from_date
    while current <= to_date:
        if current.weekday() < 5 and current not in holidays:
            total += 1
        current += timedelta(days=1)
    return total


async def _holiday_set(session: AsyncSession, from_date: date, to_date: date) -> set[date]:
    return set((await session.execute(
        select(Holiday.date).where(Holiday.date >= from_date, Holiday.date <= to_date))
    ).scalars().all())


def _to_out(leave: Leave, employee: Employee | None, approver: str | None, days: int) -> LeaveOut:
    return LeaveOut(
        id=leave.id,
        employeeId=leave.employee_id,
        employeeName=employee.name if employee else "",
        employeePhotoUrl=employee.photo_url if employee else None,
        departmentName=employee.department.name if employee and employee.department else "",
        fromDate=leave.from_date,
        toDate=leave.to_date,
        days=days,
        type=leave.type.value,
        reason=leave.reason,
        status=leave.status.value,
        approvedBy=leave.approved_by,
        approvedByName=approver,
        approvedAt=leave.approved_at,
        createdAt=leave.created_at,
    )


# ===========================================================================
# Leave
# ===========================================================================

@router.get("/leaves", response_model=Paginated[LeaveOut])
async def list_leaves(
    employeeId: str | None = None,
    leaveStatus: str | None = Query(default=None, alias="status"),
    dateFrom: date | None = None,
    dateTo: date | None = None,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=25, ge=1, le=100),
    actor: Actor = Depends(requires("leave.view_all", "leave.view_own")),
    session: AsyncSession = Depends(get_session),
):
    # Scoping applied to the filter, not checked afterwards — a caller without
    # leave.view_all cannot widen it by editing the query string.
    if actor.can("leave.view_all"):
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

    stmt = select(Leave)
    if scoped:
        stmt = stmt.where(Leave.employee_id == scoped)
    if leaveStatus:
        stmt = stmt.where(Leave.status == LeaveStatus(leaveStatus))
    if dateFrom:
        stmt = stmt.where(Leave.to_date >= dateFrom)
    if dateTo:
        stmt = stmt.where(Leave.from_date <= dateTo)

    total = (await session.execute(
        select(func.count()).select_from(stmt.subquery()))).scalar_one()

    # Pending first, then most recent. The list exists to be acted on, and a
    # request waiting for a decision outranks one already settled.
    stmt = (
        stmt.order_by(
            (Leave.status != LeaveStatus.pending),
            Leave.from_date.desc(),
        )
        .offset((page - 1) * pageSize)
        .limit(pageSize)
    )
    rows = (await session.execute(stmt)).scalars().all()

    # Batch-load people and approvers for the page, not one query per row.
    employee_ids = {r.employee_id for r in rows}
    employees: dict[UUID, Employee] = {}
    if employee_ids:
        employees = {
            e.id: e for e in (await session.execute(
                select(Employee).options(selectinload(Employee.department))
                .where(Employee.id.in_(employee_ids)))).scalars()
        }

    approver_ids = {r.approved_by for r in rows if r.approved_by}
    approvers: dict[UUID, str] = {}
    if approver_ids:
        approvers = {
            u.id: (u.employee.name if u.employee else u.username)
            for u in (await session.execute(
                select(User).options(selectinload(User.employee))
                .where(User.id.in_(approver_ids)))).scalars()
        }

    span_start = min((r.from_date for r in rows), default=date.today())
    span_end = max((r.to_date for r in rows), default=date.today())
    holidays = await _holiday_set(session, span_start, span_end)

    return Paginated(
        data=[
            _to_out(r, employees.get(r.employee_id),
                    approvers.get(r.approved_by) if r.approved_by else None,
                    working_days(r.from_date, r.to_date, holidays))
            for r in rows
        ],
        meta=page_meta(page=page, page_size=pageSize, total=total),
    )


@router.post("/leaves", response_model=Single[LeaveOut], status_code=status.HTTP_201_CREATED)
async def create_leave(
    body: LeaveCreate,
    request: Request,
    actor: Actor = Depends(requires("leave.apply", "leave.approve")),
    session: AsyncSession = Depends(get_session),
):
    """
    Applying for leave. Defaults to the caller.

    Somebody with leave.approve may file on another person's behalf — a phone
    call at 7am saying "I am ill" has to be recordable by whoever picked up.
    That entry is still pending and still needs a decision by someone else.
    """
    employee_id = body.employeeId or actor.employee_id

    if employee_id != actor.employee_id and not actor.can("leave.approve"):
        raise HTTPException(403, detail={"error": {
            "code": "FORBIDDEN", "message": "You can only apply for your own leave."}})

    employee = (await session.execute(
        select(Employee).options(selectinload(Employee.department))
        .where(Employee.id == employee_id))).scalar_one_or_none()
    if employee is None:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Please fix the highlighted fields.",
            "fields": {"employeeId": "Choose an employee"}}})

    # A span that contains no working days at all is meaningless — a request
    # for a Saturday, or for a single company holiday. It would sit in the
    # pending list needing a decision that changes nothing.
    #
    # Caught here rather than left to the approver, because "0 days" in a list
    # of requests reads as a bug in the day count, not as a bad request.
    span_holidays = await _holiday_set(session, body.fromDate, body.toDate)
    if working_days(body.fromDate, body.toDate, span_holidays) == 0:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED",
            "message": "Please fix the highlighted fields.",
            "fields": {"fromDate": "That range has no working days in it"}}})

    # An overlapping request for the same person is almost always a double
    # submission, and two approved rows covering one day make the rollup
    # ambiguous about which leave that day belongs to.
    clash = (await session.execute(
        select(Leave).where(
            Leave.employee_id == employee_id,
            Leave.status.in_([LeaveStatus.pending, LeaveStatus.approved]),
            Leave.from_date <= body.toDate,
            Leave.to_date >= body.fromDate,
        ))).scalar_one_or_none()
    if clash:
        raise HTTPException(409, detail={"error": {
            "code": "OVERLAPPING_LEAVE",
            "message": f"This overlaps an existing request from "
                       f"{clash.from_date} to {clash.to_date}."}})

    leave = Leave(
        employee_id=employee_id,
        from_date=body.fromDate,
        to_date=body.toDate,
        type=LeaveType(body.type),
        reason=body.reason.strip(),
        status=LeaveStatus.pending,
    )
    session.add(leave)
    await session.flush()

    await record_audit(
        session, actor_user_id=actor.user_id, action="leave.apply",
        entity="leave", entity_id=leave.id, request=request,
        after={"employee": employee.name, "from": body.fromDate,
               "to": body.toDate, "type": body.type},
    )
    await session.commit()
    await session.refresh(leave)

    holidays = await _holiday_set(session, body.fromDate, body.toDate)
    return Single(data=_to_out(leave, employee, None,
                               working_days(body.fromDate, body.toDate, holidays)))


@router.patch("/leaves/{leave_id}", response_model=Single[LeaveOut])
async def decide_leave(
    leave_id: UUID,
    body: LeaveDecision,
    request: Request,
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    """
    Approve, reject, or cancel.

    NOBODY APPROVES THEIR OWN LEAVE
    --------------------------------
    Not even an owner holding every permission. Approval is a second pair of
    eyes, and a second pair of eyes that belongs to the same person is not one.

    Cancelling your own PENDING request is different — that is withdrawing an
    ask, not granting it, and needs no permission beyond owning the row.
    """
    leave = (await session.execute(select(Leave).where(Leave.id == leave_id))).scalar_one_or_none()
    if leave is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Leave request not found."}})

    is_mine = leave.employee_id == actor.employee_id
    new_status = LeaveStatus(body.status)

    if new_status == LeaveStatus.cancelled:
        if not is_mine and not actor.can("leave.approve"):
            raise HTTPException(403, detail={"error": {
                "code": "FORBIDDEN", "message": "You can only cancel your own request."}})
        if leave.status == LeaveStatus.rejected:
            raise HTTPException(409, detail={"error": {
                "code": "ALREADY_DECIDED", "message": "This request was already rejected."}})
    else:
        if not actor.can("leave.approve"):
            raise HTTPException(403, detail={"error": {
                "code": "FORBIDDEN", "message": "You cannot approve or reject leave."}})
        if is_mine:
            raise HTTPException(403, detail={"error": {
                "code": "SELF_APPROVAL",
                "message": "You cannot approve your own leave. Ask someone else."}})
        if leave.status != LeaveStatus.pending:
            raise HTTPException(409, detail={"error": {
                "code": "ALREADY_DECIDED",
                "message": f"This request was already {leave.status.value}."}})

    before_status = leave.status.value
    leave.status = new_status

    if new_status in (LeaveStatus.approved, LeaveStatus.rejected):
        leave.approved_by = actor.user_id
        leave.approved_at = datetime.now(timezone.utc)
    elif new_status == LeaveStatus.cancelled:
        # An approved leave that is cancelled must stop counting as leave, so
        # the decision stamp goes with it — otherwise the row still claims
        # somebody signed off on time away that is no longer being taken.
        leave.approved_by = None
        leave.approved_at = None

    await record_audit(
        session, actor_user_id=actor.user_id, action=f"leave.{body.status}",
        entity="leave", entity_id=leave.id, request=request,
        before={"status": before_status},
        after={"status": new_status.value, "from": leave.from_date, "to": leave.to_date},
    )
    await session.commit()
    await session.refresh(leave)

    employee = (await session.execute(
        select(Employee).options(selectinload(Employee.department))
        .where(Employee.id == leave.employee_id))).scalar_one_or_none()
    approver = None
    if leave.approved_by:
        user = (await session.execute(
            select(User).options(selectinload(User.employee))
            .where(User.id == leave.approved_by))).scalar_one_or_none()
        approver = (user.employee.name if user and user.employee else None)

    holidays = await _holiday_set(session, leave.from_date, leave.to_date)
    return Single(data=_to_out(leave, employee, approver,
                               working_days(leave.from_date, leave.to_date, holidays)))


# ===========================================================================
# Holidays
# ===========================================================================

@router.get("/holidays", response_model=Single[list[HolidayOut]])
async def list_holidays(
    year: int | None = None,
    _: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    """Readable by anyone signed in — the dates are not sensitive, and both the
    leave form and the attendance register need them."""
    stmt = select(Holiday)
    if year:
        stmt = stmt.where(
            Holiday.date >= date(year, 1, 1), Holiday.date <= date(year, 12, 31))
    rows = (await session.execute(stmt.order_by(Holiday.date))).scalars().all()
    return Single(data=[HolidayOut(id=h.id, date=h.date, name=h.name) for h in rows])


@router.post("/holidays", response_model=Single[HolidayOut], status_code=status.HTTP_201_CREATED)
async def create_holiday(
    body: HolidayCreate,
    request: Request,
    actor: Actor = Depends(requires("holidays.manage")),
    session: AsyncSession = Depends(get_session),
):
    clash = (await session.execute(
        select(Holiday).where(Holiday.date == body.date))).scalar_one_or_none()
    if clash:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Please fix the highlighted fields.",
            "fields": {"date": f"{clash.name} is already set for this date"}}})

    holiday = Holiday(date=body.date, name=body.name.strip())
    session.add(holiday)
    await session.flush()

    # Adding or removing a holiday reclassifies that day for everybody, because
    # attendance days are derived rather than stored. Worth a record.
    await record_audit(
        session, actor_user_id=actor.user_id, action="holiday.create",
        entity="holiday", entity_id=holiday.id, request=request,
        after={"date": body.date, "name": holiday.name},
    )
    await session.commit()
    await session.refresh(holiday)
    return Single(data=HolidayOut(id=holiday.id, date=holiday.date, name=holiday.name))


@router.delete("/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_holiday(
    holiday_id: UUID,
    request: Request,
    actor: Actor = Depends(requires("holidays.manage")),
    session: AsyncSession = Depends(get_session),
):
    holiday = (await session.execute(
        select(Holiday).where(Holiday.id == holiday_id))).scalar_one_or_none()
    if holiday is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Holiday not found."}})

    await record_audit(
        session, actor_user_id=actor.user_id, action="holiday.delete",
        entity="holiday", entity_id=holiday.id, request=request,
        before={"date": holiday.date, "name": holiday.name},
    )
    await session.delete(holiday)
    await session.commit()
    return None
