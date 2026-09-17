"""
app/schemas/admin.py

Roles, permissions and login accounts.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PermissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    code: str
    module: str
    label: str
    description: str


class RoleOut(BaseModel):
    id: UUID
    name: str
    description: str
    isSystem: bool
    permissions: list[str]
    userCount: int


class RoleCreate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    description: str = Field(default="", max_length=500)
    permissions: list[str] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    permissions: list[str] | None = None


class UserOut(BaseModel):
    id: UUID
    employeeId: UUID
    employeeName: str
    employeePhotoUrl: str | None = None
    username: str
    roleId: UUID
    roleName: str
    isActive: bool
    mustChangePassword: bool
    # Whether a kiosk PIN has ever been generated for this account — never
    # the PIN itself, not even hashed, the same "boolean only" pattern
    # mustChangePassword already uses. This is what lets the admin UI show
    # a "PIN set" indicator without exposing anything that could be used
    # to guess or verify the actual PIN.
    hasPinSet: bool
    lastLoginAt: datetime | None = None
    createdAt: datetime
    # Never a password field, in any direction. Not even hashed.


class UserCreate(BaseModel):
    employeeId: UUID
    username: str = Field(min_length=3, max_length=60, pattern=r"^[a-z0-9._-]+$")
    temporaryPassword: str = Field(min_length=8, max_length=200)
    roleId: UUID
    mustChangePassword: bool = True


class ResetPasswordRequest(BaseModel):
    # No currentPassword. An admin reset does not require knowing the old one —
    # that is the entire point, the person has forgotten it. The self-service
    # change under /me/password DOES require it.
    newPassword: str = Field(min_length=8, max_length=200)
    mustChangePassword: bool = True


class SetStatusRequest(BaseModel):
    isActive: bool


class PinGenerated(BaseModel):
    """
    Returned exactly once, at generation — same shape as DeviceCreated in
    app/schemas/device.py. The plain-text PIN is never retrievable again;
    losing it means generating a new one, which invalidates the old.
    """
    userId: UUID
    pin: str
    mustChangePin: bool


class ChangeRoleRequest(BaseModel):
    roleId: UUID