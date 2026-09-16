"""
app/schemas/employee.py

Request and response shapes for the directory.

These are the CONTRACT, not the database rows. Returning a SQLAlchemy model
directly would leak every column it happens to have. Declaring the response
explicitly means a field reaches the browser only because somebody wrote it
down — the difference between an accidental leak and a deliberate one.

Field names are camelCase because the frontend's contracts/types.ts has used
them for weeks. Converting here is cheaper than converting on forty screens.
"""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    empCode: str
    name: str
    email: str
    phone: str | None = None
    photoUrl: str | None = None

    departmentId: UUID | None = None
    # Denormalised. A table row needs to print "Engineering", not a UUID — and
    # without this every screen would fetch the departments list separately and
    # join in the browser: an extra request, an extra loading state, and an
    # extra bug surface, on every screen.
    departmentName: str

    position: str
    shiftId: UUID | None = None
    joinDate: date
    status: str

    faceEnrolled: bool
    hasLogin: bool
    roleName: str | None = None
    attendanceTracked: bool


class EmployeeCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    # India mobile. A pattern this specific belongs in one place — the frontend
    # checks the same thing for instant feedback, but a form can be bypassed and
    # this cannot.
    phone: str = Field(pattern=r"^[6-9]\d{9}$")
    departmentId: UUID
    position: str = Field(min_length=2, max_length=120)
    shiftId: UUID | None = None
    joinDate: date
    attendanceTracked: bool = True

    @field_validator("name", "position")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class EmployeeUpdate(BaseModel):
    """
    Every field optional — PATCH means "change these, leave the rest".

    A PUT-style update that takes the whole object would silently blank any
    field the client forgot to send back, which is how half a directory ends up
    with empty phone numbers.
    """

    name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, pattern=r"^[6-9]\d{9}$")
    departmentId: UUID | None = None
    position: str | None = Field(default=None, min_length=2, max_length=120)
    shiftId: UUID | None = None
    joinDate: date | None = None
    status: str | None = Field(default=None, pattern="^(active|inactive)$")
    attendanceTracked: bool | None = None


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str


class ShiftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    startTime: str
    endTime: str
    graceMinutes: int
    minHours: float
