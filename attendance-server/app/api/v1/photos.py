"""
app/api/v1/photos.py

Employee photographs.

STORED ON DISK, NOT IN THE DATABASE
------------------------------------
A 200 KB image as a database column means every backup, every replica and every
`SELECT *` carries it. Files belong on a filesystem; the database keeps the path.

The tradeoff is that the uploads directory has to be backed up separately and
survive a redeploy — which is a real operational cost, and the reason this is a
local directory today and object storage the moment there is more than one
server.
"""

import hashlib
import secrets
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_current_actor
from app.core.audit import record_audit
from app.core.db import get_session
from app.models import Employee
from app.schemas.common import Single

router = APIRouter(tags=["photos"])

UPLOAD_DIR = Path("uploads/photos")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_BYTES = 2 * 1024 * 1024        # 2 MB

# Magic bytes, not the filename extension and not the Content-Type header.
#
# Both of those are supplied by the client and mean nothing: a .php renamed to
# .jpg arrives with a perfectly convincing image/jpeg header. What a file IS is
# determined by what is inside it.
SIGNATURES: dict[bytes, str] = {
    b"\xff\xd8\xff": "jpg",
    b"\x89PNG\r\n\x1a\n": "png",
    b"RIFF": "webp",               # RIFF....WEBP, checked further below
}


def detect_type(data: bytes) -> str | None:
    for signature, extension in SIGNATURES.items():
        if data.startswith(signature):
            if extension == "webp" and data[8:12] != b"WEBP":
                continue
            return extension
    return None


@router.post("/employees/{employee_id}/photo", response_model=Single[dict])
async def upload_photo(
    employee_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    """
    Anyone may replace their OWN photo. Replacing somebody else's needs
    employees.edit — a photograph is how people are identified in the register,
    so swapping one is not a cosmetic act.
    """
    if employee_id != actor.employee_id and not actor.can("employees.edit"):
        raise HTTPException(403, detail={"error": {
            "code": "FORBIDDEN", "message": "You can only change your own photo."}})

    employee = (await session.execute(
        select(Employee).where(Employee.id == employee_id))).scalar_one_or_none()
    if employee is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Employee not found."}})

    # Read with a cap rather than trusting Content-Length, which the client
    # also supplies. MAX_BYTES + 1 is enough to know it is over the limit
    # without pulling a 2 GB upload into memory to find out.
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(422, detail={"error": {
            "code": "FILE_TOO_LARGE",
            "message": "Photos must be under 2 MB.",
            "fields": {"file": "This file is too large"}}})
    if not data:
        raise HTTPException(422, detail={"error": {
            "code": "VALIDATION_FAILED", "message": "Please choose a file.",
            "fields": {"file": "No file was received"}}})

    extension = detect_type(data)
    if extension is None:
        raise HTTPException(422, detail={"error": {
            "code": "UNSUPPORTED_TYPE",
            "message": "Use a JPEG, PNG or WebP image.",
            "fields": {"file": "That is not an image this system can read"}}})

    # The stored name is generated, never taken from the upload. A client-supplied
    # filename is the classic path-traversal hole — "../../app/main.py" is a
    # perfectly valid string to send.
    stem = f"{employee_id}-{secrets.token_hex(8)}"
    destination = UPLOAD_DIR / f"{stem}.{extension}"
    destination.write_bytes(data)

    # The old file is removed AFTER the new one is written, so a failed write
    # never leaves the employee with no photo at all.
    previous = employee.photo_url
    if previous and previous.startswith("/uploads/photos/"):
        old = Path(previous.lstrip("/"))
        # resolve() then check the parent: a stored path should be inside the
        # uploads directory, and if it is not, something is wrong and deleting
        # is the last thing to do.
        try:
            if old.resolve().parent == UPLOAD_DIR.resolve():
                old.unlink(missing_ok=True)
        except OSError:
            pass

    employee.photo_url = f"/uploads/photos/{destination.name}"

    await record_audit(
        session, actor_user_id=actor.user_id, action="employee.photo",
        entity="employee", entity_id=employee.id, request=request,
        before={"photoUrl": previous},
        after={"photoUrl": employee.photo_url, "bytes": len(data), "type": extension},
    )
    await session.commit()

    return Single(data={"photoUrl": employee.photo_url})


@router.delete("/employees/{employee_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
async def remove_photo(
    employee_id: UUID,
    request: Request,
    actor: Actor = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
):
    if employee_id != actor.employee_id and not actor.can("employees.edit"):
        raise HTTPException(403, detail={"error": {
            "code": "FORBIDDEN", "message": "You can only change your own photo."}})

    employee = (await session.execute(
        select(Employee).where(Employee.id == employee_id))).scalar_one_or_none()
    if employee is None:
        raise HTTPException(404, detail={"error": {
            "code": "NOT_FOUND", "message": "Employee not found."}})

    previous = employee.photo_url
    if previous and previous.startswith("/uploads/photos/"):
        old = Path(previous.lstrip("/"))
        try:
            if old.resolve().parent == UPLOAD_DIR.resolve():
                old.unlink(missing_ok=True)
        except OSError:
            pass

    employee.photo_url = None
    await record_audit(
        session, actor_user_id=actor.user_id, action="employee.photo_removed",
        entity="employee", entity_id=employee.id, request=request,
        before={"photoUrl": previous},
    )
    await session.commit()
    # The UI falls back to initials, which is why removing a photo needs no
    # replacement and no empty-state handling anywhere.
    return None
