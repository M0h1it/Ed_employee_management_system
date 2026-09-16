"""
app/api/v1/auth.py

Sign in, sign out, and "who am I".
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor
from app.core.config import settings
from app.core.audit import record_audit
from app.core.db import get_session
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
    hash_password,
    verify_password,
)
from app.models import Employee, RefreshToken, Role, User
from app.schemas.auth import ChangePasswordRequest, ChangePinRequest, CurrentUser, LoginRequest, LoginResponse
from app.schemas.common import Single

router = APIRouter(tags=["auth"])

MAX_FAILED_ATTEMPTS = 5


def _build_current_user(user: User) -> CurrentUser:
    employee = user.employee
    return CurrentUser(
        id=user.id,
        employeeId=employee.id,
        name=employee.name,
        email=employee.email,
        username=user.username,
        photoUrl=employee.photo_url,
        departmentName=employee.department.name if employee.department else "",
        position=employee.position,
        roleName=user.role.name,
        permissions=sorted(p.code for p in user.role.permissions),
        mustChangePassword=user.must_change_password,
        attendanceTracked=employee.attendance_tracked,
    )


@router.post("/auth/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    response: Response,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(User)
        .options(
            selectinload(User.employee).selectinload(Employee.department),
            selectinload(User.role).selectinload(Role.permissions),
        )
        .where(User.username == body.username.lower())
    )
    user = result.scalar_one_or_none()

    # ONE message for "no such user" and "wrong password". Saying which it was
    # lets anyone enumerate valid usernames one request at a time.
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": {"code": "INVALID_CREDENTIALS",
                          "message": "Incorrect username or password."}},
    )

    if user is None:
        raise invalid

    now = datetime.now(timezone.utc)

    if user.locked_until and user.locked_until > now:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={"error": {"code": "ACCOUNT_LOCKED",
                              "message": "Too many failed attempts. Try again later."}},
        )

    if not verify_password(body.password, user.password_hash):
        # Counting failures is what turns a stolen username from a guessing
        # game with unlimited tries into one with five.
        user.failed_attempts += 1
        if user.failed_attempts >= MAX_FAILED_ATTEMPTS:
            from datetime import timedelta
            user.locked_until = now + timedelta(minutes=15)
            user.failed_attempts = 0
            # Individual failures are not logged — they are noise, and a
            # password typo is not an event. A LOCKOUT is: it means five in a
            # row, which is either somebody locked out of their own account or
            # somebody guessing at theirs.
            await record_audit(
                session, actor_user_id=user.id, action="auth.lockout",
                entity="user", entity_id=user.id, request=request,
                after={"username": user.username, "lockedUntil": user.locked_until},
            )
        await session.commit()
        raise invalid

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "ACCOUNT_DISABLED",
                              "message": "This account has been disabled. Contact your administrator."}},
        )

    # --- Success ------------------------------------------------------------
    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = now

    permissions = sorted(p.code for p in user.role.permissions)
    access_token = create_access_token(user_id=str(user.id), permissions=permissions)

    raw_refresh, refresh_hash, refresh_expires = create_refresh_token()
    session.add(RefreshToken(user_id=user.id, token_hash=refresh_hash, expires_at=refresh_expires))

    await record_audit(
        session, actor_user_id=user.id, action="auth.login",
        entity="user", entity_id=user.id, request=request,
        after={"username": user.username, "role": user.role.name},
    )
    await session.commit()

    _set_refresh_cookie(response, raw_refresh)

    return LoginResponse(accessToken=access_token, user=_build_current_user(user))


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    """
    httpOnly: JavaScript cannot read it, so an XSS bug cannot steal a week-long
    token. The short access token stays in memory on the client, where a page
    refresh discards it — the opposite trade-off on purpose.

    path is scoped to /api/v1/auth, so the cookie is not attached to every
    ordinary API call. A credential that travels on requests that do not need it
    is a credential with more chances to leak.
    """
    response.set_cookie(
        key="refresh_token",
        value=raw_token,
        httponly=True,
        secure=settings.ENV != "dev",   # HTTPS-only outside local development
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_DAYS * 24 * 3600,
        path="/api/v1/auth",
    )


@router.post("/auth/refresh", response_model=LoginResponse)
async def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    session: AsyncSession = Depends(get_session),
):
    """
    Exchanges the refresh cookie for a new access token.

    ROTATION, NOT REUSE
    -------------------
    Every refresh issues a NEW token and revokes the one presented. A refresh
    token is therefore single-use.

    That is what makes theft detectable. If a stolen token is replayed after the
    real user has already refreshed, the server sees an ALREADY-REVOKED token —
    which cannot happen in normal operation, because the legitimate client threw
    its copy away the moment it got a new one.

    On that signal every token for the user is revoked, which signs out both the
    thief and the victim. Signing the victim out is the point: they can sign back
    in with a password the attacker does not have, and the attacker cannot.
    """
    unauthorised = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": {"code": "UNAUTHENTICATED",
                          "message": "Your session has expired. Sign in again."}},
    )

    if not refresh_token:
        raise unauthorised

    token_hash = hash_refresh_token(refresh_token)
    stored = (await session.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash))).scalar_one_or_none()

    if stored is None:
        raise unauthorised

    now = datetime.now(timezone.utc)

    if stored.revoked_at is not None:
        # Replay of a token that was already spent. Either a stolen copy, or a
        # client that failed to store the rotation. Both are handled the same
        # way, because from here they are indistinguishable and the safe reading
        # is the worse one.
        others = (await session.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == stored.user_id,
                RefreshToken.revoked_at.is_(None)))).scalars().all()
        for token in others:
            token.revoked_at = now
        # A replayed refresh token is the strongest theft signal this system
        # can produce. It must be reconstructable afterwards.
        await record_audit(
            session, actor_user_id=stored.user_id, action="auth.token_reuse",
            entity="user", entity_id=stored.user_id,
            after={"revokedSessions": len(others)},
        )
        await session.commit()
        response.delete_cookie("refresh_token", path="/api/v1/auth")
        raise unauthorised

    if stored.expires_at <= now:
        raise unauthorised

    user = (await session.execute(
        select(User)
        .options(
            selectinload(User.employee).selectinload(Employee.department),
            selectinload(User.role).selectinload(Role.permissions),
        )
        .where(User.id == stored.user_id))).scalar_one_or_none()

    if user is None or not user.is_active:
        # Disabled after the token was issued. The token is still valid
        # cryptographically, which is exactly why account state is checked here
        # rather than trusted from the token.
        raise unauthorised

    # Spend the old one, issue the new one.
    stored.revoked_at = now

    raw_refresh, refresh_hash, refresh_expires = create_refresh_token()
    session.add(RefreshToken(user_id=user.id, token_hash=refresh_hash, expires_at=refresh_expires))
    await session.commit()

    permissions = sorted(p.code for p in user.role.permissions)
    access_token = create_access_token(user_id=str(user.id), permissions=permissions)

    _set_refresh_cookie(response, raw_refresh)

    # The user object comes back too, so a permission change picked up here
    # reaches the client without a separate /me call.
    return LoginResponse(accessToken=access_token, user=_build_current_user(user))


@router.get("/me", response_model=Single[CurrentUser])
async def me(actor: Actor = Depends(get_current_actor), session: AsyncSession = Depends(get_session)):
    """
    Re-reads the user from the database rather than rebuilding from the token,
    so a profile edit or a role change shows up here immediately.
    """
    result = await session.execute(
        select(User)
        .options(
            selectinload(User.employee).selectinload(Employee.department),
            selectinload(User.role).selectinload(Role.permissions),
        )
        .where(User.id == actor.user_id)
    )
    user = result.scalar_one()
    return Single(data=_build_current_user(user))


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    """
    Revokes every refresh token for this user, not just the current one.

    "Sign me out" usually means "end my sessions", and somebody clicking it
    because they think their account is compromised expects exactly that.
    """
    result = await session.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == actor.user_id,
            RefreshToken.revoked_at.is_(None),
        )
    )
    now = datetime.now(timezone.utc)
    for token in result.scalars():
        token.revoked_at = now
    await session.commit()

    response.delete_cookie("refresh_token", path="/api/v1/auth")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_own_password(
    body: ChangePasswordRequest,
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    user = (await session.execute(select(User).where(User.id == actor.user_id))).scalar_one()

    if not verify_password(body.currentPassword, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "VALIDATION_FAILED",
                              "message": "Please fix the highlighted fields.",
                              "fields": {"currentPassword": "That is not your current password"}}},
        )

    if body.newPassword == body.currentPassword:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "VALIDATION_FAILED",
                              "message": "Please fix the highlighted fields.",
                              "fields": {"newPassword": "Choose a password you have not used before"}}},
        )

    user.password_hash = hash_password(body.newPassword)
    user.must_change_password = False
    await session.commit()

    # 204: nothing to return, and nothing that could leak.
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/me/pin", status_code=status.HTTP_204_NO_CONTENT)
async def change_own_pin(
    body: ChangePinRequest,
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    """
    Self-service PIN change, mirroring change_own_password exactly. The only
    structural difference is that a user with no PIN yet (pin_hash is NULL —
    never generated by an admin) cannot use this: verify_password against
    None is not a "wrong PIN", it is "there is nothing to change", and the
    person needs an admin to generate one first.
    """
    user = (await session.execute(select(User).where(User.id == actor.user_id))).scalar_one()

    if not user.pin_hash:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "NO_PIN_SET",
                              "message": "You do not have a PIN yet. Ask an administrator to generate one."}},
        )

    if not verify_password(body.currentPin, user.pin_hash):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "VALIDATION_FAILED",
                              "message": "Please fix the highlighted fields.",
                              "fields": {"currentPin": "That is not your current PIN"}}},
        )

    if body.newPin == body.currentPin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "VALIDATION_FAILED",
                              "message": "Please fix the highlighted fields.",
                              "fields": {"newPin": "Choose a PIN you have not used before"}}},
        )

    user.pin_hash = hash_password(body.newPin)
    user.must_change_pin = False
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)