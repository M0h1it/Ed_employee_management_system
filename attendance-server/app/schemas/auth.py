"""
app/schemas/auth.py

Login request and response.

Pydantic models here are the CONTRACT, not the database rows. A SQLAlchemy
model returned directly would leak every column it happens to have — including
password_hash, failed_attempts and locked_until. Declaring the response shape
explicitly means a field can only reach the browser if somebody wrote it down.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=200)


class CurrentUser(BaseModel):
    """What the frontend's authStore holds after signing in."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    employeeId: UUID
    name: str
    email: str
    username: str
    photoUrl: str | None = None
    departmentName: str
    position: str

    # Display only. Nothing branches on this — see permissions below.
    roleName: str

    # A FLAT, RESOLVED list. The client should never have to work out "this
    # user has role X, role X contains Y and Z". That resolution has to happen
    # here anyway for enforcement, and doing it once avoids two implementations
    # that can disagree.
    permissions: list[str]

    mustChangePassword: bool
    attendanceTracked: bool


class LoginResponse(BaseModel):
    accessToken: str
    user: CurrentUser


class ChangePasswordRequest(BaseModel):
    # Required for a self-service change, unlike an admin reset. Without it,
    # anyone who found an unlocked laptop could lock the real owner out.
    currentPassword: str = Field(min_length=1)
    newPassword: str = Field(min_length=8, max_length=200)


class ChangePinRequest(BaseModel):
    """
    Self-service PIN change, same reasoning as ChangePasswordRequest:
    currentPin is required so an unlocked, unattended session cannot be used
    to lock the real owner out of the kiosk.
    """
    currentPin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    newPin: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")