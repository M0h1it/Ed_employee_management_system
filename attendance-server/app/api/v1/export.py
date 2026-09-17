"""
app/api/v1/export.py

Attendance as a CSV file.

WHY THIS IS NEEDED BEFORE THE SHADOW RUN
-----------------------------------------
Phase 4 means running this alongside the existing manual register for three or
four weeks and comparing them. That comparison happens in a spreadsheet, and
without an export it happens by somebody reading a screen and typing numbers —
which introduces exactly the kind of transcription error the comparison exists
to detect.
"""

import csv
import io
from datetime import date, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, requires
from app.core.db import get_session
from app.core.timeutil import local_now, to_local
from app.domain.attendance_rules import (
    FLAG_LABELS,
    AttendanceFlag,
    Punch,
    PunchDirection,
    PunchSource,
    ShiftRule,
    build_day,
)
from app.models import (
    Employee,
    EmployeeStatus,
    Holiday,
    Leave,
    LeaveStatus,
    PunchEvent,
    Shift,
)

router = APIRouter(tags=["export"])

MAX_RANGE_DAYS = 92


def _minutes_to_hours(minutes: int) -> str:
    """
    7.5, not 7:30.

    A spreadsheet can sum a decimal. It cannot sum "7:30" without a formula
    somebody has to remember to write, and the export exists to be summed.
    """
    return f"{minutes / 60:.2f}"


@router.get("/attendance/export")
async def export_attendance(
    dateFrom: date,
    dateTo: date,
    employeeId: UUID | None = None,
    departmentId: UUID | None = None,
    actor: Actor = Depends(requires("attendance.view_all")),
    session: AsyncSession = Depends(get_session),
):
    if dateTo < dateFrom:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "dateTo cannot be before dateFrom."}})
    if (dateTo - dateFrom).days > MAX_RANGE_DAYS:
        raise HTTPException(422, detail={"error": {
            "code": "RANGE_TOO_WIDE",
            "message": f"Choose a range of {MAX_RANGE_DAYS} days or fewer."}})

    people_stmt = (
        select(Employee)
        .options(selectinload(Employee.department))
        .where(Employee.status == EmployeeStatus.active,
               Employee.attendance_tracked.is_(True))
    )
    if employeeId:
        people_stmt = people_stmt.where(Employee.id == employeeId)
    if departmentId:
        people_stmt = people_stmt.where(Employee.department_id == departmentId)

    people = (await session.execute(people_stmt.order_by(Employee.name))).scalars().all()
    employee_ids = [e.id for e in people]

    punch_rows = (await session.execute(
        select(PunchEvent).where(
            PunchEvent.employee_id.in_(employee_ids),
            func.date(PunchEvent.ts) >= dateFrom - timedelta(days=1),
            func.date(PunchEvent.ts) <= dateTo + timedelta(days=1),
        ))).scalars().all() if employee_ids else []

    by_day: dict[tuple[UUID, date], list[Punch]] = {}
    for row in punch_rows:
        local_ts = to_local(row.ts)
        by_day.setdefault((row.employee_id, local_ts.date()), []).append(
            Punch(ts=local_ts, direction=PunchDirection(row.direction.value),
                  source=PunchSource(row.source.value)))

    holidays = set((await session.execute(
        select(Holiday.date).where(Holiday.date >= dateFrom, Holiday.date <= dateTo))
    ).scalars().all())

    leaves = (await session.execute(
        select(Leave).where(
            Leave.employee_id.in_(employee_ids),
            Leave.status == LeaveStatus.approved,
            Leave.from_date <= dateTo, Leave.to_date >= dateFrom))
    ).scalars().all() if employee_ids else []

    shift_row = (await session.execute(select(Shift).order_by(Shift.name))).scalars().first()
    from datetime import time as _time
    shift = ShiftRule(
        start_time=shift_row.start_time if shift_row else _time(9, 0),
        end_time=shift_row.end_time if shift_row else _time(18, 0),
        grace_minutes=shift_row.grace_minutes if shift_row else 15,
        min_hours=float(shift_row.min_hours) if shift_row else 8.0,
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "Employee code", "Name", "Department", "Date", "Day",
        "First in", "Last out", "Hours", "Status", "Exceptions", "Punches",
    ])

    now = local_now()
    current = dateFrom
    while current <= dateTo:
        for employee in people:
            on_leave = any(
                l.employee_id == employee.id and l.from_date <= current <= l.to_date
                for l in leaves
            )
            result = build_day(
                day=current,
                punches=by_day.get((employee.id, current), []),
                shift=shift,
                is_holiday=current in holidays,
                on_leave=on_leave,
                now=now,
            )

            # Weekends are written out too, unlike the on-screen register.
            # A spreadsheet comparison against a paper register needs every
            # calendar day present, or the rows stop lining up.
            writer.writerow([
                employee.emp_code,
                employee.name,
                employee.department.name if employee.department else "",
                # Wrapped as an Excel formula (="2026-09-17") rather than a
                # bare "2026-09-17" — a plain ISO date string is exactly
                # what triggers Excel's own date auto-detection on CSV
                # import, which then applies ITS OWN default date format
                # (often a locale-specific one) at a column width that was
                # never set for it, producing the "####" overflow display.
                # The ="..." form forces Excel to treat the cell as text
                # from the start, so the date renders exactly as written,
                # at whatever width the column already is.
                f'="{current.isoformat()}"',
                current.strftime("%a"),
                result.first_in.strftime("%H:%M") if result.first_in else "",
                result.last_out.strftime("%H:%M") if result.last_out else "",
                _minutes_to_hours(result.worked_minutes),
                result.status.value,
                # Human labels, not enum names. This file is read by somebody
                # doing payroll, not by a program.
                "; ".join(FLAG_LABELS[AttendanceFlag(f.value)] for f in result.flags),
                result.punch_count,
            ])
        current += timedelta(days=1)

    buffer.seek(0)
    filename = f"attendance-{dateFrom}-to-{dateTo}.csv"

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={
            # attachment, so the browser saves it rather than rendering it.
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )