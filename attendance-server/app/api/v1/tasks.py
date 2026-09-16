"""
app/api/v1/tasks.py

Assigned and self-created work.

ONE ROUTE, TWO AUDIENCES
-------------------------
The owner assigns and sees everyone; an employee sees only their own and can
only complete. The difference comes from permissions, not from a second set of
endpoints — two endpoint families would drift apart within a month and every
change would have to be made twice.
"""

from datetime import date, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor, requires
from app.core.db import get_session
from app.core.timeutil import local_today
from app.models import Employee, EmployeeStatus, Task, TaskPriority, TaskStatus, User
from app.schemas.common import Paginated, Single, page_meta
from app.models import Employee as EmployeeModel  # noqa: F401
from app.schemas.task import TaskCreate, TaskOut, TaskUpdate, TimelineBar, TimelineRow

router = APIRouter(tags=["tasks"])


def _to_out(
    task: Task,
    employees: dict[UUID, Employee],
    assigners: dict[UUID, str],
    today: date,
) -> TaskOut:
    employee = employees.get(task.employee_id)

    return TaskOut(
        id=task.id,
        employeeId=task.employee_id,
        employeeName=employee.name if employee else "",
        employeePhotoUrl=employee.photo_url if employee else None,
        assignedBy=task.assigned_by,
        assignedByName=assigners.get(task.assigned_by, "") if task.assigned_by else "",
        title=task.title,
        description=task.description,
        startDate=task.start_date,
        dueDate=task.due_date,
        priority=task.priority.value,
        status=task.status.value,
        completedAt=task.completed_at,
        createdAt=task.created_at,
        # Computed here, never stored. A stored isOverdue is wrong the next
        # morning, and nothing would tell you.
        isOverdue=(
            task.status != TaskStatus.done
            and task.due_date is not None
            and task.due_date < today
        ),
        selfAssigned=task.self_assigned,
    )


async def _load_people(session: AsyncSession, tasks: list[Task]):
    """Batch-loads every employee and assigner name for a page of tasks."""
    employee_ids = {t.employee_id for t in tasks}
    user_ids = {t.assigned_by for t in tasks if t.assigned_by}

    employees: dict[UUID, Employee] = {}
    if employee_ids:
        rows = (await session.execute(
            select(Employee).where(Employee.id.in_(employee_ids)))).scalars().all()
        employees = {e.id: e for e in rows}

    assigners: dict[UUID, str] = {}
    if user_ids:
        rows = (await session.execute(
            select(User).options(selectinload(User.employee)).where(User.id.in_(user_ids)))
        ).scalars().all()
        assigners = {u.id: (u.employee.name if u.employee else u.username) for u in rows}

    return employees, assigners


def _scope(actor: Actor, requested: UUID | str | None) -> UUID | None:
    """
    Without tasks.view_all the filter is forced to the caller's own id.

    'me' is accepted as a literal so the frontend does not have to know its own
    employee id to ask for its own tasks.
    """
    if requested == "me":
        return actor.employee_id
    if actor.can("tasks.view_all"):
        return requested if isinstance(requested, UUID) else None
    return actor.employee_id


