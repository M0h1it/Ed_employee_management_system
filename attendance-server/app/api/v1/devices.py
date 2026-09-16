"""
app/api/v1/devices.py

Kiosk device registration, under devices.manage.

THE MODEL: ONE CODE PER DEVICE, ENTERED ONCE
-----------------------------------------------
An admin registers a device here, gets a code back, and types that code into
the kiosk tablet's setup screen once. The tablet stores it locally from then
on and sends it with every kiosk request. There is no separate "device login"
flow and no user account involved — the code IS the device's identity.

Revoking sets is_active to False. The row is never deleted: the punches that
device recorded point at it by device_id, and a deleted row would orphan
them. The same "status flag, not DELETE" reasoning as Employee.status.
"""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, requires
from app.core.audit import record_audit
from app.core.db import get_session
from app.core.security import generate_device_code, hash_device_code
from app.models import AuditLog, Device, User
from app.schemas.common import Single
from app.schemas.device import DeviceCreate, DeviceCreated, DeviceHistoryEntry, DeviceOut

router = APIRouter(tags=["devices"])


def _out(device: Device) -> DeviceOut:
    return DeviceOut(
        id=device.id,
        name=device.name,
        location=device.location,
        isActive=device.is_active,
        createdAt=device.created_at,
        lastSeenAt=device.last_seen_at,
        revokedAt=device.revoked_at,
    )


@router.get("/devices", response_model=Single[list[DeviceOut]])
async def list_devices(
    _: Actor = Depends(requires("devices.manage")),
    session: AsyncSession = Depends(get_session),
):
    devices = (await session.execute(
        select(Device).order_by(Device.created_at.desc()))).scalars().all()
    return Single(data=[_out(d) for d in devices])


@router.post("/devices", response_model=Single[DeviceCreated], status_code=201)
async def register_device(
    body: DeviceCreate,
    request: Request,
    actor: Actor = Depends(requires("devices.manage")),
    session: AsyncSession = Depends(get_session),
):
    """
    Creates the device row and returns the plain-text code exactly once.

    The code is generated here, hashed for storage, and the RAW value is put
    in the response and nowhere else — not logged, not in the audit `after`
    (device_key_hash is in REDACTED_KEYS, and the raw code is never passed to
    record_audit at all, the same way a generated PIN never is).
    """
    code = generate_device_code()

    device = Device(
        name=body.name,
        location=body.location,
        device_key_hash=hash_device_code(code),
        is_active=True,
    )
    session.add(device)
    await session.flush()  # assigns device.id, needed for the audit row below

    await record_audit(
        session, actor_user_id=actor.user_id, action="device.register",
        entity="device", entity_id=device.id, request=request,
        after={"name": device.name, "location": device.location},
    )
    await session.commit()
    await session.refresh(device)

    return Single(data=DeviceCreated(device=_out(device), deviceCode=code))


@router.post("/devices/{device_id}/revoke", response_model=Single[DeviceOut])
async def revoke_device(
    device_id: UUID,
    request: Request,
    actor: Actor = Depends(requires("devices.manage")),
    session: AsyncSession = Depends(get_session),
):
    """
    A tablet that left the building. Revoking is immediate: the device's next
    request fails auth, whatever it's mid-way through. A queued offline punch
    on a revoked tablet never reaches the server — which is the intended
    trade-off, not a gap: a stolen tablet keeping the ability to submit
    punches until someone notices the queue is the worse failure mode.
    """
    device = (await session.execute(
        select(Device).where(Device.id == device_id))).scalar_one_or_none()
    if device is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Device not found."}})

    was_active = device.is_active
    device.is_active = False
    device.revoked_at = datetime.now(timezone.utc)

    await record_audit(
        session, actor_user_id=actor.user_id, action="device.revoke",
        entity="device", entity_id=device.id, request=request,
        before={"isActive": was_active}, after={"isActive": False},
    )
    await session.commit()
    await session.refresh(device)

    return Single(data=_out(device))


@router.post("/devices/{device_id}/reactivate", response_model=Single[DeviceCreated])
async def reactivate_device(
    device_id: UUID,
    request: Request,
    actor: Actor = Depends(requires("devices.manage")),
    session: AsyncSession = Depends(get_session),
):
    """
    Brings a revoked device back as the SAME row, with a freshly generated
    code — deliberately different from register_device, which always
    creates a new row. This exists specifically so a tablet's history
    (created_at, every past revoke/reactivate in the audit log) stays
    attached to one id instead of splitting across rows every time it is
    taken out of service and put back.

    Only ever touches a device that is currently revoked. Reactivating an
    already-active device is not "renew its code" — that operation does not
    exist here on purpose, because silently invalidating a tablet's current,
    working code without an explicit revoke first is the kind of action that
    should never happen by accident.
    """
    device = (await session.execute(
        select(Device).where(Device.id == device_id))).scalar_one_or_none()
    if device is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Device not found."}})

    if device.is_active:
        raise HTTPException(422, detail={"error": {
            "code": "ALREADY_ACTIVE",
            "message": "This device is already active. Revoke it first if you need to issue a new code."}})

    code = generate_device_code()
    device.device_key_hash = hash_device_code(code)
    device.is_active = True
    device.revoked_at = None

    # Same redaction discipline as register_device: the raw code is never
    # passed to record_audit, only the fact that reactivation happened.
    await record_audit(
        session, actor_user_id=actor.user_id, action="device.reactivate",
        entity="device", entity_id=device.id, request=request,
        after={"name": device.name},
    )
    await session.commit()
    await session.refresh(device)

    return Single(data=DeviceCreated(device=_out(device), deviceCode=code))


@router.get("/devices/{device_id}/history", response_model=Single[list[DeviceHistoryEntry]])
async def get_device_history(
    device_id: UUID,
    _: Actor = Depends(requires("devices.manage")),
    session: AsyncSession = Depends(get_session),
):
    """
    Every register/revoke/reactivate event for this one device, newest
    first — pulled from the audit log rather than a dedicated table, since
    the audit log already carries exactly these facts against this device's
    id and a second table would only duplicate them.
    """
    device = (await session.execute(
        select(Device).where(Device.id == device_id))).scalar_one_or_none()
    if device is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Device not found."}})

    rows = (await session.execute(
        select(AuditLog)
        .where(AuditLog.entity == "device", AuditLog.entity_id == str(device_id))
        .order_by(AuditLog.created_at.desc())
        .limit(50)
    )).scalars().all()

    actor_ids = {r.actor_user_id for r in rows if r.actor_user_id is not None}
    actors: dict = {}
    if actor_ids:
        users = (await session.execute(
            select(User).where(User.id.in_(actor_ids)))).scalars().all()
        actors = {u.id: u.username for u in users}

    return Single(data=[
        DeviceHistoryEntry(
            action=r.action, at=r.created_at,
            actorName=actors.get(r.actor_user_id) if r.actor_user_id else None,
        )
        for r in rows
    ])