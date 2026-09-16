"""
app/schemas/device.py

Kiosk device registration. The raw device code appears in exactly one
response schema (DeviceCreated) and nowhere else — it cannot be recovered
after that response, same shape as how a generated PIN or a temporary
password is handled elsewhere in this project.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    location: str = Field(default="", max_length=120)


class DeviceOut(BaseModel):
    id: UUID
    name: str
    location: str
    isActive: bool
    createdAt: datetime
    lastSeenAt: datetime | None = None
    revokedAt: datetime | None = None


class DeviceHistoryEntry(BaseModel):
    """One row from the audit log, filtered to this device and narrowed to
    what is useful to show — not the full audit envelope. Sourced from
    AuditLog rather than a dedicated table: the audit log already records
    every device.register / device.revoke / device.reactivate event against
    this device's id (entity_id), so a second history table would just be
    the same facts stored twice."""
    action: str
    at: datetime
    actorName: str | None = None


class DeviceCreated(BaseModel):
    """Returned exactly once, at creation. The plain-text code is never
    retrievable again — losing it means revoking and re-registering."""
    device: DeviceOut
    deviceCode: str