@router.get("/tasks", response_model=Paginated[TaskOut])
async def list_tasks(
    employeeId: str | None = None,
    taskStatus: str | None = Query(default=None, alias="status"),
    priority: str | None = None,
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=50, ge=1, le=200),
    actor: Actor = Depends(requires("tasks.view_all", "tasks.view_own")),
    session: AsyncSession = Depends(get_session),
):
    scoped: UUID | None
    if employeeId is None:
        scoped = None if actor.can("tasks.view_all") else actor.employee_id
    elif employeeId == "me":
        scoped = actor.employee_id
    else:
        try:
            scoped = _scope(actor, UUID(employeeId))
        except ValueError:
            raise HTTPException(422, detail={"error": {
                "code": "VALIDATION_FAILED", "message": "employeeId is not a valid id."}})

    stmt = select(Task)
    if scoped:
        stmt = stmt.where(Task.employee_id == scoped)
    if taskStatus:
        stmt = stmt.where(Task.status == TaskStatus(taskStatus))
    if priority:
        stmt = stmt.where(Task.priority == TaskPriority(priority))
    if search:
        stmt = stmt.where(Task.title.ilike(f"%{search.strip()}%"))

    total = (await session.execute(
        select(func.count()).select_from(stmt.subquery()))).scalar_one()

    today = local_today()

    # Overdue first, then by due date, undated last. NULLS LAST is explicit:
    # Postgres sorts NULLs first on ASC by default, which would float every
    # task with no deadline to the top of the board.
    stmt = (
        stmt.order_by(Task.due_date.asc().nullslast(), Task.created_at.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
    )
    rows = (await session.execute(stmt)).scalars().all()

    employees, assigners = await _load_people(session, rows)
    data = [_to_out(t, employees, assigners, today) for t in rows]
    data.sort(key=lambda t: (not t.isOverdue,))   # overdue to the top

    return Paginated(data=data, meta=page_meta(page=page, page_size=pageSize, total=total))


@router.post("/tasks", response_model=Single[TaskOut], status_code=status.HTTP_201_CREATED)
async def create_task(
    body: TaskCreate,
    actor: Actor = Depends(requires("tasks.assign", "tasks.create_own")),
    session: AsyncSession = Depends(get_session),
):
    """
    Two ways in, and they need different permissions.

    Assigning work to somebody ELSE needs tasks.assign. Adding a task to your
    OWN list needs only tasks.create_own — which every employee has, because
    planning your own day is not an act of authority over anyone.

    Checking only tasks.assign here would let anyone with it create work for
    anyone; checking only create_own would let an employee assign work to their
    manager. Both matter.
    """
    is_self = body.employeeId == actor.employee_id

    if not is_self and not actor.can("tasks.assign"):
        raise HTTPException(403, detail={"error": {
            "code": "FORBIDDEN",
            "message": "You can only add tasks to your own list."}})

    if is_self and not actor.can_any(["tasks.create_own", "tasks.assign"]):
        raise HTTPException(403, detail={"error": {
            "code": "FORBIDDEN", "message": "You cannot create tasks."}})

    employee = (await session.execute(
        select(Employee).where(Employee.id == body.employeeId))).scalar_one_or_none()
    if employee is None:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED",
            "message": "Please fix the highlighted fields.",
            "fields": {"employeeId": "Choose an employee"}}})

    task = Task(
        employee_id=body.employeeId,
        assigned_by=actor.user_id,
        title=body.title.strip(),
        description=body.description.strip(),
        start_date=body.startDate,
        due_date=body.dueDate,
        priority=TaskPriority(body.priority),
        status=TaskStatus.todo,
        # Recorded honestly: "who gave me this work" and "what did I plan for
        # myself" are different questions, and one assigned_by column answers
        # both only if this flag is set.
        self_assigned=is_self,
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)

    employees, assigners = await _load_people(session, [task])
    return Single(data=_to_out(task, employees, assigners, local_today()))


# ===========================================================================
# Timeline
# ===========================================================================

RANGE_WINDOWS: dict[str, tuple[int, int]] = {
    # (days before today, days after today) — must match the frontend's
    # RANGES table, or a bar can sit outside the window it was fetched for.
    "2w": (3, 10),
    "1m": (7, 23),
    "3m": (14, 76),
}


@router.get("/tasks/timeline", response_model=Single[list[TimelineRow]])
async def task_timeline(
    range: str = Query(default="2w", pattern="^(2w|1m|3m)$"),
    employeeId: str | None = None,
    taskStatus: str | None = Query(default=None, alias="status"),
    actor: Actor = Depends(requires("tasks.view_all", "tasks.view_own")),
    session: AsyncSession = Depends(get_session),
):
    """
    Who is working on what, and until when — one row per person.

    DECLARED BEFORE /tasks/{task_id}. FastAPI matches in declaration order, so
    the other way round "timeline" would be parsed as a task id and this would
    be unreachable. The same trap as /roles/assignable.
    """
    today = local_today()
    before, after = RANGE_WINDOWS[range]
    window_start = today - timedelta(days=before)
    window_end = today + timedelta(days=after)

    # Scoping, applied to the FILTER rather than checked afterwards. Somebody
    # without tasks.view_all cannot widen it by editing the query string.
    if actor.can("tasks.view_all"):
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

    people_stmt = (
        select(Employee)
        .options(selectinload(Employee.department))
        .where(Employee.status == EmployeeStatus.active)
    )
    if scoped:
        people_stmt = people_stmt.where(Employee.id == scoped)
    people = (await session.execute(people_stmt.order_by(Employee.name))).scalars().all()
    if not people:
        return Single(data=[])

    # A task appears if its span OVERLAPS the window, not if it sits inside it.
    # Work that started before the view opened is still running now, and
    # dropping it would make a busy person look free.
    task_stmt = select(Task).where(
        Task.employee_id.in_([e.id for e in people]),
        Task.start_date.is_not(None),
        Task.due_date.is_not(None),
        Task.start_date <= window_end,
        Task.due_date >= window_start,
    )
    if taskStatus:
        task_stmt = task_stmt.where(Task.status == TaskStatus(taskStatus))

    tasks = (await session.execute(task_stmt.order_by(Task.start_date))).scalars().all()

    by_employee: dict[UUID, list[TimelineBar]] = {}
    for task in tasks:
        by_employee.setdefault(task.employee_id, []).append(TimelineBar(
            taskId=task.id,
            title=task.title,
            startDate=task.start_date,
            endDate=task.due_date,
            status=task.status.value,
            priority=task.priority.value,
            # Computed on read. A stored overdue flag is wrong the next morning.
            isOverdue=task.status != TaskStatus.done and task.due_date < today,
        ))

    rows = [
        TimelineRow(
            employeeId=employee.id,
            employeeName=employee.name,
            employeePhotoUrl=employee.photo_url,
            departmentName=employee.department.name if employee.department else "",
            bars=by_employee.get(employee.id, []),
        )
        for employee in people
    ]

    # A person with no bars is kept in an unfiltered view — an empty row means
    # "free", which is half the reason to look at this chart. Under a status
    # filter it is dropped, because "nobody has any in-progress work" is not
    # the same statement.
    if taskStatus:
        rows = [r for r in rows if r.bars]

    return Single(data=rows)


