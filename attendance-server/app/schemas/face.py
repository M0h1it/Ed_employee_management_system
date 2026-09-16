"""
app/schemas/face.py

Enrolment (admin, authenticated user) and kiosk punch (device-authenticated,
no user token) response shapes. Two different audiences, kept in one file
because they describe the same underlying match/confidence concepts.
"""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class EnrolResult(BaseModel):
    employeeId: UUID
    templateCount: int
    qualityScore: float


class KioskOutcome(str, Enum):
    match = "MATCH"
    unsure = "UNSURE"
    no_match = "NO_MATCH"
    liveness_failed = "LIVENESS_FAILED"


class KioskPunchResult(BaseModel):
    outcome: KioskOutcome
    employeeId: UUID | None = None
    employeeName: str | None = None
    photoUrl: str | None = None
    direction: str | None = None          # "IN" | "OUT"
    confidence: float | None = None
    punchedAt: datetime | None = None
    message: str


class PinPunchRequest(BaseModel):
    """
    JSON body, not query params — a PIN in a query string ends up in server
    access logs, browser history, and any reverse proxy's request log, which
    is exactly the exposure the PIN's own hashing and audit-log redaction
    were built to avoid elsewhere. This is the fix for that: the same value
    that never appears in an audit log must not appear in a URL either.

    employeeCode (e.g. "EMP-0042"), not username: pin_hash has no UNIQUE
    constraint, so a PIN alone can collide between two people — see
    kiosk_pin_punch's own docstring in app/api/v1/face.py for the full
    reasoning. employeeCode is unique and short enough to type on a kiosk.
    """
    employeeCode: str
    pin: str


class PinPunchResult(BaseModel):
    employeeId: UUID
    employeeName: str
    direction: str
    punchedAt: datetime
    message: str