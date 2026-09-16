"""kiosk pin and device timestamp

Adds:
  users.pin_hash            nullable String(255)  — argon2 hash, same as password_hash
  users.must_change_pin     Boolean, default False — same pattern as must_change_password
  punch_events.device_ts    nullable DateTime(timezone=True)

WHY pin_hash IS NULLABLE
-------------------------
Not every user will have a PIN on day one — the admin generates one per
employee as they're rolled onto the kiosk, matching how enrolment is staged
gradually rather than all at once. NULL means "no PIN set yet", not "PIN is
empty string": the login/fallback path must treat NULL as an explicit reject,
never as a match against an empty submitted value.

WHY device_ts IS SEPARATE FROM ts
-----------------------------------
`ts` (existing, non-nullable) is server-assigned — the instant the punch was
accepted, which is what attendance_rules computes against, and what the
UNIQUE idempotency constraint's minute bucket is built from. `device_ts` is
what the kiosk's own clock said at capture time, kept only for the offline
queue: a tablet can sit disconnected for a while, and if its clock drifted the
two timestamps diverging is the signal something is wrong with that device,
not a fact to reconcile automatically. Never derive attendance state from
device_ts.
"""

from alembic import op
import sqlalchemy as sa

revision = "e6a1f9c2b8d4"
down_revision = "c4a81f3e7d20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("pin_hash", sa.String(length=255), nullable=True))
    op.add_column(
        "users",
        sa.Column("must_change_pin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "punch_events",
        sa.Column("device_ts", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("punch_events", "device_ts")
    op.drop_column("users", "must_change_pin")
    op.drop_column("users", "pin_hash")