@router.patch("/tasks/{task_id}", response_model=Single[TaskOut])
async def update_task(
    task_id: UUID,
    body: TaskUpdate,
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    task = (await session.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Task not found."}})

    is_mine = task.employee_id == actor.employee_id
    changes = body.model_dump(exclude_unset=True)

    # Moving your own task between columns is not editing it. Somebody with
    # only tasks.complete_own may start and finish their work; changing the
    # title, the deadline or the priority is a different act and needs
    # tasks.edit.
    content_fields = {"title", "description", "startDate", "dueDate", "priority"}
    touching_content = bool(content_fields & changes.keys())

    if touching_content and not actor.can("tasks.edit"):
        raise HTTPException(403, detail={"error": {
            "code": "FORBIDDEN", "message": "You cannot edit task details."}})

    if "status" in changes:
        may_move = actor.can("tasks.edit") or (is_mine and actor.can("tasks.complete_own"))
        if not may_move:
            raise HTTPException(403, detail={"error": {
                "code": "FORBIDDEN", "message": "You cannot change this task."}})

    if not touching_content and "status" not in changes:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Nothing to change."}})

    if "title" in changes:
        task.title = changes["title"].strip()
    if "description" in changes:
        task.description = changes["description"].strip()
    if "startDate" in changes:
        task.start_date = changes["startDate"]
    if "dueDate" in changes:
        task.due_date = changes["dueDate"]
    if "priority" in changes:
        task.priority = TaskPriority(changes["priority"])

    if "status" in changes:
        new_status = TaskStatus(changes["status"])
        task.status = new_status
        if new_status == TaskStatus.done:
            # The SERVER stamps the time, not the browser — a device clock can
            # be wrong or in another timezone.
            task.completed_at = datetime.now()
            task.completed_by = actor.user_id
        else:
            # Reopening clears the stamp, otherwise the task keeps claiming it
            # was finished.
            task.completed_at = None
            task.completed_by = None

    await session.commit()
    await session.refresh(task)

    employees, assigners = await _load_people(session, [task])
    return Single(data=_to_out(task, employees, assigners, local_today()))


@router.patch("/tasks/{task_id}/complete", response_model=Single[TaskOut])
async def complete_task(
    task_id: UUID,
    actor: Actor = Depends(requires("tasks.complete_own", "tasks.edit")),
    session: AsyncSession = Depends(get_session),
):
    """A shortcut for the most common action, so the board does not have to
    send a whole update body to tick one box."""
    task = (await session.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Task not found."}})

    if task.employee_id != actor.employee_id and not actor.can("tasks.edit"):
        raise HTTPException(403, detail={"error": {
            "code": "FORBIDDEN", "message": "You can only complete your own tasks."}})

    task.status = TaskStatus.done
    task.completed_at = datetime.now()
    task.completed_by = actor.user_id
    await session.commit()
    await session.refresh(task)

    employees, assigners = await _load_people(session, [task])
    return Single(data=_to_out(task, employees, assigners, local_today()))
