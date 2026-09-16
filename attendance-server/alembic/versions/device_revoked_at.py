"""device revoked_at

Adds devices.revoked_at — set when a device is revoked, cleared when it is
reactivated. This is what turns "revoked" and "active again" into two states
of ONE row's history rather than two separate device rows: register_device
still only ever creates a brand-new row, but reactivate_device (new
endpoint, same file) flips an existing revoked row back to active and clears
this column, so the row's own created_at/revoked_at/last_seen_at together
tell the whole story of that one physical tablet.

Nothing reads this column to make an authorization decision — is_active
alone still decides whether a device can authenticate (see
get_current_device in app/api/deps.py). revoked_at is history only.
"""

from alembic import op
import sqlalchemy as sa

revision = "a4d92c6e1f73"
down_revision = "f3b7c1d9a052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("devices", "revoked_at")