"""
tests/test_attendance_rules.py

No database, no server, no fixtures to set up. These run in milliseconds
because the code under test is pure — which is exactly why it was written that
way.

Every test name is a business rule. When somebody changes the grace period from
15 minutes to 10, the failing test names say which rules that broke.
"""

from datetime import date, datetime, time

import pytest

from app.domain.attendance_rules import (
    AttendanceFlag,
    AttendanceStatus,
    Punch,
    PunchDirection,
    PunchSource,
    ShiftRule,
    build_day,
    build_idempotency_key,
    is_currently_in,
)

SHIFT = ShiftRule(start_time=time(9, 0), end_time=time(18, 0), grace_minutes=15, min_hours=8)
DAY = date(2026, 9, 14)                # a Monday
NOW = datetime(2026, 9, 15, 12, 0)     # "today" is the 15th, so DAY is in the past


def punch(hour: int, minute: int, direction: PunchDirection, source=PunchSource.kiosk) -> Punch:
    """Keeps each test reading as a story rather than as datetime construction."""
    return Punch(ts=datetime(2026, 9, 14, hour, minute), direction=direction, source=source)


# --- The ordinary day ------------------------------------------------------

def test_normal_day_is_present_with_no_flags():
    result = build_day(
        day=DAY,
        punches=[punch(8, 55, PunchDirection.IN), punch(18, 5, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert result.status == AttendanceStatus.PRESENT
    assert result.flags == []
    assert result.worked_minutes == 550          # 08:55 to 18:05


# --- Lateness and the grace period -----------------------------------------

def test_grace_period_means_0914_is_not_late():
    result = build_day(
        day=DAY,
        punches=[punch(9, 14, PunchDirection.IN), punch(18, 0, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.LATE_IN not in result.flags


def test_one_minute_past_the_grace_period_is_late():
    result = build_day(
        day=DAY,
        punches=[punch(9, 16, PunchDirection.IN), punch(18, 0, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.LATE_IN in result.flags


def test_a_zero_grace_policy_makes_0901_late():
    """Policy is data, not code — the same punches read differently under it."""
    strict = ShiftRule(start_time=time(9, 0), end_time=time(18, 0), grace_minutes=0, min_hours=8)
    result = build_day(
        day=DAY,
        punches=[punch(9, 1, PunchDirection.IN), punch(18, 0, PunchDirection.OUT)],
        shift=strict, now=NOW,
    )
    assert AttendanceFlag.LATE_IN in result.flags


# --- Missing punches -------------------------------------------------------

def test_forgetting_to_punch_out_is_flagged_and_earns_no_hours():
    result = build_day(day=DAY, punches=[punch(9, 0, PunchDirection.IN)], shift=SHIFT, now=NOW)
    assert AttendanceFlag.MISSING_OUT in result.flags
    # No invented departure time, so no hours. This half matters more than the
    # flag: an invented time would quietly become payable.
    assert result.worked_minutes == 0


def test_still_inside_today_accrues_time_without_a_missing_out_flag():
    today = NOW.date()
    result = build_day(
        day=today,
        punches=[Punch(ts=datetime(2026, 9, 15, 9, 0), direction=PunchDirection.IN)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.MISSING_OUT not in result.flags   # the day is not over
    assert result.worked_minutes == 180                     # 09:00 to 12:00


def test_an_out_with_no_in_is_flagged():
    result = build_day(day=DAY, punches=[punch(18, 0, PunchDirection.OUT)], shift=SHIFT, now=NOW)
    assert AttendanceFlag.MISSING_IN in result.flags


# --- Absence, leave, holidays, weekends ------------------------------------

def test_no_punches_on_a_past_working_day_is_absent():
    assert build_day(day=DAY, punches=[], shift=SHIFT, now=NOW).status == AttendanceStatus.ABSENT


def test_no_punches_yet_today_is_not_absent():
    result = build_day(day=NOW.date(), punches=[], shift=SHIFT, now=NOW)
    # Calling this ABSENT at noon would list everybody who is out at a client
    # site, or simply running late, as a no-show.
    assert result.status == AttendanceStatus.NOT_YET_IN


def test_approved_leave_is_not_absence():
    """The reason the leaves table is in migration 001."""
    result = build_day(day=DAY, punches=[], shift=SHIFT, on_leave=True, now=NOW)
    assert result.status == AttendanceStatus.ON_LEAVE
    assert result.status != AttendanceStatus.ABSENT


def test_a_holiday_is_not_a_company_wide_no_show():
    result = build_day(day=DAY, punches=[], shift=SHIFT, is_holiday=True, now=NOW)
    assert result.status == AttendanceStatus.HOLIDAY


def test_a_weekend_with_no_punches_is_not_absence():
    saturday = date(2026, 9, 19)
    result = build_day(day=saturday, punches=[], shift=SHIFT, now=NOW)
    assert result.status == AttendanceStatus.WEEKEND


# --- First and last -------------------------------------------------------

def test_first_and_last_punch_win_over_the_ones_in_between():
    """Stepping out for lunch produces four punches and still one arrival."""
    result = build_day(
        day=DAY,
        punches=[
            punch(9, 0, PunchDirection.IN),
            punch(13, 0, PunchDirection.OUT),
            punch(14, 0, PunchDirection.IN),
            punch(18, 0, PunchDirection.OUT),
        ],
        shift=SHIFT, now=NOW,
    )
    assert result.first_in.hour == 9
    assert result.last_out.hour == 18
    assert result.punch_count == 4
    assert result.worked_minutes == 540     # the lunch break is not deducted


def test_punches_arriving_out_of_order_are_sorted():
    """An offline kiosk replays its queue in whatever order it drains."""
    result = build_day(
        day=DAY,
        punches=[punch(18, 0, PunchDirection.OUT), punch(9, 0, PunchDirection.IN)],
        shift=SHIFT, now=NOW,
    )
    assert result.first_in.hour == 9
    assert result.last_out.hour == 18


# --- Short hours and early departure ---------------------------------------

def test_leaving_early_is_flagged():
    result = build_day(
        day=DAY,
        punches=[punch(9, 0, PunchDirection.IN), punch(16, 0, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.EARLY_OUT in result.flags
    assert AttendanceFlag.SHORT_HOURS in result.flags


def test_late_arrival_reports_exact_minutes_past_the_grace_cutoff():
    """09:00 start + 15 min grace = 09:15 cutoff. Arriving at 09:27 is 12
    minutes late from the CUTOFF, not 27 minutes late from start_time — the
    displayed number has to agree with what actually crossed the threshold."""
    result = build_day(
        day=DAY,
        punches=[punch(9, 27, PunchDirection.IN), punch(18, 0, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.LATE_IN in result.flags
    assert result.late_by_minutes == 12


def test_arriving_within_grace_reports_no_late_minutes():
    result = build_day(
        day=DAY,
        punches=[punch(9, 10, PunchDirection.IN), punch(18, 0, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.LATE_IN not in result.flags
    assert result.late_by_minutes is None


def test_leaving_early_reports_exact_minutes_short():
    result = build_day(
        day=DAY,
        punches=[punch(9, 0, PunchDirection.IN), punch(17, 40, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.EARLY_OUT in result.flags
    assert result.early_by_minutes == 20
    assert result.overtime_minutes is None


def test_staying_past_shift_end_is_flagged_as_overtime_with_exact_minutes():
    result = build_day(
        day=DAY,
        punches=[punch(9, 0, PunchDirection.IN), punch(18, 25, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.OVERTIME in result.flags
    assert AttendanceFlag.EARLY_OUT not in result.flags
    assert result.overtime_minutes == 25
    assert result.early_by_minutes is None


def test_a_few_minutes_past_shift_end_is_not_overtime():
    """Symmetric with EARLY_OUT's own 15-minute threshold — leaving 5 minutes
    late is just when the day ended, not overtime worth flagging."""
    result = build_day(
        day=DAY,
        punches=[punch(9, 0, PunchDirection.IN), punch(18, 5, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.OVERTIME not in result.flags
    assert result.overtime_minutes is None


def test_leaving_exactly_on_time_is_neither_early_nor_overtime():
    result = build_day(
        day=DAY,
        punches=[punch(9, 0, PunchDirection.IN), punch(18, 0, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.EARLY_OUT not in result.flags
    assert AttendanceFlag.OVERTIME not in result.flags
    assert result.early_by_minutes is None
    assert result.overtime_minutes is None


def test_a_day_can_carry_several_flags_at_once():
    """Why status and flags are separate fields: one value could not say this."""
    result = build_day(
        day=DAY,
        punches=[punch(10, 0, PunchDirection.IN), punch(15, 0, PunchDirection.OUT)],
        shift=SHIFT, now=NOW,
    )
    assert result.status == AttendanceStatus.PRESENT
    assert AttendanceFlag.LATE_IN in result.flags
    assert AttendanceFlag.SHORT_HOURS in result.flags
    assert AttendanceFlag.EARLY_OUT in result.flags


# --- Provenance ------------------------------------------------------------

def test_manual_entry_is_marked_as_such():
    result = build_day(
        day=DAY,
        punches=[
            punch(9, 0, PunchDirection.IN, source=PunchSource.manual),
            punch(18, 0, PunchDirection.OUT),
        ],
        shift=SHIFT, now=NOW,
    )
    assert AttendanceFlag.MANUAL_ENTRY in result.flags


# --- Helpers ---------------------------------------------------------------

def test_is_currently_in_reads_the_last_punch():
    assert is_currently_in([punch(9, 0, PunchDirection.IN)]) is True
    assert is_currently_in([punch(9, 0, PunchDirection.IN), punch(18, 0, PunchDirection.OUT)]) is False
    assert is_currently_in([]) is False


def test_idempotency_key_is_stable_within_a_minute():
    """Two punches in the same minute are the same punch."""
    a = build_idempotency_key("emp-1", datetime(2026, 9, 14, 9, 14, 3), PunchDirection.IN)
    b = build_idempotency_key("emp-1", datetime(2026, 9, 14, 9, 14, 58), PunchDirection.IN)
    assert a == b == "emp-1:2026-09-14:IN:0914"


def test_idempotency_key_differs_by_direction_and_minute():
    base = datetime(2026, 9, 14, 9, 14)
    assert build_idempotency_key("emp-1", base, PunchDirection.IN) != \
           build_idempotency_key("emp-1", base, PunchDirection.OUT)
    assert build_idempotency_key("emp-1", base, PunchDirection.IN) != \
           build_idempotency_key("emp-1", base.replace(minute=15), PunchDirection.IN)


# --- Timezone --------------------------------------------------------------

def test_shift_comparison_uses_the_same_clock_as_the_punch():
    """
    A regression test for a bug that reached a running server.

    Postgres stores instants in UTC. A shift written as "09:00 to 18:00" means
    09:00 LOCAL. Comparing a UTC timestamp against a local clock time is off by
    the offset — in IST, 5.5 hours, which marked every employee as leaving
    early every day and hid every late arrival.

    The fix is to convert to local time before the rules see the punch. This
    test pins that: the same instant, expressed in the local zone, must produce
    the right answer.
    """
    from datetime import timedelta, timezone

    ist = timezone(timedelta(hours=5, minutes=30))

    # 09:30 IST — half an hour late, past the 15-minute grace.
    late_arrival = datetime(2026, 9, 14, 9, 30, tzinfo=ist)
    departure = datetime(2026, 9, 14, 18, 30, tzinfo=ist)

    result = build_day(
        day=DAY,
        punches=[
            Punch(ts=late_arrival, direction=PunchDirection.IN),
            Punch(ts=departure, direction=PunchDirection.OUT),
        ],
        shift=SHIFT,
        now=datetime(2026, 9, 15, 12, 0, tzinfo=ist),
    )

    assert AttendanceFlag.LATE_IN in result.flags
    # And NOT early — they stayed past 18:00 local.
    assert AttendanceFlag.EARLY_OUT not in result.flags


# --- Work from home --------------------------------------------------------
#
# STAGED, NOT WIRED. The rule and the database enum values exist; no endpoint
# passes work_from_home=True yet. These tests are here so the behaviour is
# pinned before anything depends on it — otherwise it is dead code nobody can
# trust when it is finally connected.

def test_work_from_home_is_not_leave():
    """
    The whole reason this is not a leave type.

    Filing it as leave would mark the day ON_LEAVE, which says the person was
    away. They worked.
    """
    result = build_day(day=DAY, punches=[], shift=SHIFT, work_from_home=True, now=NOW)
    assert result.status == AttendanceStatus.WORK_FROM_HOME
    assert result.status != AttendanceStatus.ON_LEAVE
    assert result.status != AttendanceStatus.ABSENT


def test_work_from_home_credits_the_shift_hours():
    """No punches is expected — the kiosk is in the office."""
    result = build_day(day=DAY, punches=[], shift=SHIFT, work_from_home=True, now=NOW)
    assert result.worked_minutes == 8 * 60          # min_hours, credited
    assert result.flags == []                       # never an exception


def test_real_punches_beat_the_credited_figure():
    """Somebody came in anyway. A measured day is better than an assumed one."""
    result = build_day(
        day=DAY,
        punches=[punch(9, 0, PunchDirection.IN), punch(17, 0, PunchDirection.OUT)],
        shift=SHIFT, work_from_home=True, now=NOW,
    )
    assert result.worked_minutes == 480             # 09:00 to 17:00, not credited
    assert result.status == AttendanceStatus.WORK_FROM_HOME


def test_a_holiday_beats_work_from_home():
    """Nobody works from home on a day the company is closed."""
    result = build_day(
        day=DAY, punches=[], shift=SHIFT, work_from_home=True, is_holiday=True, now=NOW)
    assert result.status == AttendanceStatus.HOLIDAY


# --- Corrections -----------------------------------------------------------

def test_a_correction_supplies_a_missing_out_without_touching_the_in():
    """The kiosk got the arrival right; only the departure was missed."""
    from app.domain.attendance_rules import Correction

    result = build_day(
        day=DAY,
        punches=[punch(9, 0, PunchDirection.IN)],
        shift=SHIFT,
        correction=Correction(last_out=datetime(2026, 9, 14, 18, 0)),
        now=NOW,
    )
    assert result.first_in.hour == 9          # untouched
    assert result.last_out.hour == 18         # supplied
    assert result.worked_minutes == 540
    assert AttendanceFlag.MISSING_OUT not in result.flags


def test_a_correction_supplies_a_corrected_in_without_touching_the_out():
    """The mirror case of the test above — only the IN was wrong, OUT (None
    proposed) stays whatever the kiosk actually recorded. This is the exact
    shape of a real reported bug: a correction proposing only a new IN time
    appeared not to apply, and this locks in that it genuinely does."""
    from app.domain.attendance_rules import Correction

    result = build_day(
        day=DAY,
        punches=[punch(15, 23, PunchDirection.IN)],  # kiosk recorded the wrong arrival time
        shift=SHIFT,
        correction=Correction(first_in=datetime(2026, 9, 14, 9, 53), last_out=None),
        now=NOW,
    )
    assert result.first_in.hour == 9 and result.first_in.minute == 53  # corrected
    assert result.last_out is None  # untouched — nothing was proposed for it


def test_a_corrected_day_is_still_marked_as_not_measured():
    """Otherwise a corrected record looks identical to a measured one."""
    from app.domain.attendance_rules import Correction

    result = build_day(
        day=DAY,
        punches=[punch(9, 47, PunchDirection.IN), punch(18, 0, PunchDirection.OUT)],
        shift=SHIFT,
        correction=Correction(first_in=datetime(2026, 9, 14, 9, 5)),
        now=NOW,
    )
    assert AttendanceFlag.MANUAL_ENTRY in result.flags
    assert result.first_in.minute == 5
    # 09:05 is inside the grace period, so the correction also clears the flag
    # it was raised to dispute.
    assert AttendanceFlag.LATE_IN not in result.flags


def test_a_correction_can_rescue_a_day_with_no_punches_at_all():
    """The reader was down. That is a corrected PRESENT, not an absence."""
    from app.domain.attendance_rules import Correction

    result = build_day(
        day=DAY, punches=[], shift=SHIFT,
        correction=Correction(
            first_in=datetime(2026, 9, 14, 9, 0),
            last_out=datetime(2026, 9, 14, 18, 0),
        ),
        now=NOW,
    )
    assert result.status == AttendanceStatus.PRESENT
    assert result.worked_minutes == 540
    assert result.punch_count == 0            # honest: no device recorded anything
    assert AttendanceFlag.MANUAL_ENTRY in result.flags