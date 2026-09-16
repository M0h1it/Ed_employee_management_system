"""
app/models/auth.py

Login accounts, roles and permissions.

WHY users IS A SEPARATE TABLE FROM employees
---------------------------------------------
Not every employee needs a login — a warehouse worker may only ever be punched
in at the kiosk. And access must be revocable without removing the person from
the directory or destroying their attendance history. Merging the two would
force a "has no password" state onto Employee and make disabling somebody
destructive.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import Timestamps, UUIDPrimaryKey

# Association table. No model class because it carries no data of its own —
# just the pairing. A class here would add ceremony with nothing to hold.
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", UUID(as_uuid=True), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


class Permission(UUIDPrimaryKey, Timestamps, Base):
    """
    A capability, seeded from code and never created through the API.

    A permission is a gate written into the application, in two places: the
    screen that hides a control, and the endpoint that refuses the request.
    A row invented at runtime would be consulted by nothing — a checkbox that
    appears to lock something down while locking down nothing, which is worse
    than having no checkbox at all.

    This table exists so roles can reference permissions by foreign key and the
    UI can read their descriptions. It is populated by the seed script.
    """

    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    module: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Role(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # System roles cannot be renamed or deleted. Without this, somebody deletes
    # "Owner" on a Friday and nobody can administer the system on Monday.
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    permissions: Mapped[list[Permission]] = relationship(
        secondary=role_permissions, lazy="selectin"
    )
    users: Mapped[list["User"]] = relationship(back_populates="role")


class User(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("employee_id", name="uq_users_employee"),)

    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    username: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)

    # An argon2 hash. The password itself is never stored, never returned by any
    # endpoint, never logged, and cannot be recovered — only reset.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # PIN fallback for the kiosk: face declined, offline, or repeated no-match.
    # An argon2 hash, same handling as password_hash — never stored or logged
    # in plain. NULL means no PIN has been generated for this user yet.
    pin_hash: Mapped[str | None] = mapped_column(String(255))
    must_change_pin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Lockout after repeated failures, so a stolen username cannot be brute
    # forced at leisure.
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    employee: Mapped["Employee"] = relationship(back_populates="user")  # noqa: F821
    role: Mapped[Role] = relationship(back_populates="users", lazy="selectin")


class RefreshToken(UUIDPrimaryKey, Timestamps, Base):
    """
    Refresh tokens are stored so they can be REVOKED.

    A plain stateless JWT cannot be cancelled — sign somebody out, or disable
    their account, and their existing token keeps working until it expires. For
    a 15-minute access token that is acceptable; for a 7-day refresh token it
    means a week of access after you tried to remove it.

    Only a hash is kept: the database is one of the places a token could leak
    from, and a hash there is worthless to an attacker.
    """

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))