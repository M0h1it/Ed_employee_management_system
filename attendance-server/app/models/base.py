"""
app/models/base.py

Shared column patterns, so every table does not reinvent them.

WHY UUID PRIMARY KEYS AND NOT AUTO-INCREMENT INTEGERS
------------------------------------------------------
Three reasons that all matter for this system:

1. The Phase 3 kiosk generates punch records offline and syncs them later. With
   sequential integers it cannot know what id to use, so it would need a
   server round-trip before it could even record a punch — defeating the point
   of an offline queue. A UUID is generated on the device, correctly, with no
   coordination.
2. Integer ids leak business information. `/api/v1/employees/7` tells anyone
   who looks that you have at least seven employees, and lets them walk the
   range. This is the classic enumeration hole.
3. Merging data from two environments (a seeded dev database, a pilot branch)
   cannot collide.

The cost is 16 bytes instead of 4 and slightly less cache-friendly indexes.
At this scale that is invisible.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class UUIDPrimaryKey:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )


class Timestamps:
    """
    `server_default=func.now()` puts the clock on the DATABASE, not on the
    application server. Two API instances on machines whose clocks differ by a
    few seconds would otherwise write inconsistent ordering — and rows that
    appear to have been created before the thing that caused them.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
