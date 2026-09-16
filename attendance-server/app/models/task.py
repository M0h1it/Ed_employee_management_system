"""
app/models/task.py

Assigned and self-created work.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import Timestamps, UUIDPrimaryKey


class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    done = "done"


class TaskPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


class Task(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "tasks"
    __table_args__ = (Index("ix_tasks_employee_status", "employee_id", "status"),)

    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # WHY A SEPARATE START DATE AND NOT created_at
    # ----------------------------------------------
    # A timeline bar needs both ends. created_at is when the task was written
    # down, which is often weeks before anyone touches it — a bar drawn from it
    # would say the work has been running since the day it was thought of, and
    # every person would look permanently overloaded.
    #
    # Nullable: an undated task is a real and common thing. It belongs in the
    # list but not on the chart, because a bar with no start has nowhere to sit.
    start_date: Mapped[date | None] = mapped_column(Date)

    due_date: Mapped[date | None] = mapped_column(Date)
    priority: Mapped[TaskPriority] = mapped_column(
        Enum(TaskPriority, name="task_priority"), nullable=False, default=TaskPriority.medium
    )
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status"), nullable=False, default=TaskStatus.todo
    )

    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    # Whether the person created this for themselves rather than being given it.
    # "Who gave me this work" and "what did I plan for myself" are different
    # questions, and one assigned_by column answers both only if this is set.
    self_assigned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # NOT STORED: is_overdue. It depends on today's date, so a stored value is
    # wrong the next morning. Computed on read, always.
