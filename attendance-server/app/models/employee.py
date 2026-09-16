"""
app/models/employee.py

The people. Separate from login accounts on purpose — see app/models/auth.py.
"""

import enum
import uuid
from datetime import date

from sqlalchemy import Boolean, Date, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Timestamps, UUIDPrimaryKey


class EmployeeStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"


class Employee(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "employees"

    # The human-facing identifier. Unique and stable; people quote it out loud.
    emp_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(180), nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    photo_url: Mapped[str | None] = mapped_column(String(500))

    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL")
    )
    position: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    # Self-reference. A manager is an employee, so this points at this table.
    manager_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="SET NULL")
    )

    shift_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="SET NULL")
    )

    join_date: Mapped[date] = mapped_column(Date, nullable=False)

    # A status column, never a DELETE. Removing an employee row would orphan
    # every punch and task that points at them — and the attendance history is
    # exactly what you need when somebody disputes their final salary.
    status: Mapped[EmployeeStatus] = mapped_column(
        Enum(EmployeeStatus, name="employee_status"),
        nullable=False,
        default=EmployeeStatus.active,
        index=True,
    )

    # Whether this person's hours are recorded at all. The owner sets their own
    # schedule and is not on a shift; without this they would be marked ABSENT
    # every single day and sit permanently at the top of the exception list.
    # It is a property of the PERSON, not of their access level — a working
    # partner or a director may well want their hours kept.
    attendance_tracked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    department: Mapped["Department | None"] = relationship(back_populates="employees")  # noqa: F821
    manager: Mapped["Employee | None"] = relationship(remote_side="Employee.id")
    user: Mapped["User | None"] = relationship(back_populates="employee", uselist=False)  # noqa: F821
