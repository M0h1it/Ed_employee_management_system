"""
app/models/__init__.py

Every model is imported here.

WHY THIS MATTERS MORE THAN IT LOOKS
------------------------------------
Alembic autogenerate compares Base.metadata against the live database. A model
class that is never imported is never registered on Base.metadata, so Alembic
sees no difference and silently omits the table. The migration runs, reports
success, and the table simply does not exist — which surfaces much later as a
confusing runtime error.

Adding a model file means adding it here. There is no way around it.
"""

from app.models.attendance import (  # noqa: F401
    AttendanceDay,
    AttendanceStatus,
    Correction,
    Device,
    Leave,
    LeaveStatus,
    LeaveType,
    PunchDirection,
    PunchEvent,
    PunchSource,
)
from app.models.audit import AuditLog  # noqa: F401
from app.models.auth import (  # noqa: F401
    Permission,
    RefreshToken,
    Role,
    User,
    role_permissions,
)
from app.models.employee import Employee, EmployeeStatus  # noqa: F401
from app.models.face import FaceTemplate  # noqa: F401
from app.models.org import Department, Holiday, Shift  # noqa: F401
from app.models.task import Task, TaskPriority, TaskStatus  # noqa: F401

__all__ = [
    "AttendanceDay",
    "AttendanceStatus",
    "AuditLog",
    "Correction",
    "Department",
    "Device",
    "Employee",
    "EmployeeStatus",
    "FaceTemplate",
    "Holiday",
    "Leave",
    "LeaveStatus",
    "LeaveType",
    "Permission",
    "PunchDirection",
    "PunchEvent",
    "PunchSource",
    "RefreshToken",
    "Role",
    "Shift",
    "Task",
    "TaskPriority",
    "TaskStatus",
    "User",
    "role_permissions",
]
