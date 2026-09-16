"""
app/seed_punches.py

Generates fourteen working days of punch history, plus one approved leave and
one holiday.

    python -m app.seed_punches

DELIBERATELY MESSY
------------------
Two people are chronically late, one forgets to punch out, one is absent, one
leaves early, one has a manual entry. Every flag the system can raise appears
somewhere in here on purpose.

Clean seed data produces a demo that looks great and a UI that has never
rendered a warning row — and the first real warning then arrives in production,
in front of somebody who matters.

Deterministic: a fixed seed means the data is identical on every run, so a bug
somebody reports can actually be reproduced.
"""

import asyncio
import random
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import delete, func, select

from app.core.db import SessionLocal, engine
from app.domain.attendance_rules import PunchDirection, build_idempotency_key
from app.models import (
    Employee,
    EmployeeStatus,
    Holiday,
    Leave,
    LeaveStatus,
    LeaveType,
    PunchEvent,
    PunchSource,
)

DAYS_OF_HISTORY = 14
IST = timezone(timedelta(hours=5, minutes=30))

# Per-person behaviour, so the data tells a consistent story over time rather
# than being random noise that happens to contain a late arrival.
PROFILES = {
    "EMP-0002": dict(in_base=8 * 60 + 40, spread=20, hours=9.0, absent=0.03, forget_out=0.05),
    "EMP-0003": dict(in_base=9 * 60 + 25, spread=18, hours=8.5, absent=0.05, forget_out=0.10),
    "EMP-0004": dict(in_base=8 * 60 + 50, spread=12, hours=9.0, absent=0.00, forget_out=0.00),
    "EMP-0005": dict(in_base=9 * 60 + 20, spread=25, hours=8.0, absent=0.08, forget_out=0.05),
    "EMP-0006": dict(in_base=9 * 60 + 5, spread=15, hours=8.5, absent=0.05, forget_out=0.00),
    "EMP-0007": dict(in_base=8 * 60 + 55, spread=10, hours=9.0, absent=0.02, forget_out=0.03),
    "EMP-0008": dict(in_base=9 * 60 + 30, spread=30, hours=7.5, absent=0.10, forget_out=0.10),
    "EMP-0009": dict(in_base=8 * 60 + 58, spread=12, hours=8.5, absent=0.00, forget_out=0.00),
    "EMP-0010": dict(in_base=9 * 60 + 2, spread=14, hours=8.5, absent=0.03, forget_out=0.02),
}


def at(day: date, minutes_from_midnight: int) -> datetime:
    hour, minute = divmod(int(minutes_from_midnight), 60)
    return datetime.combine(day, time(hour % 24, minute), tzinfo=IST)


async def main() -> None:
    rng = random.Random(20260915)
    today = datetime.now(IST).date()
    now_minutes = datetime.now(IST).hour * 60 + datetime.now(IST).minute

    async with SessionLocal() as session:
        people = (
            await session.execute(
                select(Employee).where(
                    Employee.status == EmployeeStatus.active,
                    Employee.attendance_tracked.is_(True),
                )
            )
        ).scalars().all()
        by_code = {e.emp_code: e for e in people}

        # Start clean so re-running does not pile history on history.
        await session.execute(delete(PunchEvent))
        await session.execute(delete(Leave))
        await session.execute(delete(Holiday))

        # A holiday four working days back — proves a company-wide zero-punch
        # day is reported as HOLIDAY, not as everybody being absent.
        holiday_date = today - timedelta(days=4)
        while holiday_date.weekday() >= 5:
            holiday_date -= timedelta(days=1)
        session.add(Holiday(date=holiday_date, name="Company holiday"))

        # Approved leave for one person — proves ON_LEAVE is not ABSENT.
        leave_person = by_code.get("EMP-0007")
        leave_from = today - timedelta(days=2)
        if leave_person:
            session.add(Leave(
                employee_id=leave_person.id,
                from_date=leave_from,
                to_date=leave_from,
                type=LeaveType.casual,
                reason="Family commitment",
                status=LeaveStatus.approved,
            ))

        created = 0
        for offset in range(DAYS_OF_HISTORY - 1, -1, -1):
            day = today - timedelta(days=offset)
            if day.weekday() >= 5:
                continue
            if day == holiday_date:
                continue

            is_today = day == today

            for code, profile in PROFILES.items():
                employee = by_code.get(code)
                if employee is None:
                    continue
                if leave_person and employee.id == leave_person.id and day == leave_from:
                    continue  # on leave, no punches
                if rng.random() < profile["absent"]:
                    continue

                in_minutes = round(profile["in_base"] + (rng.random() - 0.5) * 2 * profile["spread"])
                if is_today and in_minutes > now_minutes:
                    continue

                # One manual entry, so the MANUAL_ENTRY flag appears somewhere.
                source = (
                    PunchSource.manual
                    if code == "EMP-0004" and offset == 3
                    else PunchSource.kiosk
                )

                ts_in = at(day, in_minutes)
                session.add(PunchEvent(
                    employee_id=employee.id, ts=ts_in, direction=PunchDirection.IN.value,
                    source=source,
                    confidence=None if source == PunchSource.manual else round(0.82 + rng.random() * 0.16, 2),
                    idempotency_key=build_idempotency_key(str(employee.id), ts_in, PunchDirection.IN),
                ))
                created += 1

                out_minutes = round(in_minutes + profile["hours"] * 60 + (rng.random() - 0.5) * 40)
                if rng.random() < profile["forget_out"]:
                    continue           # forgot to punch out
                if is_today and out_minutes > now_minutes:
                    continue           # still inside

                ts_out = at(day, out_minutes)
                session.add(PunchEvent(
                    employee_id=employee.id, ts=ts_out, direction=PunchDirection.OUT.value,
                    source=PunchSource.kiosk,
                    confidence=round(0.82 + rng.random() * 0.16, 2),
                    idempotency_key=build_idempotency_key(str(employee.id), ts_out, PunchDirection.OUT),
                ))
                created += 1

        await session.commit()

        total = (await session.execute(select(func.count()).select_from(PunchEvent))).scalar_one()
        print(f"punch events: {total}")
        print(f"holiday:      {holiday_date}")
        print(f"leave:        {leave_person.name if leave_person else '-'} on {leave_from}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
