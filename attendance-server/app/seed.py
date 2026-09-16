"""
app/seed.py

Fills an empty database with everything needed to sign in and look around.

    python -m app.seed

IDEMPOTENT ON PURPOSE
----------------------
Running it twice must not create a second Owner or duplicate every permission.
Each step looks before it inserts, so this is safe to run after a migration, on
a colleague's machine, or in CI — and nobody has to remember whether it has
already been run here.

It does NOT wipe anything. A seed script that drops tables is one careless
command away from erasing a real database.
"""

import asyncio
from datetime import date, time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal, engine
from app.core.permissions import PERMISSIONS, SEED_ROLES
from app.core.security import hash_password
from app.models import (
    Department,
    Employee,
    EmployeeStatus,
    Permission,
    Role,
    Shift,
    User,
)

DEPARTMENTS = ["Engineering", "Operations", "Product", "Customer Success"]

# (emp_code, name, email, phone, department, position, tracked, login, role)
PEOPLE = [
    ("EMP-0001", "Elena Vance", "elena.vance@nexusops.com", "9810012001",
     "Operations", "Founder", False, "owner", "Owner"),
    ("EMP-0002", "Marcus Ray", "marcus.ray@nexusops.com", "9810012002",
     "Engineering", "Senior Engineer", True, "marcus", "Manager"),
    ("EMP-0003", "Karan Patel", "karan.patel@nexusops.com", "9810012003",
     "Operations", "Operations Executive", True, "karan", "Employee"),
    ("EMP-0004", "Sofia Lindqvist", "sofia.l@nexusops.com", "9810012004",
     "Operations", "Operations Lead", True, None, None),
    ("EMP-0005", "Priya Raman", "priya.raman@nexusops.com", "9810012005",
     "Product", "Product Manager", True, "priya", "Employee"),
    ("EMP-0006", "David Chen", "david.chen@nexusops.com", "9810012006",
     "Product", "Designer", True, "david", "Employee"),
    ("EMP-0007", "Amina Ndiaye", "amina.n@nexusops.com", "9810012007",
     "Customer Success", "Support Specialist", True, "amina", "Employee"),
    ("EMP-0008", "Jack Lawson", "jack.lawson@nexusops.com", "9810012008",
     "Engineering", "Engineer", True, "jack", "Employee"),
    ("EMP-0009", "Talia Brooks", "talia.brooks@nexusops.com", "9810012009",
     "Product", "Analyst", True, None, None),
    ("EMP-0010", "Rachel Wong", "rachel.wong@nexusops.com", "9810012010",
     "Customer Success", "Support Specialist", True, "rachel", "Employee"),
]

DEMO_PASSWORDS = {"owner": "owner123", "marcus": "demo123"}
DEFAULT_PASSWORD = "demo123"


async def seed_permissions(session: AsyncSession) -> dict[str, Permission]:
    existing = {
        p.code: p for p in (await session.execute(select(Permission))).scalars()
    }
    for definition in PERMISSIONS:
        if definition.code in existing:
            # Keep the text in step with the code, which is the source of truth.
            existing[definition.code].label = definition.label
            existing[definition.code].description = definition.description
            continue
        permission = Permission(
            code=definition.code,
            module=definition.module,
            label=definition.label,
            description=definition.description,
        )
        session.add(permission)
        existing[definition.code] = permission

    await session.flush()
    print(f"  permissions: {len(existing)}")
    return existing


async def seed_roles(session: AsyncSession, permissions: dict[str, Permission]) -> dict[str, Role]:
    existing = {r.name: r for r in (await session.execute(select(Role))).scalars()}

    for name, spec in SEED_ROLES.items():
        role = existing.get(name)
        if role is None:
            role = Role(name=name, description=spec["description"], is_system=spec["is_system"])
            session.add(role)
            existing[name] = role

        # Permission sets are reset to match the code. A role edited through the
        # UI will be overwritten by a reseed — acceptable in development, and
        # the reason this script is not for production.
        role.permissions = [permissions[code] for code in spec["permissions"]]

    await session.flush()
    for name, role in existing.items():
        print(f"  role {name}: {len(role.permissions)} permissions")
    return existing


async def seed_org(session: AsyncSession) -> tuple[dict[str, Department], Shift]:
    departments = {
        d.name: d for d in (await session.execute(select(Department))).scalars()
    }
    for name in DEPARTMENTS:
        if name not in departments:
            department = Department(name=name)
            session.add(department)
            departments[name] = department

    shift = (await session.execute(select(Shift).where(Shift.name == "General"))).scalar_one_or_none()
    if shift is None:
        shift = Shift(
            name="General",
            start_time=time(9, 0),
            end_time=time(18, 0),
            grace_minutes=15,
            min_hours=8,
        )
        session.add(shift)

    await session.flush()
    print(f"  departments: {len(departments)}   shift: {shift.name} {shift.start_time}-{shift.end_time}")
    return departments, shift


async def seed_people(
    session: AsyncSession,
    departments: dict[str, Department],
    shift: Shift,
    roles: dict[str, Role],
) -> None:
    existing = {
        e.emp_code: e for e in (await session.execute(select(Employee))).scalars()
    }
    existing_users = {
        u.username: u for u in (await session.execute(select(User))).scalars()
    }

    created_people = 0
    created_logins = 0

    for code, name, email, phone, dept, position, tracked, username, role_name in PEOPLE:
        employee = existing.get(code)
        if employee is None:
            employee = Employee(
                emp_code=code,
                name=name,
                email=email,
                phone=phone,
                department_id=departments[dept].id,
                position=position,
                shift_id=shift.id,
                join_date=date(2023, 1, 1),
                status=EmployeeStatus.active,
                attendance_tracked=tracked,
            )
            session.add(employee)
            await session.flush()
            existing[code] = employee
            created_people += 1

        if username and username not in existing_users:
            password = DEMO_PASSWORDS.get(username, DEFAULT_PASSWORD)
            user = User(
                employee_id=employee.id,
                username=username,
                password_hash=hash_password(password),
                role_id=roles[role_name].id,
                is_active=True,
                must_change_password=False,
            )
            session.add(user)
            existing_users[username] = user
            created_logins += 1

    await session.flush()
    print(f"  employees: {len(existing)} (+{created_people} new)")
    print(f"  logins:    {len(existing_users)} (+{created_logins} new)")


async def main() -> None:
    print("Seeding…")
    async with SessionLocal() as session:
        permissions = await seed_permissions(session)
        roles = await seed_roles(session, permissions)
        departments, shift = await seed_org(session)
        await seed_people(session, departments, shift, roles)
        await session.commit()
    await engine.dispose()

    print("\nDone. Sign in with:")
    print("  owner  / owner123   — full access")
    print("  marcus / demo123    — manager")
    print("  karan  / demo123    — employee")


if __name__ == "__main__":
    asyncio.run(main())
