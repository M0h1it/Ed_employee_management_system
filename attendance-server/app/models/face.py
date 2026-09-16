"""
app/models/face.py

Face templates for the Phase 3 kiosk.

The table is created now because enabling pgvector and shaping this column on a
laptop is one line; doing it later on a live production database is a change
request. Nothing writes to it until Phase 3.

WHAT IS STORED, AND WHAT IS NOT
--------------------------------
An embedding — 512 floats describing the face — and never the photograph. The
source image is deleted after encoding. An embedding is not reversible into a
usable picture, which materially changes what a database leak would mean.

This is employee biometric data processed by an employer. Written consent, a
defined retention period and a non-biometric fallback for anyone who declines
are requirements, not niceties, and need legal review before Phase 3 ships.
"""

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import UUIDPrimaryKey


class FaceTemplate(UUIDPrimaryKey, Base):
    __tablename__ = "face_templates"
    __table_args__ = (
        # ivfflat with cosine distance. Without an index every match is a
        # sequential scan of every template — fine at forty people, slow at
        # four hundred, and the kiosk has somebody standing in front of it.
        Index(
            "ix_face_embedding",
            "embedding",
            postgresql_using="ivfflat",
            postgresql_with={"lists": 100},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # 512 dimensions — ArcFace output. Several rows per employee (different
    # angles and lighting), because one template fails the moment somebody
    # wears their glasses.
    embedding: Mapped[list[float]] = mapped_column(Vector(512), nullable=False)

    quality_score: Mapped[float | None] = mapped_column(Float)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
