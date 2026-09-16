"""
app/core/security.py

Password hashing and JWT creation. The only file that touches either.

WHY ARGON2 AND NOT BCRYPT
--------------------------
Argon2id won the Password Hashing Competition and is what current guidance
recommends. It resists GPU cracking far better than bcrypt, and it avoids
bcrypt's silent 72-byte truncation — with bcrypt, two different long passwords
can hash identically and nobody finds out.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """
    passlib compares in constant time, which matters: a comparison that returns
    early on the first wrong byte leaks how much of the password was right,
    measurable over enough attempts.
    """
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        # A malformed hash in the database must read as "wrong password", not
        # crash the login endpoint.
        return False


def create_access_token(*, user_id: str, permissions: list[str]) -> str:
    """
    Short-lived, 15 minutes. Carries the permission list so routes do not need a
    database round-trip to authorise every request.

    The trade-off is real and worth stating: permissions changed mid-session
    take effect at the next refresh, not instantly. Fifteen minutes is the
    window. Checking the database on every request would close it, at the cost
    of a query on every single call — and this is the same reason the frontend
    tells people "changes apply at next sign-in".
    """
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "perms": permissions,
        "type": "access",
        # A unique id per token.
        #
        # iat and exp are whole seconds, so two tokens minted for the same user
        # in the same second are byte-identical — which showed up immediately
        # when a refresh ran right after a login and returned the token it was
        # supposed to replace.
        #
        # It also leaves room to revoke one token rather than a whole session,
        # if that is ever needed. Sixteen bytes to keep both doors open.
        "jti": secrets.token_urlsafe(12),
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token() -> tuple[str, str, datetime]:
    """
    Returns (raw_token, hash_to_store, expires_at).

    The raw token goes to the browser; only its hash is stored. The database is
    one of the places a token could leak from, and a hash there is worthless to
    an attacker.

    This is an opaque random string, not a JWT, because its only job is to be
    looked up and revoked — and being able to revoke it is the entire point of
    storing it at all.
    """
    raw = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_DAYS)
    return raw, token_hash, expires


def hash_refresh_token(raw: str) -> str:
    """SHA-256, not argon2. A 48-byte random token has nothing to brute force,
    so a deliberately slow hash would only make every refresh slower."""
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_device_code() -> str:
    """
    A 6-digit numeric code — this gets typed by hand into a tablet once
    during setup, and a tablet's on-screen input is usually a numeric pad
    rather than a full keyboard, so digits-only is faster and less
    error-prone to enter than a mixed alphanumeric code. Six digits also
    matches the kiosk PIN's length, so the two short numeric codes an admin
    hands out for kiosk setup are consistent with each other.

    Shorter than the PIN's threat model would suggest is fine here for the
    same reason the PIN itself is short: the security boundary is
    server-side (this code only works over HTTPS, is shown exactly once,
    and is revocable per device), so the code only needs to resist a blind
    guess, not a targeted, sustained attack. A million possibilities is
    already far more than anyone is going to blindly submit as HTTPS
    requests to register a fake kiosk.
    """
    alphabet = "0123456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


def hash_device_code(raw: str) -> str:
    """Same reasoning as hash_refresh_token: an opaque random value, so a
    fast hash is correct — there's nothing weak to protect against brute
    force offline, only against the hash being read directly from a backup."""
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_pin() -> str:
    """A 6-digit PIN, admin-generated, shown once. Digits only because it's
    typed on the kiosk's on-screen numeric pad, not a keyboard."""
    return "".join(secrets.choice("0123456789") for _ in range(6))


def decode_token(token: str) -> dict | None:
    """Returns the claims, or None if the token is invalid, expired or forged."""
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None