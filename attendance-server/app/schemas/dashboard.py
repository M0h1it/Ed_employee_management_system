"""
app/schemas/dashboard.py
"""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class DashboardStats(BaseModel):
    """
    THREE COUNTERS, NOT ONE.

    `checkedInToday` counts arrivals and only ever rises during the day.
    `currentlyPresent` counts who is inside and moves both ways.
    `checkedOut` counts departures.

    Decrementing a single counter on check-out destroys the arrival record by
    the evening — and the arrival record is exactly what a late-arrival report
    or a payroll export needs.
    """

    date: date
    totalEmployees: int          # tracked only; the owner is not on a shift
    checkedInToday: int
    currentlyPresent: int
    checkedOut: int
    lateCount: int
    absentCount: int
    onLeaveCount: int
    tasksOpen: int
    tasksCompletedToday: int


class AttendanceException(BaseModel):
    employeeId: UUID
    employeeName: str
    photoUrl: str | None = None
    flag: str
    expectedAt: datetime | None = None
    actualAt: datetime | None = None
    delayMinutes: int | None = None


class AttendanceTrendPoint(BaseModel):
    """One bar on the owner's trend chart."""

    bucket: date
    label: str
    present: int     # on time
    late: int
    absent: int
    workingDays: int
    trackedEmployees: int
