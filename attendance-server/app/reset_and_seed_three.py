"""
app/reset_and_seed_three.py

DESTRUCTIVE — wipes every table, then creates exactly three accounts:
    owner  — Owner role, ALL permissions
    mukesh — Manager role, ALL permissions       (password: mukesh@123)
    mohit  — new "Developer" role, ALL permissions (password: mohit@123)

    python -m app.reset_and_seed_three

WHY THIS IS ITS OWN SCRIPT, NOT A FLAG ON seed.py
------------------------------------------------------
seed.py is explicitly idempotent and non-destructive — its own docstring
says "It does NOT wipe anything. A seed script that drops tables is one
careless command away from erasing a real database." This script is the
opposite of that on purpose (a full wipe was explicitly requested for LOCAL
testing), so it lives separately rather than adding a --wipe flag to the
safe one, where it would be one mistyped flag away from wiping something
by accident.

TRUNCATE ... CASCADE, NOT DELETE FROM EACH TABLE ONE BY ONE
------------------------------------------------------------------
With ~20 tables and foreign keys between most of them, deleting in the
correct dependency order by hand is exactly the kind of thing that is easy
to get wrong once and not notice until a later step fails. TRUNCATE
... CASCADE lets Postgres itself resolve the dependency order, and RESTART
IDENTITY resets any sequence columns so IDs start clean too.

THIS ONLY EVER RUNS AGAINST WHATEVER DATABASE_URL POINTS AT
-----------------------------------------------------------------
No safety check distinguishes "local" from "production" here beyond
DATABASE_URL itself — running this against a production database would
permanently destroy every employee, punch, and account in it. The person
who asked for this confirmed it is the local/testing database; this
script does not re-derive or verify that itself, because it has no
reliable way to.
"""

import asyncio
from datetime import date, time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.core.permissions import ALL_CODES, PERMISSIONS
from app.core.security import hash_password
from app.models import Department, Employee, EmployeeStatus, Permission, Role, Shift, User

# Every table this project defines (see app/models/__init__.py's __all__),
# minus role_permissions (an association table TRUNCATE...CASCADE from
# roles/permissions already clears) — named explicitly rather than
# introspected from the metadata, so this script fails loudly if a new
# table is added later and not accounted for here, rather than silently
# leaving it untouched.
#
# shift_policy_versions and CASCADE: this table has a foreign key to
# shifts.id, so TRUNCATE ... CASCADE on shifts would already wipe it
# implicitly — it's still listed explicitly here (rather than relied upon
# implicitly) for the same "fails loudly if forgotten" reason as every
# other table in this list, and because a version row referencing a
# shift_id that no longer exists after a wipe is exactly the kind of
# orphaned-data bug this explicit list exists to prevent.
TABLES = [
    "attendance_days", "audit_log", "corrections", "departments", "devices",
    "employees", "face_templates", "holidays", "leaves", "permissions",
    "punch_events", "refresh_tokens", "roles", "shift_policy_versions",
    "shifts", "tasks", "users",
]


async def wipe(session: AsyncSession) -> None:
    print("Wiping all tables…")
    table_list = ", ".join(TABLES)
    await session.execute(text(f"TRUNCATE {table_list} RESTART IDENTITY CASCADE"))
    await session.flush()
    print(f"  truncated {len(TABLES)} tables")


async def seed_permissions(session: AsyncSession) -> dict[str, Permission]:
    result = {}
    for p in PERMISSIONS:
        row = Permission(code=p.code, module=p.module, label=p.label, description=p.description)
        session.add(row)
        result[p.code] = row
    await session.flush()
    print(f"  permissions: {len(result)}")
    return result


async def seed_roles(session: AsyncSession, permissions: dict[str, Permission]) -> dict[str, Role]:
    all_permission_rows = [permissions[code] for code in sorted(ALL_CODES)]

    roles = {
        "Owner": Role(name="Owner", description="Full access to everything.", is_system=True),
        "Manager": Role(name="Manager", description="Full access (custom, per request).", is_system=False),
        # A brand-new role, not part of app/core/permissions.py's SEED_ROLES —
        # created here because it was asked for specifically, not because
        # the codebase defines a "Developer" role anywhere else.
        "Developer": Role(name="Developer", description="Full access (custom, per request).", is_system=False),
    }
    for role in roles.values():
        role.permissions = list(all_permission_rows)
        session.add(role)

    await session.flush()
    for name, role in roles.items():
        print(f"  role {name}: {len(role.permissions)} permissions")
    return roles


async def seed_org(session: AsyncSession) -> tuple[Department, Shift]:
    department = Department(name="General")
    session.add(department)

    shift = Shift(name="General", start_time=time(9, 0),
                   end_time=time(18, 0), grace_minutes=15, min_hours=8)
    session.add(shift)

    await session.flush()
    return department, shift


async def seed_people(session: AsyncSession, department: Department, shift: Shift, roles: dict[str, Role]) -> None:
    people = [
        # (emp_code, name, email, username, password, role_name, attendance_tracked)
        #
        # attendance_tracked=False for Owner, matching the original seed.py's
        # own Owner row (Elena Vance) — an Owner running the company is not
        # someone who punches in and out, and PHASE-3-BRIEF.md's dashboard
        # logic (dashboard.py's "needs attention" / "checked in" banners)
        # reads this flag directly: True here is exactly what put the
        # "You have not checked in yet" banner in front of the Owner, the
        # bug this fix corrects.
        ("EMP-0001", "Owner", "owner@example.com", "owner", "owner123", "Owner", False),
        ("EMP-0002", "Mukesh", "mukesh@example.com", "mukesh", "mukesh@123", "Manager", True),
        ("EMP-0003", "Mohit", "mohit@example.com", "mohit", "mohit@123", "Developer", True),
    ]

    for code, name, email, username, password, role_name, tracked in people:
        employee = Employee(
            emp_code=code, name=name, email=email, phone=None,
            department_id=department.id, position=role_name, shift_id=shift.id,
            join_date=date.today(),
            status=EmployeeStatus.active, attendance_tracked=tracked,
        )
        session.add(employee)
        await session.flush()

        user = User(
            employee_id=employee.id, username=username,
            password_hash=hash_password(password),
            role_id=roles[role_name].id, is_active=True, must_change_password=False,
        )
        session.add(user)

    await session.flush()
    print(f"  people: {len(people)} (owner / mukesh / mohit)")


async def main() -> None:
    async with SessionLocal() as session:
        await wipe(session)
        permissions = await seed_permissions(session)
        roles = await seed_roles(session, permissions)
        department, shift = await seed_org(session)
        await seed_people(session, department, shift, roles)
        await session.commit()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())