"""
app/api/deps.py

Authentication and authorisation, as FastAPI dependencies.

THIS IS WHERE SECURITY ACTUALLY LIVES
--------------------------------------
Every permission check in Phase 1 — the hidden sidebar item, the wrapped
button, the guarded route — was user experience. None of it stops anyone
opening developer tools and calling an endpoint directly.

`requires()` below is the control. It runs before the route body, on every
request, including reads. An endpoint without it is open to anyone with a valid
token, whatever the UI shows.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import decode_token, hash_device_code
from app.models import Device, Employee, User

# auto_error=False so a missing header reaches our own handler and produces the
# project's error envelope, rather than FastAPI's differently-shaped default.
bearer = HTTPBearer(auto_error=False)


def _unauthorised(message: str = "Not signed in.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": {"code": "UNAUTHENTICATED", "message": message}},
        headers={"WWW-Authenticate": "Bearer"},
    )


class Actor:
    """
    The signed-in user for one request: who they are and what they may do.

    Permissions come from the token, not from a fresh database read, so
    authorising a request costs no query. The cost is that a permission change
    takes effect at the next token refresh rather than instantly — the same
    fifteen-minute window the UI already tells people about.
    """

    def __init__(self, user: User, employee: Employee, permissions: set[str]):
        self.user = user
        self.employee = employee
        self.permissions = permissions

    @property
    def user_id(self) -> UUID:
        return self.user.id

    @property
    def employee_id(self) -> UUID:
        return self.employee.id

    def can(self, permission: str) -> bool:
        return permission in self.permissions

    def can_any(self, permissions: list[str]) -> bool:
        return any(p in self.permissions for p in permissions)


async def get_current_actor(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> Actor:
    if credentials is None:
        raise _unauthorised()

    claims = decode_token(credentials.credentials)
    if claims is None or claims.get("type") != "access":
        # Expired, forged, or a refresh token being passed off as an access
        # token. All three are "sign in again" from the client's point of view.
        raise _unauthorised("Your session has expired. Sign in again.")

    result = await session.execute(
        select(User)
        .options(selectinload(User.employee).selectinload(Employee.department))
        .where(User.id == UUID(claims["sub"]))
    )
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        # The account was disabled AFTER this token was issued. The token is
        # still cryptographically valid, which is exactly why account state has
        # to be checked here rather than trusted from the token.
        raise _unauthorised("This account is no longer active.")

    return Actor(user=user, employee=user.employee, permissions=set(claims.get("perms", [])))


def requires(*permissions: str):
    """
    Guard a route with one or more permissions. Any one of them grants access.

        @router.get("/employees")
        async def list_employees(actor: Actor = Depends(requires("employees.view_all"))):

    Returns 403, not 404: the caller is correctly identified, they simply are
    not allowed. Hiding that behind a 404 makes genuine bugs indistinguishable
    from permission problems in the logs.
    """

    async def dependency(actor: Actor = Depends(get_current_actor)) -> Actor:
        if not actor.can_any(list(permissions)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": {
                        "code": "FORBIDDEN",
                        "message": "You do not have permission to do that.",
                    }
                },
            )
        return actor

    return dependency


def _device_unauthorised(message: str = "This device is not recognised.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": {"code": "DEVICE_UNAUTHENTICATED", "message": message}},
    )


async def get_current_device(
    x_device_code: str | None = Header(default=None, alias="X-Device-Code"),
    session: AsyncSession = Depends(get_session),
) -> Device:
    """
    Authenticates a kiosk tablet, not a person.

    Deliberately separate from Actor/get_current_actor: a kiosk request
    carries no user identity at all until AFTER a face match or PIN succeeds
    inside the route itself — the device is what's allowed to ASK "who is
    this", not a stand-in for the person being punched.

    The header is compared against every active device's hash rather than
    looked up by a plaintext id, because the code is the only thing the
    tablet has — there is no separate device_id it presents alongside it.
    With a handful of kiosks this is a handful of comparisons; if that ever
    stops being true, a short unhashed prefix stored alongside the hash would
    turn this into a single indexed lookup instead — not needed here yet.
    """
    if not x_device_code:
        raise _device_unauthorised("Missing device code.")

    candidate_hash = hash_device_code(x_device_code)
    result = await session.execute(
        select(Device).where(Device.device_key_hash == candidate_hash, Device.is_active.is_(True))
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise _device_unauthorised()

    device.last_seen_at = datetime.now(timezone.utc)
    return device