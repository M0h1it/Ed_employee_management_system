"""
app/models/org.py

Departments, shifts and holidays — the reference data attendance is measured
against.
"""

import uuid
from datetime import date, time

from sqlalchemy import Date, Integer, Numeric, String, Time, UniqueConstraint
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
