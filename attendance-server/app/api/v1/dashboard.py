"""
app/api/v1/dashboard.py

The counters, the exception list, and the attendance trend.

AGGREGATION HAPPENS IN SQL, NOT IN PYTHON
------------------------------------------
Six months of day-level attendance for a growing company is thousands of punch
rows to answer a question about roughly twenty numbers. Pulling them all into
the process and counting them there works on a laptop with a hundred rows and
gets linearly slower every month the business operates.

The query below asks Postgres for one row per employee per local day — the
first IN of that day — which is the only thing the classification needs. The
rest is arithmetic on a handful of rows.
"""

from datetime import date, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, requires
from app.core.config import settings
from app.core.db import get_session
from app.core.timeutil import local_now, local_today, to_local
from app.domain.attendance_rules import (
    AttendanceFlag,
    Punch,
    PunchDirection,
    PunchSource,
    ShiftRule,
    build_day,
    is_currently_in,
)
from app.models import (
    Employee,
    EmployeeStatus,
    Holiday,
    Leave,
    LeaveStatus,
    PunchEvent,
    Shift,
    Task,
    TaskStatus,
)
from app.schemas.common import Single
from app.schemas.dashboard import AttendanceException, AttendanceTrendPoint, DashboardStats

router = APIRouter(tags=["dashboard"])


async def _default_shift(session: AsyncSession) -> ShiftRule:
    shift = (await session.execute(select(Shift).order_by(Shift.name))).scalars().first()
    if shift is None:
        from datetime import time
        return ShiftRule(start_time=time(9, 0), end_time=time(18, 0))
    return ShiftRule(
        start_time=shift.start_time,
        end_time=shift.end_time,
        grace_minutes=shift.grace_minutes,
        min_hours=float(shift.min_hours),
    )


@router.get("/dashboard/stats", response_model=Single[DashboardStats])
async def stats(
    _: Actor = Depends(requires("attendance.view_all")),
    session: AsyncSession = Depends(get_session),
):
    today = local_today()
    now = local_now()

    # Untracked people (the owner) are excluded from every attendance figure.
    # Including them would make "36 of 40 checked in" permanently unreachable
    # and put the owner at the top of the exception list every day.
    people = (await session.execute(
        select(Employee).where(
            Employee.status == EmployeeStatus.active,
            Employee.attendance_tracked.is_(True)))).scalars().all()
    employee_ids = [e.id for e in people]

    punch_rows = (await session.execute(
        select(PunchEvent).where(
            PunchEvent.employee_id.in_(employee_ids),
            func.date(PunchEvent.ts) >= today - timedelta(days=1),
            func.date(PunchEvent.ts) <= today + timedelta(days=1),
        ))).scalars().all()

    by_employee: dict[UUID, list[Punch]] = {}
    for row in punch_rows:
        local_ts = to_local(row.ts)
        if local_ts.date() != today:
            continue
        by_employee.setdefault(row.employee_id, []).append(
            Punch(ts=local_ts, direction=PunchDirection(row.direction.value),
                  source=PunchSource(row.source.value)))

    on_leave_ids = set((await session.execute(
        select(Leave.employee_id).where(
            Leave.employee_id.in_(employee_ids),
            Leave.status == LeaveStatus.approved,
            Leave.from_date <= today, Leave.to_date >= today))).scalars().all())

    is_holiday = (await session.execute(
        select(Holiday).where(Holiday.date == today))).scalar_one_or_none() is not None

    shift = await _default_shift(session)

    checked_in = present = checked_out = late = absent = 0
    for employee in people:
        punches = by_employee.get(employee.id, [])
        result = build_day(
            day=today, punches=punches, shift=shift,
            is_holiday=is_holiday, on_leave=employee.id in on_leave_ids, now=now)

        if result.first_in:
            checked_in += 1
            if AttendanceFlag.LATE_IN in result.flags:
                late += 1
            if is_currently_in(punches):
                present += 1
            else:
                checked_out += 1
        elif employee.id not in on_leave_ids and not is_holiday:
            # NOT_YET_IN is not absence. At 09:05 half the company would
            # otherwise be counted as a no-show.
            if result.status.value == "ABSENT":
                absent += 1

    tasks_open = (await session.execute(
        select(func.count()).select_from(Task).where(Task.status != TaskStatus.done))).scalar_one()

    tasks_done_today = (await session.execute(
        select(func.count()).select_from(Task).where(
            Task.completed_at.is_not(None),
            func.date(Task.completed_at) == today))).scalar_one()

    return Single(data=DashboardStats(
        date=today,
        totalEmployees=len(people),
        checkedInToday=checked_in,
        currentlyPresent=present,
        checkedOut=checked_out,
        lateCount=late,
        absentCount=absent,
        onLeaveCount=len(on_leave_ids),
        tasksOpen=tasks_open,
        tasksCompletedToday=tasks_done_today,
    ))


