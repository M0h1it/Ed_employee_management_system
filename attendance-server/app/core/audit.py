"""
app/core/audit.py

Recording who changed what, and what it looked like before.

WHY THIS CANNOT BE ADDED LATER
-------------------------------
Every other remaining feature can be built next month with no loss. This one
cannot: an audit log has no backfill. A role change made today and not written
down is gone, permanently. The value of the log is entirely in the events it
already holds, so the cost of waiting is paid in history that will never exist.

IT IS THE ONLY CONTROL THAT STILL WORKS AFTERWARDS
---------------------------------------------------
The other five levels of the access model stop the wrong action. This one
answers the question once somebody with legitimate access has done something
they should not have — which is the case the other five cannot touch.
"""

from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog

# Never written to the log, whatever the caller passes.
#
# An audit trail is read by more people than the data it describes, and it is
# kept far longer. A password hash or a token that lands here has been copied
# into the one table nobody thinks of as sensitive.
REDACTED_KEYS = {
    "password", "password_hash", "temporaryPassword", "newPassword",
    "currentPassword", "token", "token_hash", "accessToken", "refresh_token",
    "device_key_hash", "embedding",
}


def _clean(data: dict[str, Any] | None) -> dict[str, Any] | None:
    """Drops secrets and makes the rest JSON-safe."""
    if data is None:
        return None

    out: dict[str, Any] = {}
    for key, value in data.items():
        if key in REDACTED_KEYS:
            # The KEY is kept so the log shows a password was set, without
            # showing what it was set to. "Nothing happened" and "something
            # happened that we are not recording" are different statements.
            out[key] = "[redacted]"
        elif isinstance(value, (UUID,)):
            out[key] = str(value)
        elif hasattr(value, "isoformat"):
            out[key] = value.isoformat()
        elif hasattr(value, "value"):           # an Enum
            out[key] = value.value
        elif isinstance(value, (str, int, float, bool, type(None))):
            out[key] = value
        else:
            out[key] = str(value)
    return out


def client_ip(request: Request | None) -> str | None:
    """
    The caller's address, honouring a reverse proxy.

    X-Forwarded-For is set by the proxy and is trivially forgeable by a client
    talking to the app directly — so this is evidence only when the app is
    genuinely behind a proxy that overwrites the header. Worth recording, worth
    not treating as proof on its own.
    """
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


async def record_audit(
    session: AsyncSession,
    *,
    actor_user_id: UUID | None,
    action: str,
    entity: str,
    entity_id: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    """
    Adds an audit row to the CURRENT session, without committing.

    WHY THE SAME TRANSACTION AS THE CHANGE ITSELF
    ----------------------------------------------
    The two commit together or neither does. A separate connection would let the
    change succeed while its record failed — which is the exact state an audit
    log exists to make impossible.

    The cost is that a broken audit write rolls back the operation. That is the
    right trade for this system: a role change nobody can account for is worse
    than a role change that did not happen.

    The caller commits.
    """
    session.add(AuditLog(
        actor_user_id=actor_user_id,
        action=action,
        entity=entity,
        entity_id=str(entity_id),
        before=_clean(before),
        after=_clean(after),
        ip_address=client_ip(request),
    ))
