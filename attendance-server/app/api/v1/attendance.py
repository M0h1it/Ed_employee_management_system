"""
app/api/v1/attendance.py

The register, the live present list, the raw punch drill-down, and manual entry.

NOTHING HERE IS STORED AS A "DAY"
----------------------------------
Every row the register returns is computed from punch events on the way out,
by app.domain.attendance_rules. Punches are the truth; a day is a view of them.

That is what makes a policy change work: narrow the grace period and every past
day reports differently on the next request, with no migration and no backfill.
It is also what makes the data defensible — expand any row and you see the raw
events it was derived from.
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
from app.core.timeutil import local_date_of, local_now, local_today, to_local
from app.domain.attendance_rules import (
    AttendanceFlag,
    Correction as CorrectionRule,
    AttendanceStatus,
    Punch,
    PunchDirection,
    PunchSource,
    ShiftRule,
    build_day,
    build_idempotency_key,
    is_currently_in,
)
from app.models import (
    Correction,
    Employee,
    EmployeeStatus,
    Holiday,
    Leave,
    LeaveStatus,
    PunchEvent,
    Shift,
)
from app.schemas.attendance import (
    AttendanceDayOut,
    CreatePunchRequest,
    MyAttendanceToday,
    PresentEmployeeOut,
    PunchEventOut,
)
from app.schemas.common import Paginated, Single, page_meta

router = APIRouter(tags=["attendance"])

MAX_RANGE_DAYS = 92


async def _shift_rule(session: AsyncSession, shift_id: UUID | None) -> ShiftRule:
    shift = None
    if shift_id:
        shift = (await session.execute(select(Shift).where(Shift.id == shift_id))).scalar_one_or_none()
    if shift is None:
        shift = (await session.execute(select(Shift).order_by(Shift.name))).scalars().first()
    if shift is None:
        # A sane fallback rather than a 500 on a database that was never seeded.
        from datetime import time
        return ShiftRule(start_time=time(9, 0), end_time=time(18, 0))
    return ShiftRule(
        start_time=shift.start_time,
        end_time=shift.end_time,
        grace_minutes=shift.grace_minutes,
        min_hours=float(shift.min_hours),
    )


def _scope_employee_id(actor: Actor, requested: UUID | None) -> UUID | None:
    """
    ROW-LEVEL SCOPING.

    Without attendance.view_all, the filter is forced to the caller's own id —
    whatever they asked for. A caller cannot widen their own scope by editing
    the query string, which is exactly what they would try first.
    """
    if actor.can("attendance.view_all"):
        return requested
    return actor.employee_id


@router.get("/attendance/days", response_model=Paginated[AttendanceDayOut])
async def list_days(
    dateFrom: date,
    dateTo: date,
    employeeId: UUID | None = None,
    departmentId: UUID | None = None,
    dayStatus: str | None = Query(default=None, alias="status"),
    hasFlags: bool | None = None,
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=15, ge=1, le=200),
    actor: Actor = Depends(requires("attendance.view_all", "attendance.view_own")),
    session: AsyncSession = Depends(get_session),
):
    if dateTo < dateFrom:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "dateTo cannot be before dateFrom."}})

    # A range cap, because the work is employees × days. Without it, a request
    # for five years quietly becomes tens of thousands of rollups and ties up a
    # worker — which is a denial of service anyone with a token could trigger.
    if (dateTo - dateFrom).days > MAX_RANGE_DAYS:
        raise HTTPException(422, detail={"error": {
            "code": "RANGE_TOO_WIDE",
            "message": f"Choose a range of {MAX_RANGE_DAYS} days or fewer."}})

    employeeId = _scope_employee_id(actor, employeeId)

    people_stmt = (
        select(Employee)
        .options(selectinload(Employee.department))
        .where(Employee.status == EmployeeStatus.active, Employee.attendance_tracked.is_(True))
    )
    if employeeId:
        people_stmt = people_stmt.where(Employee.id == employeeId)
    if departmentId:
        people_stmt = people_stmt.where(Employee.department_id == departmentId)
    if search:
        people_stmt = people_stmt.where(Employee.name.ilike(f"%{search.strip()}%"))

    people = (await session.execute(people_stmt)).scalars().all()
    if not people:
        return Paginated(data=[], meta=page_meta(page=page, page_size=pageSize, total=0))

    employee_ids = [e.id for e in people]

    # Every punch in the window, in ONE query, then grouped in memory. Querying
    # per employee per day would be employees × days round-trips.
    punch_rows = (
        await session.execute(
            select(PunchEvent).where(
                PunchEvent.employee_id.in_(employee_ids),
                # Widened by a day on each side, then filtered precisely in
                # Python by LOCAL date. A punch at 23:30 local is 18:00 UTC on
                # the same day, but one at 02:00 local is the PREVIOUS day in
                # UTC — filtering on the UTC date alone would drop it.
                func.date(PunchEvent.ts) >= dateFrom - timedelta(days=1),
                func.date(PunchEvent.ts) <= dateTo + timedelta(days=1),
            )
        )
    ).scalars().all()

    # Punches are converted to LOCAL time before the rules see them, and grouped
    # by their LOCAL date. Shift rules are written in wall-clock time, so the
    # comparison has to happen in the same clock — otherwise a +05:30 offset
    # makes everybody look like they left early.
    by_employee_day: dict[tuple[UUID, date], list[Punch]] = {}
    for row in punch_rows:
        local_ts = to_local(row.ts)
        key = (row.employee_id, local_ts.date())
        by_employee_day.setdefault(key, []).append(
            Punch(ts=local_ts, direction=PunchDirection(row.direction.value),
                  source=PunchSource(row.source.value))
        )

    holidays = set(
        (await session.execute(
            select(Holiday.date).where(Holiday.date >= dateFrom, Holiday.date <= dateTo)
        )).scalars().all()
    )

    leave_rows = (
        await session.execute(
            select(Leave).where(
                Leave.employee_id.in_(employee_ids),
                Leave.status == LeaveStatus.approved,
                Leave.from_date <= dateTo,
                Leave.to_date >= dateFrom,
            )
        )
    ).scalars().all()

    # Approved corrections in the window, keyed by person and day.
    correction_rows = (
        await session.execute(
            select(Correction).where(
                Correction.employee_id.in_(employee_ids),
                Correction.status == "approved",
                Correction.date >= dateFrom,
                Correction.date <= dateTo,
            )
        )
    ).scalars().all()
    corrections = {
        (c.employee_id, c.date): CorrectionRule(
            first_in=to_local(c.proposed_in) if c.proposed_in else None,
            last_out=to_local(c.proposed_out) if c.proposed_out else None,
        )
        for c in correction_rows
    }

    def on_leave(employee_id: UUID, day: date) -> bool:
        return any(
            l.employee_id == employee_id and l.from_date <= day <= l.to_date
            for l in leave_rows
        )

    shift_cache: dict[UUID | None, ShiftRule] = {}
    rows: list[AttendanceDayOut] = []
    now = local_now()

    current = dateFrom
    while current <= dateTo:
        for employee in people:
            if employee.shift_id not in shift_cache:
                shift_cache[employee.shift_id] = await _shift_rule(session, employee.shift_id)

            result = build_day(
                day=current,
                punches=by_employee_day.get((employee.id, current), []),
                shift=shift_cache[employee.shift_id],
                is_holiday=current in holidays,
                on_leave=on_leave(employee.id, current),
                correction=corrections.get((employee.id, current)),
                now=now,
            )

            rows.append(AttendanceDayOut(
                employeeId=employee.id,
                employeeName=employee.name,
                employeePhotoUrl=employee.photo_url,
                departmentName=employee.department.name if employee.department else "",
                date=current,
                firstIn=result.first_in,
                lastOut=result.last_out,
                workedMinutes=result.worked_minutes,
                status=result.status.value,
                flags=[f.value for f in result.flags],
                punchCount=result.punch_count,
            ))
        current += timedelta(days=1)

    # Weekends are noise in a company-wide register. When one person's history
    # is being read the gap itself is informative, so they stay.
    if not employeeId:
        rows = [r for r in rows if r.status != AttendanceStatus.WEEKEND.value]
    if dayStatus:
        rows = [r for r in rows if r.status == dayStatus]
    if hasFlags:
        rows = [r for r in rows if r.flags]

    rows.sort(key=lambda r: (r.date, r.employeeName), reverse=False)
    rows.sort(key=lambda r: r.date, reverse=True)

    total = len(rows)
    start = (page - 1) * pageSize
    return Paginated(
        data=rows[start:start + pageSize],
        meta=page_meta(page=page, page_size=pageSize, total=total),
    )


@router.get("/attendance/present", response_model=Single[list[PresentEmployeeOut]])
async def who_is_present(
    actor: Actor = Depends(requires("attendance.view_all")),
    session: AsyncSession = Depends(get_session),
):
    today = local_today()
    now = local_now()

    people = (
        await session.execute(
            select(Employee)
            .options(selectinload(Employee.department))
            .where(Employee.status == EmployeeStatus.active, Employee.attendance_tracked.is_(True))
        )
    ).scalars().all()

    punch_rows = (
        await session.execute(
            select(PunchEvent).where(
                PunchEvent.employee_id.in_([e.id for e in people]),
                func.date(PunchEvent.ts) >= today - timedelta(days=1),
                func.date(PunchEvent.ts) <= today + timedelta(days=1),
            )
        )
    ).scalars().all()

    by_employee: dict[UUID, list[PunchEvent]] = {}
    for row in punch_rows:
        if local_date_of(row.ts) != today:
            continue
        by_employee.setdefault(row.employee_id, []).append(row)

    # Cached per shift id, not fetched per employee. The log showed the same
    # shift row being read nine times for nine people on one request — the same
    # N+1 shape as before, just smaller and easier to miss.
    shift_cache: dict[UUID | None, ShiftRule] = {}

    out: list[PresentEmployeeOut] = []
    for employee in people:
        todays = by_employee.get(employee.id, [])
        as_punches = [
            Punch(ts=to_local(p.ts), direction=PunchDirection(p.direction.value),
                  source=PunchSource(p.source.value))
            for p in todays
        ]
        if not is_currently_in(as_punches):
            continue

        first_in = min((p for p in as_punches if p.direction == PunchDirection.IN),
                       key=lambda p: p.ts, default=None)
        if first_in is None:
            continue

        if employee.shift_id not in shift_cache:
            shift_cache[employee.shift_id] = await _shift_rule(session, employee.shift_id)

        result = build_day(day=today, punches=as_punches,
                           shift=shift_cache[employee.shift_id], now=now)

        out.append(PresentEmployeeOut(
            employeeId=employee.id,
            name=employee.name,
            photoUrl=employee.photo_url,
            departmentName=employee.department.name if employee.department else "",
            checkInAt=first_in.ts,
            minutesSinceCheckIn=max(0, int((now - first_in.ts).total_seconds() // 60)),
            isLate=AttendanceFlag.LATE_IN in result.flags,
        ))

    out.sort(key=lambda r: r.checkInAt)
    return Single(data=out)


@router.get("/attendance/punches", response_model=Single[list[PunchEventOut]])
async def list_punches(
    employeeId: UUID,
    day: date = Query(alias="date"),
    actor: Actor = Depends(requires("attendance.view_all", "attendance.view_own")),
    session: AsyncSession = Depends(get_session),
):
    """
    The raw events behind one day — the audit trail made visible.

    Showing device and confidence next to each punch changes the conversation:
    "the kiosk matched your face at 91% at 09:14" is very different from "the
    system says you were late".
    """
    if employeeId != actor.employee_id and not actor.can("attendance.view_all"):
        raise HTTPException(403, detail={"error": {
            "code": "FORBIDDEN", "message": "You can only view your own punches."}})

    rows = (
        await session.execute(
            select(PunchEvent)
            .where(
                PunchEvent.employee_id == employeeId,
                func.date(PunchEvent.ts) >= day - timedelta(days=1),
                func.date(PunchEvent.ts) <= day + timedelta(days=1),
            )
            .order_by(PunchEvent.ts)
        )
    ).scalars().all()

    employee = (await session.execute(
        select(Employee).where(Employee.id == employeeId))).scalar_one_or_none()
    name = employee.name if employee else ""

    rows = [p for p in rows if local_date_of(p.ts) == day]

    return Single(data=[
        PunchEventOut(
            id=p.id, employeeId=p.employee_id, employeeName=name, ts=to_local(p.ts),
            direction=p.direction.value, deviceId=p.device_id, deviceName=None,
            source=p.source.value, confidence=p.confidence, photoRef=p.photo_ref,
        )
        for p in rows
    ])


@router.post("/attendance/punches", response_model=Single[PunchEventOut],
             status_code=status.HTTP_201_CREATED)
async def create_punch(
    body: CreatePunchRequest,
    request: Request,
    actor: Actor = Depends(requires("attendance.punch_manual")),
    session: AsyncSession = Depends(get_session),
):
    """
    Records a NEW event. There is no edit path anywhere in this system.

    A duplicate returns 409, and the client treats that as success — the offline
    kiosk queue replays punches, and a retry must not be an error.
    """
    employee = (await session.execute(
        select(Employee).where(Employee.id == body.employeeId))).scalar_one_or_none()
    if employee is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Employee not found."}})

    direction = PunchDirection(body.direction)
    key = body.idempotencyKey or build_idempotency_key(str(body.employeeId), body.ts, direction)

    existing = (await session.execute(
        select(PunchEvent).where(PunchEvent.idempotency_key == key))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, detail={"error": {
            "code": "DUPLICATE_PUNCH", "message": "This punch already exists."}})

    punch = PunchEvent(
        employee_id=body.employeeId,
        ts=body.ts,
        direction=direction.value,
        source=body.source,
        confidence=None,
        idempotency_key=key,
    )
    session.add(punch)
    await session.flush()

    # A hand-entered punch is the one attendance record with no device behind
    # it. When somebody disputes their hours, "who typed this in, and when"
    # is the first question.
    await record_audit(
        session, actor_user_id=actor.user_id, action="punch.manual",
        entity="punch", entity_id=punch.id, request=request,
        after={"employee": employee.name, "direction": direction.value,
               "ts": body.ts, "source": body.source},
    )
    await session.commit()
    await session.refresh(punch)

    return Single(data=PunchEventOut(
        id=punch.id, employeeId=punch.employee_id, employeeName=employee.name,
        ts=punch.ts, direction=punch.direction.value, deviceId=None, deviceName=None,
        source=punch.source.value, confidence=None, photoRef=None,
    ))


@router.get("/dashboard/my-today", response_model=Single[MyAttendanceToday])
async def my_today(
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    today = local_today()
    now = local_now()

    employee = (await session.execute(
        select(Employee).where(Employee.id == actor.employee_id))).scalar_one()

    rows = [
        p for p in (await session.execute(
            select(PunchEvent).where(
                PunchEvent.employee_id == employee.id,
                func.date(PunchEvent.ts) >= today - timedelta(days=1),
                func.date(PunchEvent.ts) <= today + timedelta(days=1),
            ))
        ).scalars().all()
        if local_date_of(p.ts) == today
    ]

    shift = await _shift_rule(session, employee.shift_id)
    result = build_day(
        day=today,
        punches=[Punch(ts=to_local(p.ts), direction=PunchDirection(p.direction.value),
                       source=PunchSource(p.source.value)) for p in rows],
        shift=shift, now=now,
    )

    return Single(data=MyAttendanceToday(
        status=result.status.value,
        checkInAt=result.first_in,
        checkOutAt=result.last_out,
        workedMinutes=result.worked_minutes,
        shiftStart=shift.start_time.strftime("%H:%M"),
        shiftEnd=shift.end_time.strftime("%H:%M"),
        isLate=AttendanceFlag.LATE_IN in result.flags,
    ))