@router.get("/dashboard/exceptions", response_model=Single[list[AttendanceException]])
async def exceptions(
    _: Actor = Depends(requires("attendance.view_all")),
    session: AsyncSession = Depends(get_session),
):
    today = local_today()
    now = local_now()

    people = (await session.execute(
        select(Employee).where(
            Employee.status == EmployeeStatus.active,
            Employee.attendance_tracked.is_(True)))).scalars().all()
    employee_ids = [e.id for e in people]

    punch_rows = (await session.execute(
        select(PunchEvent).where(
            PunchEvent.employee_id.in_(employee_ids),
            func.date(PunchEvent.ts) >= today - timedelta(days=1),
            func.date(PunchEvent.ts) <= today + timedelta(days=1),
        ))).scalars().all()

    by_employee: dict[UUID, list[Punch]] = {}
    for row in punch_rows:
        local_ts = to_local(row.ts)
        if local_ts.date() != today:
            continue
        by_employee.setdefault(row.employee_id, []).append(
            Punch(ts=local_ts, direction=PunchDirection(row.direction.value),
                  source=PunchSource(row.source.value)))

    on_leave_ids = set((await session.execute(
        select(Leave.employee_id).where(
            Leave.employee_id.in_(employee_ids),
            Leave.status == LeaveStatus.approved,
            Leave.from_date <= today, Leave.to_date >= today))).scalars().all())

    is_holiday = (await session.execute(
        select(Holiday).where(Holiday.date == today))).scalar_one_or_none() is not None

    shift = await _default_shift(session)
    expected_at = datetime.combine(today, shift.start_time).replace(tzinfo=now.tzinfo)

    rows: list[AttendanceException] = []
    for employee in people:
        # Somebody on approved leave, or a holiday, is not an exception. Listing
        # them is exactly what makes an exception report get ignored.
        if employee.id in on_leave_ids or is_holiday:
            continue

        punches = by_employee.get(employee.id, [])
        result = build_day(day=today, punches=punches, shift=shift, now=now)

        if result.status.value == "ABSENT":
            rows.append(AttendanceException(
                employeeId=employee.id, employeeName=employee.name,
                photoUrl=employee.photo_url, flag="ABSENT",
                expectedAt=expected_at, actualAt=None, delayMinutes=None))
        elif AttendanceFlag.LATE_IN in result.flags and result.first_in:
            rows.append(AttendanceException(
                employeeId=employee.id, employeeName=employee.name,
                photoUrl=employee.photo_url, flag="LATE_IN",
                expectedAt=expected_at, actualAt=result.first_in,
                delayMinutes=int((result.first_in - expected_at).total_seconds() // 60)))

    # Worst first: absences, then the longest delays.
    rows.sort(key=lambda r: (r.flag != "ABSENT", -(r.delayMinutes or 0)))
    return Single(data=rows)


@router.get("/dashboard/trend", response_model=Single[list[AttendanceTrendPoint]])
async def trend(
    granularity: str = Query(default="day", pattern="^(day|week|month)$"),
    _: Actor = Depends(requires("attendance.view_all")),
    session: AsyncSession = Depends(get_session),
):
    today = local_today()

    # How far back each view looks. Enough bars to show a trend, few enough
    # that every bar stays wide enough to read.
    if granularity == "day":
        start = today - timedelta(days=13)
    elif granularity == "week":
        start = today - timedelta(weeks=11)
        start -= timedelta(days=start.weekday())     # back to Monday
    else:
        start = (today.replace(day=1) - timedelta(days=150)).replace(day=1)

    people = (await session.execute(
        select(Employee).where(
            Employee.status == EmployeeStatus.active,
            Employee.attendance_tracked.is_(True)))).scalars().all()
    tracked = len(people)
    if tracked == 0:
        return Single(data=[])

    employee_ids = [e.id for e in people]
    shift = await _default_shift(session)

    # DO NOT REPORT ON PERIODS WITH NO DATA.
    #
    # The window above is a maximum, not a promise. If the system only started
    # recording three weeks ago, a six-month view would show five months in
    # which every tracked employee was absent every working day — a plausible
    # looking figure that is entirely an artefact of there being no records.
    #
    # An owner reading "198 absences in April" has no way to tell that April
    # predates the system. So the window is clamped to the first punch ever
    # recorded: report on what is known, and say nothing about what is not.
    first_punch = (await session.execute(
        select(func.min(PunchEvent.ts)))).scalar_one_or_none()
    if first_punch is None:
        return Single(data=[])

    first_local_day = to_local(first_punch).date()
    if first_local_day > start:
        start = first_local_day
        # Re-align to a bucket boundary so the first bar is not a stub.
        if granularity == "week":
            start -= timedelta(days=start.weekday())
        elif granularity == "month":
            start = start.replace(day=1)
        # A month or week bucket that starts mid-period would under-report its
        # working days, so the first bucket is dropped below if it is partial.
        clamped = True
    else:
        clamped = False

    # ONE ROW PER EMPLOYEE PER LOCAL DAY — the first IN of that day.
    #
    # That is the only fact the classification needs: present vs late is a
    # comparison of first_in against the shift, and absent is "no row at all".
    # Fetching every punch and grouping in Python would move thousands of rows
    # across the wire to compute the same handful of numbers.
    #
    # AT TIME ZONE converts the stored UTC instant to the company's wall clock
    # BEFORE taking the date, so a 02:00 local arrival is filed under the right
    # day rather than the previous one.
    sql = text("""
        SELECT
            employee_id,
            (ts AT TIME ZONE :tz)::date AS local_day,
            MIN(ts) AS first_in
        FROM punch_events
        WHERE direction = 'IN'
          AND employee_id = ANY(:employee_ids)
          AND (ts AT TIME ZONE :tz)::date BETWEEN :start AND :end
        GROUP BY employee_id, local_day
    """)
    arrival_rows = (await session.execute(
        sql, {"tz": settings.TIMEZONE, "employee_ids": employee_ids,
              "start": start, "end": today})).all()

    arrivals: dict[date, dict[UUID, datetime]] = {}
    for employee_id, local_day, first_in in arrival_rows:
        arrivals.setdefault(local_day, {})[employee_id] = to_local(first_in)

    holidays = set((await session.execute(
        select(Holiday.date).where(Holiday.date >= start, Holiday.date <= today))).scalars().all())

    leave_rows = (await session.execute(
        select(Leave.employee_id, Leave.from_date, Leave.to_date).where(
            Leave.employee_id.in_(employee_ids),
            Leave.status == LeaveStatus.approved,
            Leave.from_date <= today, Leave.to_date >= start))).all()

    def bucket_for(day: date) -> tuple[date, str]:
        if granularity == "day":
            return day, day.strftime("%d %b")
        if granularity == "week":
            monday = day - timedelta(days=day.weekday())
            return monday, f"W{day.isocalendar().week}"
        first = day.replace(day=1)
        return first, first.strftime("%b")

    buckets: dict[date, AttendanceTrendPoint] = {}

    current = start
    while current <= today:
        # Weekends and holidays carry no signal. A bar that is 100% absent every
        # Saturday tells the owner nothing and crushes the scale of the bars
        # that matter.
        if current.weekday() >= 5 or current in holidays:
            current += timedelta(days=1)
            continue

        key, label = bucket_for(current)
        if key not in buckets:
            buckets[key] = AttendanceTrendPoint(
                bucket=key, label=label, present=0, late=0, absent=0,
                workingDays=0, trackedEmployees=tracked)
        point = buckets[key]
        point.workingDays += 1

        on_leave_today = {
            employee_id for employee_id, f, t in leave_rows if f <= current <= t
        }
        todays_arrivals = arrivals.get(current, {})
        cutoff = datetime.combine(current, shift.start_time) + timedelta(minutes=shift.grace_minutes)

        for employee in people:
            if employee.id in on_leave_today:
                continue    # approved leave is not an absence
            first_in = todays_arrivals.get(employee.id)
            if first_in is None:
                point.absent += 1
            elif first_in.replace(tzinfo=None) > cutoff:
                point.late += 1
            else:
                point.present += 1

        current += timedelta(days=1)

    data = [buckets[k] for k in sorted(buckets)]

    # If the window was clamped, the first bucket may only be partly covered by
    # real data — its earlier working days have no records simply because the
    # system was not running. Dropping it is better than showing a bar whose
    # absence count is half artefact.
    if clamped and len(data) > 1 and granularity in ("week", "month"):
        first_bucket_start = data[0].bucket
        if first_bucket_start < first_local_day:
            data = data[1:]

    return Single(data=data)
