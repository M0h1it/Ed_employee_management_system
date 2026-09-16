"""
app/api/v1/admin.py

Roles, permissions and login accounts — the screens that decide who can do what.

THE ESCALATION RULES LIVE HERE
-------------------------------
Everything else in this file is ordinary CRUD. The guards in
`role_change_error` and the last-admin checks are the part that matters: without
them, anybody who can change a role can make themselves an owner in one request,
and the whole permission system is decoration.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor, requires
from app.core.audit import record_audit
from app.core.db import get_session
from app.core.permissions import ALL_CODES, PERMISSIONS
from app.core.security import generate_pin, hash_password
from app.models import Employee, Permission, Role, User
from app.schemas.admin import (
    ChangeRoleRequest,
    PermissionOut,
    PinGenerated,
    ResetPasswordRequest,
    RoleCreate,
    RoleOut,
    RoleUpdate,
    SetStatusRequest,
    UserCreate,
    UserOut,
)
from app.schemas.common import Paginated, Single, page_meta

router = APIRouter(tags=["admin"])


def _forbidden(code: str, message: str, http_status: int = 403) -> HTTPException:
    return HTTPException(http_status, detail={"error": {"code": code, "message": message}})


async def _role_out(session: AsyncSession, role: Role) -> RoleOut:
    count = (
        await session.execute(
            select(func.count()).select_from(User).where(User.role_id == role.id)
        )
    ).scalar_one()
    return RoleOut(
        id=role.id,
        name=role.name,
        description=role.description,
        isSystem=role.is_system,
        permissions=sorted(p.code for p in role.permissions),
        userCount=count,
    )


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        employeeId=user.employee_id,
        employeeName=user.employee.name if user.employee else "",
        employeePhotoUrl=user.employee.photo_url if user.employee else None,
        username=user.username,
        roleId=user.role_id,
        roleName=user.role.name if user.role else "",
        isActive=user.is_active,
        mustChangePassword=user.must_change_password,
        lastLoginAt=user.last_login_at,
        createdAt=user.created_at,
    )


# ===========================================================================
# Permissions — read only, seeded from code
# ===========================================================================

@router.get("/permissions", response_model=Single[list[PermissionOut]])
async def list_permissions(
    _: Actor = Depends(requires("roles.manage")),
    session: AsyncSession = Depends(get_session),
):
    """
    There is no POST here, deliberately.

    A permission is a gate written into the application, in two places: the
    screen that hides a control, and the endpoint that refuses the request. One
    inserted at runtime would be consulted by nothing — a checkbox that appears
    to lock something down while locking down nothing, which is worse than no
    checkbox at all.

    New permissions arrive with new features, because the feature is what
    enforces them. What IS freely creatable is a role.
    """
    rows = (await session.execute(select(Permission).order_by(Permission.module, Permission.code))).scalars().all()
    return Single(data=[PermissionOut.model_validate(p) for p in rows])


# ===========================================================================
# Roles
# ===========================================================================

@router.get("/roles/assignable", response_model=Single[list[RoleOut]])
async def assignable_roles(
    actor: Actor = Depends(requires("users.change_role")),
    session: AsyncSession = Depends(get_session),
):
    """
    The roles this caller may hand out — not every role that exists.

    DECLARED BEFORE /roles/{role_id} ON PURPOSE. FastAPI matches routes in
    declaration order; the other way round, "assignable" would be parsed as a
    role id and this endpoint would be unreachable.

    The filtering is a convenience for the dropdown. The check that matters runs
    again on the write below — a filtered list stops nobody from calling the
    endpoint directly.
    """
    roles = (await session.execute(
        select(Role).options(selectinload(Role.permissions)).order_by(Role.name))).scalars().all()

    allowed = [r for r in roles if {p.code for p in r.permissions} <= actor.permissions]
    return Single(data=[await _role_out(session, r) for r in allowed])


@router.get("/roles", response_model=Single[list[RoleOut]])
async def list_roles(
    _: Actor = Depends(requires("roles.manage")),
    session: AsyncSession = Depends(get_session),
):
    roles = (await session.execute(
        select(Role).options(selectinload(Role.permissions)).order_by(Role.name))).scalars().all()
    return Single(data=[await _role_out(session, r) for r in roles])


@router.post("/roles", response_model=Single[RoleOut], status_code=status.HTTP_201_CREATED)
async def create_role(
    body: RoleCreate,
    request: Request,
    actor: Actor = Depends(requires("roles.manage")),
    session: AsyncSession = Depends(get_session),
):
    name = body.name.strip()
    clash = (await session.execute(
        select(Role).where(func.lower(Role.name) == name.lower()))).scalar_one_or_none()
    if clash:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Please fix the highlighted fields.",
            "fields": {"name": "A role with this name already exists"}}})

    unknown = set(body.permissions) - ALL_CODES
    if unknown:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED",
            "message": f"Unknown permissions: {', '.join(sorted(unknown))}"}})

    # You cannot create a role more powerful than you are. Without this,
    # roles.manage alone would be enough to build an "everything" role and
    # assign yourself to it.
    escalating = set(body.permissions) - actor.permissions
    if escalating:
        raise _forbidden("ESCALATION",
                         f"You cannot grant access you do not have yourself "
                         f"({', '.join(sorted(escalating)[:3])}).")

    rows = (await session.execute(
        select(Permission).where(Permission.code.in_(body.permissions)))).scalars().all()

    role = Role(name=name, description=body.description.strip(), is_system=False, permissions=rows)
    session.add(role)
    await session.flush()

    await record_audit(
        session, actor_user_id=actor.user_id, action="role.create",
        entity="role", entity_id=role.id, request=request,
        after={"name": role.name, "permissions": ",".join(sorted(body.permissions))},
    )
    await session.commit()
    await session.refresh(role, ["permissions"])
    return Single(data=await _role_out(session, role))


@router.patch("/roles/{role_id}", response_model=Single[RoleOut])
async def update_role(
    role_id: UUID,
    body: RoleUpdate,
    request: Request,
    actor: Actor = Depends(requires("roles.manage")),
    session: AsyncSession = Depends(get_session),
):
    role = (await session.execute(
        select(Role).options(selectinload(Role.permissions)).where(Role.id == role_id))
    ).scalar_one_or_none()
    if role is None:
        raise _forbidden("NOT_FOUND", "Role not found.", 404)

    # Captured BEFORE anything is mutated. Reading it afterwards would record
    # the new state twice and make the diff useless.
    before = {
        "name": role.name,
        "description": role.description,
        "permissions": ",".join(sorted(p.code for p in role.permissions)),
    }

    if body.name and body.name.strip() != role.name:
        if role.is_system:
            # Somebody renames "Owner" on a Friday and nobody can find the
            # administrator role on Monday.
            raise _forbidden("SYSTEM_ROLE", "System roles cannot be renamed.")
        role.name = body.name.strip()

    if body.description is not None:
        role.description = body.description.strip()

    if body.permissions is not None:
        unknown = set(body.permissions) - ALL_CODES
        if unknown:
            raise HTTPException(422, detail={"error": {
                "code": "VALIDATION_FAILED",
                "message": f"Unknown permissions: {', '.join(sorted(unknown))}"}})

        escalating = set(body.permissions) - actor.permissions
        if escalating:
            raise _forbidden("ESCALATION",
                             f"You cannot grant access you do not have yourself "
                             f"({', '.join(sorted(escalating)[:3])}).")

        # THE LAST-ADMIN GUARD.
        # Removing roles.manage from the only role that has it, and that
        # somebody actually uses, locks everyone out of this screen permanently
        # — with no way back through the UI. The fix would be a manual SQL
        # UPDATE on production.
        if "roles.manage" not in body.permissions and "roles.manage" in {p.code for p in role.permissions}:
            others = (await session.execute(
                select(Role).options(selectinload(Role.permissions)).where(Role.id != role_id))
            ).scalars().all()

            someone_else_can = False
            for other in others:
                if "roles.manage" not in {p.code for p in other.permissions}:
                    continue
                in_use = (await session.execute(
                    select(func.count()).select_from(User).where(
                        User.role_id == other.id, User.is_active.is_(True)))).scalar_one()
                if in_use > 0:
                    someone_else_can = True
                    break

            if not someone_else_can:
                raise _forbidden(
                    "LAST_ADMIN",
                    'At least one role in use must keep "Manage roles", '
                    "or nobody could change permissions again.",
                    409,
                )

        rows = (await session.execute(
            select(Permission).where(Permission.code.in_(body.permissions)))).scalars().all()
        role.permissions = rows

    await session.flush()
    await record_audit(
        session, actor_user_id=actor.user_id, action="role.update",
        entity="role", entity_id=role.id, request=request,
        before=before,
        after={
            "name": role.name,
            "description": role.description,
            "permissions": ",".join(sorted(p.code for p in role.permissions)),
        },
    )
    await session.commit()
    await session.refresh(role, ["permissions"])
    return Single(data=await _role_out(session, role))


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: UUID,
    request: Request,
    actor: Actor = Depends(requires("roles.manage")),
    session: AsyncSession = Depends(get_session),
):
    role = (await session.execute(select(Role).where(Role.id == role_id))).scalar_one_or_none()
    if role is None:
        raise _forbidden("NOT_FOUND", "Role not found.", 404)

    if role.is_system:
        raise _forbidden("SYSTEM_ROLE", "System roles cannot be deleted.")

    in_use = (await session.execute(
        select(func.count()).select_from(User).where(User.role_id == role.id))).scalar_one()
    if in_use:
        # The foreign key is ondelete="RESTRICT", so the database would refuse
        # this anyway. Checking here turns a raw integrity error into a sentence
        # somebody can act on.
        raise _forbidden(
            "ROLE_IN_USE",
            f"{in_use} account{'s' if in_use != 1 else ''} still use this role. Move them first.",
            409,
        )

    await record_audit(
        session, actor_user_id=actor.user_id, action="role.delete",
        entity="role", entity_id=role.id, request=request,
        before={"name": role.name, "description": role.description},
    )
    await session.delete(role)
    await session.commit()
    return None


# ===========================================================================
# Users
# ===========================================================================

@router.get("/users", response_model=Paginated[UserOut])
async def list_users(
    search: str | None = None,
    roleId: UUID | None = None,
    isActive: bool | None = None,
    employeeId: UUID | None = None,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=20, ge=1, le=100),
    actor: Actor = Depends(requires("users.manage", "users.change_role")),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(User).options(selectinload(User.employee), selectinload(User.role))

    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.join(Employee).where(
            or_(User.username.ilike(pattern), Employee.name.ilike(pattern)))
    if roleId:
        stmt = stmt.where(User.role_id == roleId)
    if isActive is not None:
        stmt = stmt.where(User.is_active.is_(isActive))
    if employeeId:
        stmt = stmt.where(User.employee_id == employeeId)

    total = (await session.execute(
        select(func.count()).select_from(stmt.subquery()))).scalar_one()

    stmt = stmt.order_by(User.username).offset((page - 1) * pageSize).limit(pageSize)
    rows = (await session.execute(stmt)).scalars().all()

    return Paginated(data=[_user_out(u) for u in rows],
                     meta=page_meta(page=page, page_size=pageSize, total=total))


@router.post("/users", response_model=Single[UserOut], status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    request: Request,
    actor: Actor = Depends(requires("users.manage")),
    session: AsyncSession = Depends(get_session),
):
    fields: dict[str, str] = {}

    employee = (await session.execute(
        select(Employee).where(Employee.id == body.employeeId))).scalar_one_or_none()
    if employee is None:
        fields["employeeId"] = "Choose an employee"

    role = (await session.execute(
        select(Role).options(selectinload(Role.permissions)).where(Role.id == body.roleId))
    ).scalar_one_or_none()
    if role is None:
        fields["roleId"] = "Choose a role"

    username = body.username.strip().lower()
    if (await session.execute(select(User).where(User.username == username))).scalar_one_or_none():
        fields["username"] = "This username is taken"

    if employee and (await session.execute(
            select(User).where(User.employee_id == employee.id))).scalar_one_or_none():
        fields["employeeId"] = "This person already has a login"

    if fields:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED",
            "message": "Please fix the highlighted fields.", "fields": fields}})

    # The same subset rule as a role change: creating an account with a role
    # more powerful than your own is escalation by another route.
    escalating = {p.code for p in role.permissions} - actor.permissions
    if escalating:
        raise _forbidden("ESCALATION",
                         f"You cannot grant access you do not have yourself "
                         f"({', '.join(sorted(escalating)[:3])}).")

    user = User(
        employee_id=employee.id,
        username=username,
        password_hash=hash_password(body.temporaryPassword),
        role_id=role.id,
        is_active=True,
        must_change_password=body.mustChangePassword,
    )
    session.add(user)
    await session.flush()

    await record_audit(
        session, actor_user_id=actor.user_id, action="user.create",
        entity="user", entity_id=user.id, request=request,
        after={
            "username": user.username,
            "employee": employee.name,
            "role": role.name,
            "temporaryPassword": body.temporaryPassword,   # redacted by the helper
        },
    )
    await session.commit()
    await session.refresh(user, ["employee", "role"])

    # The response carries no password, not even the one just set. The admin
    # saw it in the form they typed it into; after this it is unrecoverable and
    # only resettable.
    return Single(data=_user_out(user))


@router.patch("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: UUID,
    body: ResetPasswordRequest,
    request: Request,
    actor: Actor = Depends(requires("users.manage")),
    session: AsyncSession = Depends(get_session),
):
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise _forbidden("NOT_FOUND", "Account not found.", 404)

    user.password_hash = hash_password(body.newPassword)
    user.must_change_password = body.mustChangePassword
    # A reset also clears a lockout — otherwise the person still cannot sign in
    # with the password they were just given.
    user.failed_attempts = 0
    user.locked_until = None

    # The new password is passed in and redacted by the helper, so the log
    # records THAT a reset happened without recording what it was reset to.
    await record_audit(
        session, actor_user_id=actor.user_id, action="user.reset_password",
        entity="user", entity_id=user.id, request=request,
        after={"username": user.username, "newPassword": body.newPassword,
               "mustChangePassword": body.mustChangePassword},
    )
    await session.commit()

    # 204: nothing to return, and nothing that could leak.
    return None


@router.post("/users/{user_id}/pin", response_model=Single[PinGenerated], status_code=201)
async def generate_pin_for_user(
    user_id: UUID,
    request: Request,
    actor: Actor = Depends(requires("pin.generate")),
    session: AsyncSession = Depends(get_session),
):
    """
    Admin-generated, shown once — same pattern as device registration, and
    for the same reason: the plain value only ever exists in this one
    response, never stored, never logged. Overwrites any existing PIN
    unconditionally; the previous one stops working the moment this commits,
    the same way a password reset invalidates the old password.

    Separate from reset_password's users.manage gate: pin.generate is the
    permission the brief calls out as distinct from general account
    management, because a PIN is a kiosk-attendance credential tied to the
    consent flow, not an admin/login-account concern.
    """
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise _forbidden("NOT_FOUND", "Account not found.", 404)

    pin = generate_pin()
    user.pin_hash = hash_password(pin)
    user.must_change_pin = True

    # No "newPin"/"pin" key here, on purpose — unlike reset_password, which
    # relies on REDACTED_KEYS to scrub newPassword. pin/newPin are not in
    # that set, and adding a raw PIN to a dict bound for record_audit is the
    # kind of change that is easy to get wrong once and never notice, so the
    # value simply never reaches this call.
    await record_audit(
        session, actor_user_id=actor.user_id, action="user.generate_pin",
        entity="user", entity_id=user.id, request=request,
        after={"username": user.username, "mustChangePin": True},
    )
    await session.commit()

    return Single(data=PinGenerated(userId=user.id, pin=pin, mustChangePin=True))


@router.patch("/users/{user_id}/status", response_model=Single[UserOut])
async def set_user_status(
    user_id: UUID,
    body: SetStatusRequest,
    request: Request,
    actor: Actor = Depends(requires("users.manage")),
    session: AsyncSession = Depends(get_session),
):
    user = (await session.execute(
        select(User).options(selectinload(User.employee), selectinload(User.role).selectinload(Role.permissions))
        .where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise _forbidden("NOT_FOUND", "Account not found.", 404)

    if not body.isActive:
        if user.id == actor.user_id:
            raise _forbidden("SELF_DISABLE",
                             "You cannot disable your own account.")

        # Disabling the last active account that can manage users locks
        # everybody out of account management.
        if "users.manage" in {p.code for p in user.role.permissions}:
            others = (await session.execute(
                select(User).options(selectinload(User.role).selectinload(Role.permissions))
                .where(User.id != user_id, User.is_active.is_(True)))).scalars().all()
            if not any("users.manage" in {p.code for p in o.role.permissions} for o in others):
                raise _forbidden(
                    "LAST_ADMIN",
                    "This is the last active account that can manage users.",
                    409,
                )

    # A toggle, never a DELETE. Deleting orphans the audit trail — attendance
    # history has to keep pointing at somebody.
    was_active = user.is_active
    user.is_active = body.isActive

    await record_audit(
        session, actor_user_id=actor.user_id,
        action="user.enable" if body.isActive else "user.disable",
        entity="user", entity_id=user.id, request=request,
        before={"username": user.username, "isActive": was_active},
        after={"username": user.username, "isActive": body.isActive},
    )
    await session.commit()
    await session.refresh(user, ["employee", "role"])
    return Single(data=_user_out(user))


@router.patch("/users/{user_id}/role", response_model=Single[UserOut])
async def change_user_role(
    user_id: UUID,
    body: ChangeRoleRequest,
    request: Request,
    actor: Actor = Depends(requires("users.change_role")),
    session: AsyncSession = Depends(get_session),
):
    """
    WHO MAY MOVE WHOM — three rules, all enforced here.

    1. NOT YOURSELF. Self-promotion is otherwise one request.
    2. NOT A PEER. You cannot move somebody who also holds users.change_role,
       unless you hold roles.manage. Without this, two managers can demote each
       other, or collude upward in two steps.
    3. SUBSET. You may only assign a role whose permissions you already hold.

    Rule 3 does the real work: escalation becomes impossible with no hard-coded
    hierarchy of roles to maintain. A manager cannot grant roles.manage because
    they do not have it, so they cannot create an owner.
    """
    target = (await session.execute(
        select(User).options(
            selectinload(User.employee),
            selectinload(User.role).selectinload(Role.permissions))
        .where(User.id == user_id))).scalar_one_or_none()
    if target is None:
        raise _forbidden("NOT_FOUND", "Account not found.", 404)

    if target.id == actor.user_id:
        raise _forbidden("SELF_ROLE_CHANGE",
                         "You cannot change your own role. Ask someone with higher access.")

    is_owner_level = actor.can("roles.manage")
    if "users.change_role" in {p.code for p in target.role.permissions} and not is_owner_level:
        raise _forbidden("PEER_ROLE_CHANGE",
                         "This person can already change roles themselves. "
                         "Only an owner can move them.")

    new_role = (await session.execute(
        select(Role).options(selectinload(Role.permissions)).where(Role.id == body.roleId))
    ).scalar_one_or_none()
    if new_role is None:
        raise _forbidden("NOT_FOUND", "That role does not exist.", 404)

    escalating = {p.code for p in new_role.permissions} - actor.permissions
    if escalating:
        raise _forbidden("ESCALATION",
                         f"You cannot grant access you do not have yourself "
                         f"({', '.join(sorted(escalating)[:3])}).")

    old_role_name = target.role.name
    target.role_id = new_role.id

    # The single most consequential action in the system, and the one most
    # worth being able to reconstruct later.
    await record_audit(
        session, actor_user_id=actor.user_id, action="user.change_role",
        entity="user", entity_id=target.id, request=request,
        before={"username": target.username, "role": old_role_name},
        after={"username": target.username, "role": new_role.name},
    )
    await session.commit()
    await session.refresh(target, ["employee", "role"])
    return Single(data=_user_out(target))