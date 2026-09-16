"""
app/api/v1/audit.py

Reading the audit log.

READ ONLY, DELIBERATELY
------------------------
There is no POST, no PATCH and no DELETE here. Rows are written by the code that
performs the change, in the same transaction, and nothing in the application can
alter them afterwards.

A log that the application can edit is not evidence — it is a record that the
one person you would most want to trace has the means to rewrite. The value of
this table is precisely that no endpoint exists to touch it.
"""

from datetime import date, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, requires
from app.core.db import get_session
from app.models import AuditLog, Employee, User
from app.schemas.common import Paginated, page_meta

router = APIRouter(tags=["audit"])


class AuditEntryOut(BaseModel):
    id: UUID
    actorUserId: UUID | None = None
    actorName: str
    action: str
    entity: str
    entityId: str
    before: dict | None = None
    after: dict | None = None
    ipAddress: str | None = None
    createdAt: datetime


@router.get("/audit", response_model=Paginated[AuditEntryOut])
async def list_audit(
    action: str | None = None,
    entity: str | None = None,
    actorUserId: UUID | None = None,
    dateFrom: date | None = None,
    dateTo: date | None = None,
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=25, ge=1, le=100),
    _: Actor = Depends(requires("audit.view")),
    session: AsyncSession = Depends(get_session),
):
    stmt = select(AuditLog)

    if action:
        # A prefix match, so "user" finds user.create, user.disable and
        # user.change_role without listing every one.
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    if entity:
        stmt = stmt.where(AuditLog.entity == entity)
    if actorUserId:
        stmt = stmt.where(AuditLog.actor_user_id == actorUserId)
    if dateFrom:
        stmt = stmt.where(func.date(AuditLog.created_at) >= dateFrom)
    if dateTo:
        stmt = stmt.where(func.date(AuditLog.created_at) <= dateTo)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(or_(AuditLog.action.ilike(pattern), AuditLog.entity_id.ilike(pattern)))

    total = (await session.execute(
        select(func.count()).select_from(stmt.subquery()))).scalar_one()

    # Newest first. An audit log is read from the top — "what just happened" far
    # more often than "what happened first".
    stmt = stmt.order_by(AuditLog.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize)
    rows = (await session.execute(stmt)).scalars().all()

    # Actor names in one query for the whole page, not one per row.
    actor_ids = {r.actor_user_id for r in rows if r.actor_user_id}
    names: dict[UUID, str] = {}
    if actor_ids:
        users = (await session.execute(
            select(User).options(selectinload(User.employee)).where(User.id.in_(actor_ids)))
        ).scalars().all()
        names = {u.id: (u.employee.name if u.employee else u.username) for u in users}

    return Paginated(
        data=[
            AuditEntryOut(
                id=r.id,
                actorUserId=r.actor_user_id,
                # A deleted account leaves its rows behind — that is the point
                # of an audit log — so the name has to degrade rather than fail.
                actorName=names.get(r.actor_user_id, "System" if r.actor_user_id is None else "Removed account"),
                action=r.action,
                entity=r.entity,
                entityId=r.entity_id,
                before=r.before,
                after=r.after,
                ipAddress=r.ip_address,
                createdAt=r.created_at,
            )
            for r in rows
        ],
        meta=page_meta(page=page, page_size=pageSize, total=total),
    )


@router.get("/audit/actions", response_model=dict)
async def audit_actions(
    _: Actor = Depends(requires("audit.view")),
    session: AsyncSession = Depends(get_session),
):
    """The action types actually present, so the filter offers real options
    rather than a hard-coded list that drifts from the code."""
    rows = (await session.execute(
        select(AuditLog.action, func.count())
        .group_by(AuditLog.action)
        .order_by(func.count().desc()))).all()
    return {"data": [{"action": a, "count": c} for a, c in rows]}
