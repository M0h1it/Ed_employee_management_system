"""
app/api/v1/employees.py

The directory: list, read, create, update.

EVERY ROUTE DECLARES ITS PERMISSION
------------------------------------
The Depends(requires(...)) on each route is the actual access control. The
frontend hides menu items and buttons, but that stops nobody from calling these
URLs directly — an endpoint without a guard is open to anyone holding a valid
token, whatever the UI shows.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor, requires
from app.core.audit import record_audit
from app.core.db import get_session
from app.models import Department, Employee, EmployeeStatus, FaceTemplate, Role, Shift, User
from app.schemas.common import Paginated, Single, page_meta
from app.schemas.employee import EmployeeCreate, EmployeeOut, EmployeeUpdate

router = APIRouter(tags=["employees"])


async def _load_extras(
    session: AsyncSession, employee_ids: list[UUID]
) -> tuple[dict[UUID, User], set[UUID]]:
    """
    Loads the login account and face-enrolment status for a WHOLE PAGE of
    employees in two queries.

    WHY THIS EXISTS — the N+1 problem
    ----------------------------------
    The obvious way to build each row is to query for that employee's user and
    face count inside the loop. Ten employees then cost 1 + 10 + 10 = 21
    queries; a hundred cost 201. Every one is a network round-trip, and the
    page gets linearly slower as the company grows — invisible on a laptop with
    ten rows and a local database, painful in production.

    Two queries with `IN (...)`, then a dictionary lookup per row, is the same
    answer at constant cost.
    """
    if not employee_ids:
        return {}, set()

    users = (
        await session.execute(
            select(User)
            .options(selectinload(User.role))
            .where(User.employee_id.in_(employee_ids))
        )
    ).scalars().all()
    users_by_employee = {u.employee_id: u for u in users}

    enrolled = set(
        (
            await session.execute(
                select(FaceTemplate.employee_id)
                .where(
                    FaceTemplate.employee_id.in_(employee_ids),
                    FaceTemplate.is_active.is_(True),
                )
                .distinct()
            )
        ).scalars().all()
    )

    return users_by_employee, enrolled


def _to_out(
    employee: Employee,
    users_by_employee: dict[UUID, User],
    enrolled: set[UUID],
) -> EmployeeOut:
    """Pure assembly — no queries. Everything it needs was loaded in a batch."""
    user = users_by_employee.get(employee.id)

    return EmployeeOut(
        id=employee.id,
        empCode=employee.emp_code,
        name=employee.name,
        email=employee.email,
        phone=employee.phone,
        photoUrl=employee.photo_url,
        departmentId=employee.department_id,
        departmentName=employee.department.name if employee.department else "",
        position=employee.position,
        shiftId=employee.shift_id,
        joinDate=employee.join_date,
        status=employee.status.value,
        faceEnrolled=employee.id in enrolled,
        hasLogin=user is not None,
        roleName=user.role.name if user else None,
        attendanceTracked=employee.attendance_tracked,
    )


async def _to_out_one(session: AsyncSession, employee: Employee) -> EmployeeOut:
    """Single-row convenience for the detail, create and update endpoints."""
    users_by_employee, enrolled = await _load_extras(session, [employee.id])
    return _to_out(employee, users_by_employee, enrolled)


def _next_emp_code(highest: str | None) -> str:
    """EMP-0011 after EMP-0010. Padded so codes sort correctly as text."""
    if not highest:
        return "EMP-0001"
    try:
        number = int(highest.split("-")[-1]) + 1
    except ValueError:
        number = 1
    return f"EMP-{number:04d}"


@router.get("/employees", response_model=Paginated[EmployeeOut])
async def list_employees(
    search: str | None = None,
    departmentId: UUID | None = None,
    employeeStatus: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=10, ge=1, le=100),
    actor: Actor = Depends(requires("employees.view_all")),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(Employee).options(selectinload(Employee.department))

    if search:
        # ilike is case-insensitive. Somebody typing "karan" should find
        # "Karan Patel" — requiring the right case in a search box is a bug.
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Employee.name.ilike(pattern),
                Employee.emp_code.ilike(pattern),
                Employee.email.ilike(pattern),
            )
        )
    if departmentId:
        stmt = stmt.where(Employee.department_id == departmentId)
    if employeeStatus:
        stmt = stmt.where(Employee.status == EmployeeStatus(employeeStatus))

    # COUNT runs on the filtered query but WITHOUT the ordering or the page
    # slice — counting a sorted, sliced result would just return the page size.
    total = (
        await session.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()

    stmt = stmt.order_by(Employee.name).offset((page - 1) * pageSize).limit(pageSize)
    rows = (await session.execute(stmt)).scalars().all()

    # Two queries for the whole page, not two per row.
    users_by_employee, enrolled = await _load_extras(session, [e.id for e in rows])

    return Paginated(
        data=[_to_out(e, users_by_employee, enrolled) for e in rows],
        meta=page_meta(page=page, page_size=pageSize, total=total),
    )


@router.get("/employees/{employee_id}", response_model=Single[EmployeeOut])
async def get_employee(
    employee_id: UUID,
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    """
    ROW-LEVEL SCOPING, NOT JUST A PERMISSION CHECK
    -----------------------------------------------
    Anyone signed in may read their OWN record — that is what the profile page
    needs. Reading somebody else's requires employees.view_all.

    A plain requires("employees.view_all") here would lock every employee out of
    their own profile. This is the difference between checking whether an action
    is allowed and checking whether it is allowed on THIS row, and it is the
    check people most often forget.
    """
    if employee_id != actor.employee_id and not actor.can("employees.view_all"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "FORBIDDEN",
                              "message": "You can only view your own record."}},
        )

    employee = (
        await session.execute(
            select(Employee)
            .options(selectinload(Employee.department))
            .where(Employee.id == employee_id)
        )
    ).scalar_one_or_none()

    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "NOT_FOUND", "message": "Employee not found."}},
        )

    return Single(data=await _to_out_one(session, employee))


@router.post("/employees", response_model=Single[EmployeeOut], status_code=status.HTTP_201_CREATED)
async def create_employee(
    body: EmployeeCreate,
    request: Request,
    actor: Actor = Depends(requires("employees.create")),
    session: AsyncSession = Depends(get_session),
):
    # Uniqueness is checked here for a readable field error, and enforced by a
    # UNIQUE constraint in the database. Both, deliberately: the check gives a
    # good message, the constraint is what actually holds when two requests
    # arrive at the same moment and both pass the check.
    clash = (
        await session.execute(select(Employee).where(func.lower(Employee.email) == body.email.lower()))
    ).scalar_one_or_none()
    if clash:
        raise HTTPException(
            status_code=422,
            detail={"error": {"code": "VALIDATION_FAILED",
                              "message": "Please fix the highlighted fields.",
                              "fields": {"email": "This email is already in use"}}},
        )

    department = (
        await session.execute(select(Department).where(Department.id == body.departmentId))
    ).scalar_one_or_none()
    if department is None:
        raise HTTPException(
            status_code=422,
            detail={"error": {"code": "VALIDATION_FAILED",
                              "message": "Please fix the highlighted fields.",
                              "fields": {"departmentId": "Choose a department"}}},
        )

    shift_id = body.shiftId
    if shift_id is None:
        default_shift = (await session.execute(select(Shift).order_by(Shift.name))).scalars().first()
        shift_id = default_shift.id if default_shift else None

    highest = (
        await session.execute(select(func.max(Employee.emp_code)))
    ).scalar_one_or_none()

    employee = Employee(
        emp_code=_next_emp_code(highest),
        name=body.name,
        email=body.email.lower(),
        phone=body.phone,
        department_id=body.departmentId,
        position=body.position,
        shift_id=shift_id,
        join_date=body.joinDate,
        status=EmployeeStatus.active,
        attendance_tracked=body.attendanceTracked,
    )
    session.add(employee)
    await session.flush()

    await record_audit(
        session, actor_user_id=actor.user_id, action="employee.create",
        entity="employee", entity_id=employee.id, request=request,
        after={"empCode": employee.emp_code, "name": employee.name,
               "email": employee.email, "position": employee.position},
    )
    await session.commit()

    await session.refresh(employee, ["department"])
    return Single(data=await _to_out_one(session, employee))


@router.patch("/employees/{employee_id}", response_model=Single[EmployeeOut])
async def update_employee(
    employee_id: UUID,
    body: EmployeeUpdate,
    request: Request,
    actor: Actor = Depends(requires("employees.edit")),
    session: AsyncSession = Depends(get_session),
):
    employee = (
        await session.execute(
            select(Employee).options(selectinload(Employee.department)).where(Employee.id == employee_id)
        )
    ).scalar_one_or_none()

    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": {"code": "NOT_FOUND", "message": "Employee not found."}},
        )

    if body.email and body.email.lower() != employee.email:
        clash = (
            await session.execute(
                select(Employee).where(
                    func.lower(Employee.email) == body.email.lower(),
                    Employee.id != employee_id,
                )
            )
        ).scalar_one_or_none()
        if clash:
            raise HTTPException(
                status_code=422,
                detail={"error": {"code": "VALIDATION_FAILED",
                                  "message": "Please fix the highlighted fields.",
                                  "fields": {"email": "This email is already in use"}}},
            )

    # exclude_unset: only fields the client actually SENT. Without it, every
    # omitted field would arrive as None and blank the column.
    changes = body.model_dump(exclude_unset=True)

    # Only the fields being changed are recorded, not the whole row. A diff of
    # forty unchanged columns buries the one that moved.
    before = {
        "name": employee.name, "email": employee.email, "phone": employee.phone,
        "position": employee.position, "status": employee.status.value,
        "attendanceTracked": employee.attendance_tracked,
    }

    field_map = {
        "name": "name", "email": "email", "phone": "phone",
        "departmentId": "department_id", "position": "position",
        "shiftId": "shift_id", "joinDate": "join_date",
        "attendanceTracked": "attendance_tracked",
    }
    for api_name, column in field_map.items():
        if api_name in changes:
            value = changes[api_name]
            setattr(employee, column, value.lower() if api_name == "email" else value)

    if "status" in changes:
        employee.status = EmployeeStatus(changes["status"])

    after = {
        "name": employee.name, "email": employee.email, "phone": employee.phone,
        "position": employee.position, "status": employee.status.value,
        "attendanceTracked": employee.attendance_tracked,
    }
    await record_audit(
        session, actor_user_id=actor.user_id, action="employee.update",
        entity="employee", entity_id=employee.id, request=request,
        before={k: v for k, v in before.items() if before[k] != after[k]},
        after={k: v for k, v in after.items() if before[k] != after[k]},
    )
    await session.commit()
    await session.refresh(employee, ["department"])
    return Single(data=await _to_out_one(session, employee))
