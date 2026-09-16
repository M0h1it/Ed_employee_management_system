"""
app/models/audit.py

Who changed what, and what it looked like before.

Level 6 of the access model. The other five stop the wrong action; this one
answers the question afterwards — which is the only control that still works
once somebody with legitimate access does something they should not have.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import UUIDPrimaryKey


class AuditLog(UUIDPrimaryKey, Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_entity", "entity", "entity_id"),)

    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    entity: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(60), nullable=False)

    # JSONB, not JSON: it is indexable and queryable, so "show me every change
    # to this person's role" stays answerable as the table grows.
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)

    ip_address: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
