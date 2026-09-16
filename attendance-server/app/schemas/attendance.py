"""
app/schemas/attendance.py
"""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PunchEventOut(BaseModel):
    id: UUID
    employeeId: UUID
    employeeName: str
    ts: datetime
    direction: str
    deviceId: UUID | None = None
    deviceName: str | None = None
    source: str
    confidence: float | None = None
    photoRef: str | None = None


class AttendanceDayOut(BaseModel):
    employeeId: UUID
    employeeName: str
    employeePhotoUrl: str | None = None
    departmentName: str
    date: date

    firstIn: datetime | None = None
    lastOut: datetime | None = None
    workedMinutes: int

    status: str
    flags: list[str]
    punchCount: int


class PresentEmployeeOut(BaseModel):
    employeeId: UUID
    name: str
    photoUrl: str | None = None
    departmentName: str
    checkInAt: datetime
    minutesSinceCheckIn: int
    isLate: bool


class CreatePunchRequest(BaseModel):
    employeeId: UUID
    direction: str = Field(pattern="^(IN|OUT)$")
    ts: datetime
    source: str = Field(default="manual", pattern="^(kiosk|manual|pin)$")
    # Optional: the server derives the same key when the client omits it, so a
    # simple caller cannot forget the protection.
    idempotencyKey: str | None = None


class MyAttendanceToday(BaseModel):
    status: str
    checkInAt: datetime | None = None
    checkOutAt: datetime | None = None
    workedMinutes: int
    shiftStart: str
    shiftEnd: str
    isLate: bool
