"""
app/schemas/task.py
"""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TaskOut(BaseModel):
    id: UUID
    employeeId: UUID
    employeeName: str
    employeePhotoUrl: str | None = None
    assignedBy: UUID | None = None
    assignedByName: str

    title: str
    description: str

    # A timeline bar needs both ends. createdAt is when the task was written
    # down, often weeks before anyone touched it.
    startDate: date | None = None
    dueDate: date | None = None

    priority: str
    status: str

    completedAt: datetime | None = None
    createdAt: datetime

    # NOT a stored column. It depends on today's date, so a value written
    # yesterday is wrong this morning. Computed on every read.
    isOverdue: bool
    selfAssigned: bool


class TaskCreate(BaseModel):
    employeeId: UUID
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=4000)
    startDate: date | None = None
    dueDate: date | None = None
    priority: str = Field(default="medium", pattern="^(low|medium|high)$")
    selfAssigned: bool = False


class TaskUpdate(BaseModel):
    """All optional — PATCH means "change these, leave the rest"."""

    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    startDate: date | None = None
    dueDate: date | None = None
    priority: str | None = Field(default=None, pattern="^(low|medium|high)$")
    status: str | None = Field(default=None, pattern="^(todo|in_progress|done)$")


class TimelineBar(BaseModel):
    taskId: UUID
    title: str
    startDate: date
    endDate: date
    status: str
    priority: str
    isOverdue: bool


class TimelineRow(BaseModel):
    """
    One person's row, with every dated task they hold.

    GROUPED ON THE SERVER, NOT IN THE BROWSER
    ------------------------------------------
    The client could take a flat task list and group it, but it would redo that
    on every render and on every filter change. The server groups once. It also
    means the shape the chart draws is the shape it receives, so a regrouping
    bug cannot exist.
    """

    employeeId: UUID
    employeeName: str
    employeePhotoUrl: str | None = None
    departmentName: str
    bars: list[TimelineBar]
