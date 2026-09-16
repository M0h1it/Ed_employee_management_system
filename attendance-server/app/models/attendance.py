"""
app/models/attendance.py

Punch events, the derived day rollup, leave, corrections and face templates.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    func,
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Timestamps, UUIDPrimaryKey


class PunchDirection(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"


class PunchSource(str, enum.Enum):
    kiosk = "kiosk"
    manual = "manual"
    pin = "pin"


class AttendanceStatus(str, enum.Enum):
    PRESENT = "PRESENT"
    ABSENT = "ABSENT"
    ON_LEAVE = "ON_LEAVE"
    WORK_FROM_HOME = "WORK_FROM_HOME"
    HOLIDAY = "HOLIDAY"
    WEEKEND = "WEEKEND"
    NOT_YET_IN = "NOT_YET_IN"


class LeaveType(str, enum.Enum):
    """
    Includes work_from_home, which is NOT time off.

    It shares this table because the workflow is identical — a person asks, a
    different person approves — but the rollup treats it as a worked day rather
    than an absence. See AttendanceStatus.WORK_FROM_HOME.
    """

    casual = "casual"
    sick = "sick"
    earned = "earned"
    unpaid = "unpaid"
    comp_off = "comp_off"
    work_from_home = "work_from_home"


class LeaveStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"


class Device(UUIDPrimaryKey, Timestamps, Base):
    """A kiosk terminal. Authenticates with a long-lived key, revocable per device."""

    __tablename__ = "devices"

    name: Mapped[str] = mapped_column(String(80), nullable=False)
    location: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    device_key_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Updated on every accepted kiosk request. Its only job is to answer
    # "is this tablet actually talking to us" in the device list — it is
    # never read by anything that decides whether a request is allowed.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Set when revoked, cleared on reactivation. History only — is_active
    # alone still governs authentication (see get_current_device in
    # app/api/deps.py). Together with created_at and last_seen_at, this is
    # what lets one row's own past be shown rather than needing a second row
    # to represent "this device, but revoked".
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PunchEvent(UUIDPrimaryKey, Base):
    """
    A single raw punch. APPEND-ONLY: never updated, never deleted.

    The first time somebody disputes their hours, this table is the evidence.
    If rows can be edited, there is no evidence. A mistaken punch is fixed by
    adding a Correction on top, not by rewriting history — which is why there
    is no updated_at here: the Timestamps mixin is deliberately not used.
    """

    __tablename__ = "punch_events"
    __table_args__ = (
        # The duplicate gate. The Phase 3 kiosk writes punches locally and
        # drains the queue when the network returns, so the same punch can
        # legitimately arrive twice. A UNIQUE constraint rejects it in the
        # database rather than trusting application code to remember to check —
        # two concurrent requests can both pass an application-level check.
        UniqueConstraint("idempotency_key", name="uq_punch_idempotency"),
        Index("ix_punch_employee_ts", "employee_id", "ts"),
        Index("ix_punch_ts", "ts"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    direction: Mapped[PunchDirection] = mapped_column(
        Enum(PunchDirection, name="punch_direction"), nullable=False
    )

    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL")
    )
    source: Mapped[PunchSource] = mapped_column(
        Enum(PunchSource, name="punch_source"), nullable=False, default=PunchSource.kiosk
    )

    # 0..1 for a face match, NULL for a manual entry. Logged on every punch so
    # a disputed record can be discussed with a number attached.
    confidence: Mapped[float | None] = mapped_column(Float)
    photo_ref: Mapped[str | None] = mapped_column(String(500))

    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)

    # What the kiosk's own clock read at capture, for the offline queue only.
    # `ts` above stays the source of truth for attendance state — never
    # compute against device_ts, it exists to reveal clock drift, not to fix it.
    device_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Leave(UUIDPrimaryKey, Timestamps, Base):
    """
    WHY LEAVE IS IN THE FIRST MIGRATION
    ------------------------------------
    Without it, an employee on approved leave and an employee who simply did not
    turn up are indistinguishable — both produce zero punches, and both get
    marked ABSENT. Every absence figure would be wrong from the first month, and
    the exception report would be full of people who are exactly where they said
    they would be.

    Adding it later is not a new table; it is a rollup rewrite plus a backfill
    of every historical day.
    """

    __tablename__ = "leaves"
    __table_args__ = (Index("ix_leaves_employee_dates", "employee_id", "from_date", "to_date"),)

    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[LeaveType] = mapped_column(Enum(LeaveType, name="leave_type"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[LeaveStatus] = mapped_column(
        Enum(LeaveStatus, name="leave_status"), nullable=False, default=LeaveStatus.pending
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Correction(UUIDPrimaryKey, Timestamps, Base):
    """
    A requested change to a day, layered ON TOP of the punch events rather than
    replacing them. Both the original and the correction stay visible.
    """

    __tablename__ = "corrections"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    proposed_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    requested_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")


class AttendanceDay(Base):
    """
    One employee, one day. DERIVED from punch events — a cache, not a source.

    It exists only for speed: recomputing six months of days on every dashboard
    request would be wasteful. Nothing here cannot be rebuilt by rerunning the
    rollup, so a rule change means recompute rather than migrate.

    The composite primary key (employee_id, date) is deliberate: there is
    exactly one row per person per day, and the database enforces that rather
    than the application remembering to.
    """

    __tablename__ = "attendance_days"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True, index=True)

    first_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    worked_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    status: Mapped[AttendanceStatus] = mapped_column(
        Enum(AttendanceStatus, name="attendance_status"), nullable=False, index=True
    )

    # Zero or more. A native array rather than a join table: flags are only ever
    # read together with their day and never queried across days on their own,
    # so a separate table would add a join to every single read for nothing.
    flags: Mapped[list[str]] = mapped_column(
        ARRAY(String(30)), nullable=False, server_default="{}"
    )

    punch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # --- Payroll-facing ----------------------------------------------------
    payable_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    leave_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("leaves.id", ondelete="SET NULL")
    )
    is_holiday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    correction_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("corrections.id", ondelete="SET NULL")
    )

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )