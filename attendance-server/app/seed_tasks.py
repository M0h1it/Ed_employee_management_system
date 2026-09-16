"""
app/seed_tasks.py

Dated tasks, so the timeline has something to draw.

    python -m app.seed_tasks

DELIBERATELY UNEVEN
-------------------
Two people are overloaded, one has nothing, several tasks are overdue, some
overlap on the same days, and a few run past the edge of the two-week window.

Even data makes a chart look tidy and hides every layout problem it has:
clipped bars, stacked bars, and an empty row. All three are in here on purpose,
because all three are real states the chart has to render correctly.
"""

import asyncio
from datetime import date, timedelta

from sqlalchemy import delete, func, select

from app.core.db import SessionLocal, engine
from app.core.timeutil import local_today
from app.models import Employee, Task, TaskPriority, TaskStatus, User

# (emp_code, title, start offset, end offset, status, priority)
SEED: list[tuple[str, str, int, int, str, str]] = [
    ("EMP-0002", "Ship the kiosk enrolment endpoint", -4, 6, "in_progress", "high"),
    ("EMP-0002", "Review the punch idempotency design", -2, 1, "in_progress", "medium"),
    ("EMP-0002", "Write migration notes for the punch table", 7, 12, "todo", "low"),

    # Starts before the window opens — the bar must clip at the left edge, not
    # vanish. The work is still running.
    ("EMP-0003", "Reconcile October vendor invoices", -9, -2, "in_progress", "high"),
    ("EMP-0003", "Audit the biometric sensor sync log", -1, 2, "todo", "high"),
    ("EMP-0003", "Plan tomorrow's stock count", 3, 4, "todo", "medium"),

    ("EMP-0005", "Draft Q4 onboarding checklist", -3, 1, "done", "medium"),
    # Runs past the right edge of the two-week view.
    ("EMP-0005", "Marketplace inventory spec", 2, 24, "todo", "high"),

    ("EMP-0006", "Update the floor plan for the new desks", -6, -4, "done", "low"),

    ("EMP-0007", "Close out the support backlog", -5, -1, "in_progress", "medium"),
    ("EMP-0007", "Refresh the customer health dashboard", 1, 5, "todo", "low"),
    # These two overlap — the row has to stack them onto separate lines, which
    # is exactly the case worth seeing: somebody is double-booked.
    ("EMP-0007", "Draft the escalation playbook", 4, 9, "todo", "medium"),
    ("EMP-0007", "Weekly NPS review", 4, 6, "todo", "low"),

    ("EMP-0010", "Migrate the help centre articles", -1, 8, "in_progress", "medium"),

    # EMP-0008 (Jack) gets nothing. An empty row is a real state, and "free" is
    # half of what this chart is read for.
]


async def main() -> None:
    today = local_today()

    async with SessionLocal() as session:
        employees = {
            e.emp_code: e for e in (await session.execute(select(Employee))).scalars()
        }
        owner = (await session.execute(
            select(User).where(User.username == "owner"))).scalar_one_or_none()

        # Start clean so re-running does not pile duplicates on the chart.
        await session.execute(delete(Task))

        created = 0
        for code, title, start_offset, end_offset, status, priority in SEED:
            employee = employees.get(code)
            if employee is None:
                continue

            session.add(Task(
                employee_id=employee.id,
                assigned_by=owner.id if owner else None,
                title=title,
                description="",
                start_date=today + timedelta(days=start_offset),
                due_date=today + timedelta(days=end_offset),
                priority=TaskPriority(priority),
                status=TaskStatus(status),
                self_assigned=False,
            ))
            created += 1

        await session.commit()

        total = (await session.execute(select(func.count()).select_from(Task))).scalar_one()
        print(f"tasks: {total} ({created} dated)")
        print(f"window: {today - timedelta(days=9)} to {today + timedelta(days=24)}")
        print("includes: overdue, clipped at both edges, overlapping, and one empty row")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
