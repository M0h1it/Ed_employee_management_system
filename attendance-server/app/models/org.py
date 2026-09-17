"""
app/models/org.py

Departments, shifts and holidays — the reference data attendance is measured
against.
"""

import uuid
from datetime import date, datetime, time

from sqlalchemy import Date, DateTime, Integer, Numeric, String, Time, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Timestamps, UUIDPrimaryKey


class Department(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "departments"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    employees: Mapped[list["Employee"]] = relationship(back_populates="department")  # noqa: F821


class Shift(UUIDPrimaryKey, Timestamps, Base):
    """
    One company-wide shift today, but modelled as a table from the start.

    `Employee.shift_id` already points here, so giving the night staff their own
    shift later is inserting a row — not a migration that touches every
    attendance record.
    """

    __tablename__ = "shifts"

    name: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    # Arriving within this many minutes of start_time is not late.
    grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)

    # Numeric, not Float: 8.5 hours must be exactly 8.5. Binary floats cannot
    # represent every decimal exactly, and "worked 7.999999 of 8 hours" is the
    # kind of thing that turns into a payroll argument.
    min_hours: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False, default=8)


class ShiftPolicyVersion(UUIDPrimaryKey, Base):
    """
    A snapshot of one shift's policy, effective from a specific date.

    WHY THIS EXISTS SEPARATELY FROM `Shift`
    -------------------------------------------
    `Shift` answers "what is the policy right now" — every screen except
    attendance calculation itself only ever needs that, and rewriting it to
    be date-aware would mean touching nine call sites for a distinction
    five of them do not care about. This table exists purely so
    attendance_rules.pick_shift_for_date() can answer "what was the policy
    on 15 September" without that day's LATE_IN/EARLY_OUT/SHORT_HOURS
    flags silently changing every time somebody edits today's grace period.

    No `updated_at` — a version, once saved, is history. If a value was
    wrong, the fix is a new version with a corrected effective_from, not an
    edit to this row, for the same "append-only is the evidence" reasoning
    PunchEvent already follows.
    """

    __tablename__ = "shift_policy_versions"
    __table_args__ = (
        UniqueConstraint("shift_id", "effective_from", name="uq_shift_policy_versions_shift_effective_from"),
    )

    shift_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    min_hours: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # No updated_at — a version, once saved, is history, the same
    # "append-only is the evidence" reasoning PunchEvent already follows,
    # so this defines created_at directly rather than pulling in the
    # Timestamps mixin other models use (which also adds updated_at, an
    # implicit "this can be edited in place" that this table deliberately
    # does not offer).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False)


class Holiday(UUIDPrimaryKey, Timestamps, Base):
    """
    A company holiday.

    WHY THIS EXISTS FROM DAY ONE
    -----------------------------
    Without it, a public holiday looks exactly like a day the whole company
    failed to turn up: zero punches for everyone, marked ABSENT across the
    board. The exception report would be unusable on precisely the days it
    should say nothing at all.
    """

    __tablename__ = "holidays"
    __table_args__ = (UniqueConstraint("date", name="uq_holidays_date"),)

    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)