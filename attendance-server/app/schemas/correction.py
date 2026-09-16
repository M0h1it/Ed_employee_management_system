"""
app/schemas/correction.py
"""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class CorrectionOut(BaseModel):
    id: UUID
    employeeId: UUID
    employeeName: str
    employeePhotoUrl: str | None = None
    date: date
    reason: str
    proposedIn: datetime | None = None
    proposedOut: datetime | None = None

    # What the register currently says, so an approver can see the change
    # rather than only the proposal.
    currentIn: datetime | None = None
    currentOut: datetime | None = None

    status: str
    requestedBy: UUID | None = None
    requestedByName: str
    approvedBy: UUID | None = None
    approvedByName: str | None = None
    approvedAt: datetime | None = None
    createdAt: datetime


class CorrectionCreate(BaseModel):
    employeeId: UUID | None = None
    date: date
    reason: str = Field(min_length=5, max_length=500)
    proposedIn: datetime | None = None
    proposedOut: datetime | None = None

    @model_validator(mode="after")
    def check(self):
        if self.proposedIn is None and self.proposedOut is None:
            raise ValueError("Propose at least one time")
        if self.proposedIn and self.proposedOut and self.proposedOut <= self.proposedIn:
            raise ValueError("The out time must be after the in time")
        return self


class CorrectionDecision(BaseModel):
    status: str = Field(pattern="^(approved|rejected|cancelled)$")
