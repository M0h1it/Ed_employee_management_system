"""
app/core/timeutil.py

Converting between the instants the database stores and the wall clock a shift
is written in.

THE RULE FOR THE WHOLE CODEBASE
--------------------------------
Store and transmit UTC. Compare against shift rules, and decide which calendar
day something belongs to, in LOCAL time.

Getting this backwards is not a cosmetic bug. Comparing a UTC timestamp against
"09:00" in a +05:30 country marks everybody as leaving early, every day, and
hides every late arrival — and the numbers look plausible enough that nobody
questions them until payroll does.
"""

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import settings

try:
    LOCAL_TZ = ZoneInfo(settings.TIMEZONE)
except ZoneInfoNotFoundError as exc:  # pragma: no cover - environment specific
    # Linux and macOS ship the IANA timezone database with the OS. Windows does
    # not, so this fails there unless the `tzdata` package is installed.
    #
    # Raised with an instruction rather than left as a forty-line traceback
    # ending in "No time zone found with key Asia/Kolkata", which reads like a
    # typo in the setting rather than a missing dependency.
    raise RuntimeError(
        f"Timezone '{settings.TIMEZONE}' could not be loaded.\n"
        "On Windows the IANA timezone database is not part of the OS. Run:\n"
        "    pip install tzdata\n"
        "It is already listed in requirements.txt."
    ) from exc

UTC = timezone.utc


def to_local(moment: datetime) -> datetime:
    """A stored UTC instant as local wall-clock time."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(LOCAL_TZ)


def local_now() -> datetime:
    return datetime.now(LOCAL_TZ)


def local_today() -> date:
    """
    Which calendar day it is HERE.

    At 02:00 IST it is still the previous day in UTC, so using the UTC date
    would file the early shift's arrivals under the wrong day.
    """
    return local_now().date()


def local_date_of(moment: datetime) -> date:
    return to_local(moment).date()
