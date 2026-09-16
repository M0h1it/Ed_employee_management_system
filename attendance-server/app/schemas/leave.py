"""
app/schemas/leave.py
"""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class LeaveOut(BaseModel):
    id: UUID
    employeeId: UUID
    employeeName: str
    employeePhotoUrl: str | None = None
    departmentName: str
    fromDate: date
    toDate: date
    # Working days only, weekends excluded — what actually costs the business.
    days: int
    type: str
    reason: str
    status: str
    approvedBy: UUID | None = None
    approvedByName: str | None = None
    approvedAt: datetime | None = None
    createdAt: datetime


class LeaveCreate(BaseModel):
    employeeId: UUID | None = None
    fromDate: date
    toDate: date
    type: str = Field(pattern="^(casual|sick|earned|unpaid|comp_off)$")
    reason: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def check_range(self):
        if self.toDate < self.fromDate:
            raise ValueError("toDate cannot be before fromDate")
        return self


class LeaveDecision(BaseModel):
    status: str = Field(pattern="^(approved|rejected|cancelled)$")


class HolidayOut(BaseModel):
    id: UUID
    date: date
    name: str


class HolidayCreate(BaseModel):
    date: date
    name: str = Field(min_length=2, max_length=120)
