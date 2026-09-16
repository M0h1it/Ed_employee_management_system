"""device last seen

Adds devices.last_seen_at, updated on every accepted kiosk request. Purely
informational — nothing in the auth or matching path reads it. It exists so
the device list in Settings can show "last active 2 minutes ago" instead of
only a static registered date.
"""

from alembic import op
import sqlalchemy as sa

revision = "f3b7c1d9a052"
down_revision = "e6a1f9c2b8d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("devices", "last_seen_at")