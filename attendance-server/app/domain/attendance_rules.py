"""
app/domain/attendance_rules.py

PURE FUNCTIONS ONLY.

No database, no FastAPI, no I/O, no imports from app.models or app.api. Plain
values go in, a result comes out.

This is the Python port of the frontend's domain/attendanceRules.ts, and the
two must stay in step — they are the same rules, and the mock server and this
one are supposed to agree.

Keeping it pure buys three things:
  1. It is testable without a browser or a database.
  2. The rules exist in exactly one place, so a change cannot be half-applied.
  3. Anything that reads or writes can change underneath it without touching it.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from enum import Enum


class PunchDirection(str, Enum):
    IN = "IN"
    OUT = "OUT"


class PunchSource(str, Enum):
    kiosk = "kiosk"
    manual = "manual"
    pin = "pin"


class AttendanceStatus(str, Enum):
    """What kind of day this was. Exactly one value."""

    PRESENT = "PRESENT"
    ABSENT = "ABSENT"
    ON_LEAVE = "ON_LEAVE"

    # WORKED, just not from the office.
    #
    # WHY THIS IS NOT A KIND OF LEAVE
    # --------------------------------
    # Filing working from home as a leave type would mark the day ON_LEAVE,
    # which says the person was away. They were not — they worked. The hours
    # should count, the day should not appear in the exception list, and it
    # should not come out of anybody's leave balance.
    #
    # Same request and approval flow, different meaning.
    WORK_FROM_HOME = "WORK_FROM_HOME"
    HOLIDAY = "HOLIDAY"
    WEEKEND = "WEEKEND"
    NOT_YET_IN = "NOT_YET_IN"


class AttendanceFlag(str, Enum):
    """What needs a human look. Zero or more."""

    LATE_IN = "LATE_IN"
    EARLY_OUT = "EARLY_OUT"
    MISSING_OUT = "MISSING_OUT"
    MISSING_IN = "MISSING_IN"
    SHORT_HOURS = "SHORT_HOURS"
    MANUAL_ENTRY = "MANUAL_ENTRY"


@dataclass(frozen=True)
class Punch:
    """
    A punch as plain data — NOT the SQLAlchemy model.

    This module must not know a database exists. The caller reads rows and hands
    the values over, which is what keeps these functions testable with no
    database and portable if storage ever changes.

    frozen=True: a punch is a raw fact, and a fact that can be edited is not a
    fact any more.
    """

    ts: datetime
    direction: PunchDirection
    source: PunchSource = PunchSource.kiosk


@dataclass(frozen=True)
class Correction:
    """
    An approved fix, layered ON TOP of the punch events rather than replacing
    them.

    WHY THE PUNCHES ARE NEVER EDITED
    ---------------------------------
    The first time somebody disputes their hours, punch_events is the evidence.
    If rows can be rewritten there is no evidence — only a record that says
    whatever the last person to touch it wanted it to say.

    So a correction is a separate, approved, attributed row, and the day is
    computed from both. Expanding the row still shows the original punches
    underneath. "The kiosk recorded 09:47, and this was corrected to 09:05 by
    Marcus on the 14th, because the reader failed" is a defensible sentence.
    "It says 09:05" is not.
    """

    first_in: datetime | None = None
    last_out: datetime | None = None


@dataclass(frozen=True)
class ShiftRule:
    start_time: time
    end_time: time
    grace_minutes: int = 15
    min_hours: float = 8.0


@dataclass
class DayResult:
    first_in: datetime | None
    last_out: datetime | None
    worked_minutes: int
    status: AttendanceStatus
    # default_factory, not `= []`. A mutable default is evaluated ONCE at
    # function-definition time, so every DayResult would share the same list and
    # appending a flag to one would append it to all of them.
    flags: list[AttendanceFlag] = field(default_factory=list)
    punch_count: int = 0

    @property
    def payable_minutes(self) -> int:
        """
        What payroll would count. Today it equals worked_minutes; the property
        exists so overtime caps and half-day rules have an obvious home that is
        not tangled into the worked-time calculation.
        """
        return self.worked_minutes


def _combine(day: date, at: time) -> datetime:
    return datetime.combine(day, at)


def _minutes_between(start: datetime, end: datetime) -> int:
    """
    Whole minutes, clamped at zero.

    A negative span is always a data problem — a clock that went backwards, a
    timezone mix-up. Letting it through turns it into somebody's negative
    payable hours further down the line, where it is much harder to spot.
    """
    # Comparing an aware datetime with a naive one raises. Normalising here
    # keeps every caller from having to think about it.
    if start.tzinfo is not None and end.tzinfo is None:
        end = end.replace(tzinfo=start.tzinfo)
    elif end.tzinfo is not None and start.tzinfo is None:
        start = start.replace(tzinfo=end.tzinfo)

    delta: timedelta = end - start
    return max(0, int(delta.total_seconds() // 60))


def is_currently_in(punches: list[Punch]) -> bool:
    """Is this person inside right now — was the last punch of today an IN."""
    if not punches:
        return False
    return max(punches, key=lambda p: p.ts).direction == PunchDirection.IN


def build_idempotency_key(employee_id: str, ts: datetime, direction: PunchDirection) -> str:
    """
    The duplicate gate: employee + date + direction + minute.

    Minute-level on purpose — two punches in the same minute are the same punch.
    The kiosk writes locally and replays when the network returns, so the same
    punch legitimately arrives twice.
    """
    return f"{employee_id}:{ts:%Y-%m-%d}:{direction.value}:{ts:%H%M}"


def build_day(
    *,
    day: date,
    punches: list[Punch],
    shift: ShiftRule,
    is_holiday: bool = False,
    on_leave: bool = False,
    work_from_home: bool = False,
    correction: "Correction | None" = None,
    now: datetime | None = None,
) -> DayResult:
    """
    Collapse one person's punches for one date into a single day record.

    RULE: the FIRST punch of the day is the arrival and the LAST is the
    departure, whatever happened in between.

    Strict IN/OUT/IN/OUT pairing sounds more correct and is far more fragile —
    one missed punch in the middle cascades and corrupts the rest of the day.
    First-and-last degrades gracefully: somebody who steps out for lunch and
    punches four times still has one arrival and one departure.

    `now` is a parameter, not datetime.now() inside. Hard-coding the clock makes
    "is 09:16 late" untestable; passing it in means a test can stand anywhere in
    time. Production never passes it.
    """
    now = now or datetime.now()
    is_today = day == now.date()

    ordered = sorted(punches, key=lambda p: p.ts)
    ins = [p for p in ordered if p.direction == PunchDirection.IN]
    outs = [p for p in ordered if p.direction == PunchDirection.OUT]

    first_in = ins[0].ts if ins else None
    last_out = outs[-1].ts if outs else None

    # An approved correction overrides the derived times — but only the ones it
    # actually proposes. A correction that supplies a missing OUT must not wipe
    # the IN the kiosk recorded correctly.
    corrected = False
    if correction is not None:
        if correction.first_in is not None:
            first_in = correction.first_in
            corrected = True
        if correction.last_out is not None:
            last_out = correction.last_out
            corrected = True

    is_weekend = day.weekday() >= 5  # Monday is 0, Saturday is 5
    flags: list[AttendanceFlag] = []

    # --- Working from home -------------------------------------------------
    #
    # The kiosk is in the office, so a home day has no punches and cannot have
    # any. The hours are CREDITED from the shift rather than measured — which is
    # a real trade, and the status is what makes it visible: WORK_FROM_HOME
    # never claims to be a measured PRESENT.
    #
    # Checked before the no-punches branch, so an approved home day is never
    # read as an absence. A holiday still wins: nobody works from home on a day
    # the company is closed.
    if work_from_home and not is_holiday:
        credited = int(shift.min_hours * 60)
        if ordered:
            # Somebody came in anyway, or punched from a second office. Real
            # punches beat a credited figure every time.
            if first_in and last_out:
                credited = _minutes_between(first_in, last_out)
            elif first_in and is_today:
                credited = _minutes_between(first_in, now)

        return DayResult(
            first_in=first_in,
            last_out=last_out,
            worked_minutes=credited,
            status=AttendanceStatus.WORK_FROM_HOME,
            flags=[],
            punch_count=len(ordered),
        )

    # --- Nobody punched ----------------------------------------------------
    #
    # A correction can supply both times for a day with no punches at all —
    # the reader was down, or somebody was locked out. That is a corrected
    # PRESENT, not an absence, so the branch below is skipped.
    if not ordered and corrected:
        worked = (
            _minutes_between(first_in, last_out) if first_in and last_out else 0
        )
        return DayResult(
            first_in=first_in, last_out=last_out, worked_minutes=worked,
            status=AttendanceStatus.PRESENT,
            flags=[AttendanceFlag.MANUAL_ENTRY], punch_count=0,
        )

    if not ordered:
        if is_holiday:
            status = AttendanceStatus.HOLIDAY
        elif on_leave:
            # Without this branch, somebody on approved leave is indistinguishable
            # from somebody who did not turn up: both produce zero punches.
            status = AttendanceStatus.ON_LEAVE
        elif is_weekend:
            status = AttendanceStatus.WEEKEND
        elif is_today:
            # Today, before they have arrived. Calling this ABSENT at 09:05
            # would put half the company on the exception list every morning.
            status = AttendanceStatus.NOT_YET_IN
        else:
            status = AttendanceStatus.ABSENT

        return DayResult(
            first_in=None, last_out=None, worked_minutes=0,
            status=status, flags=[], punch_count=0,
        )

    # --- Worked minutes ----------------------------------------------------
    worked_minutes = 0
    if first_in and last_out:
        worked_minutes = _minutes_between(first_in, last_out)
    elif first_in and is_today:
        worked_minutes = _minutes_between(first_in, now)
    # No OUT on a past day: stays zero. NEVER invent a departure time — an
    # invented time silently becomes somebody's payable hours.

    # --- Flags -------------------------------------------------------------
    if first_in:
        cutoff = _combine(day, shift.start_time) + timedelta(minutes=shift.grace_minutes)
        if first_in.tzinfo is not None:
            cutoff = cutoff.replace(tzinfo=first_in.tzinfo)
        if first_in > cutoff:
            flags.append(AttendanceFlag.LATE_IN)

    if first_in and not last_out and not is_today:
        flags.append(AttendanceFlag.MISSING_OUT)

    if last_out and not first_in:
        flags.append(AttendanceFlag.MISSING_IN)

    if last_out:
        shift_end = _combine(day, shift.end_time)
        if last_out.tzinfo is not None:
            shift_end = shift_end.replace(tzinfo=last_out.tzinfo)
        if _minutes_between(last_out, shift_end) > 15:
            flags.append(AttendanceFlag.EARLY_OUT)
        if 0 < worked_minutes < shift.min_hours * 60:
            flags.append(AttendanceFlag.SHORT_HOURS)

    if any(p.source == PunchSource.manual for p in ordered) or corrected:
        # A corrected day carries the same marker as a hand-entered one: the
        # figure did not come from a device. Hiding that would make a corrected
        # record indistinguishable from a measured one, which is the whole thing
        # this design is trying to avoid.
        flags.append(AttendanceFlag.MANUAL_ENTRY)

    # --- Status ------------------------------------------------------------
    if is_holiday:
        status = AttendanceStatus.HOLIDAY
    elif on_leave:
        status = AttendanceStatus.ON_LEAVE
    elif is_weekend:
        status = AttendanceStatus.WEEKEND
    elif first_in:
        status = AttendanceStatus.PRESENT
    else:
        status = AttendanceStatus.ABSENT

    return DayResult(
        first_in=first_in,
        last_out=last_out,
        worked_minutes=worked_minutes,
        status=status,
        flags=flags,
        punch_count=len(ordered),
    )


FLAG_LABELS: dict[AttendanceFlag, str] = {
    AttendanceFlag.LATE_IN: "Late",
    AttendanceFlag.EARLY_OUT: "Left early",
    AttendanceFlag.MISSING_OUT: "Missing out",
    AttendanceFlag.MISSING_IN: "Missing in",
    AttendanceFlag.SHORT_HOURS: "Short hours",
    AttendanceFlag.MANUAL_ENTRY: "Manual",
}
