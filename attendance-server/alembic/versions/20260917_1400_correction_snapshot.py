"""correction snapshot columns

Adds snapshot_in/snapshot_out to corrections — what the register said AT
THE MOMENT the correction was requested, captured once and never
recomputed.

THE BUG THIS FIXES
----------------------
CorrectionOut's currentIn/currentOut were previously recomputed live, every
time the corrections list was read (see _current_times in
app/api/v1/corrections.py) — not stored anywhere. If a punch changed after
a correction was submitted (a later manual entry, another correction, a
kiosk retry), the "before" side of an already-submitted correction would
silently show a different value than what the requester actually saw and
responded to. In the reported case, an admin typed "09:53" as the FIX for
a register that said "15:23" at request time — but by the time the
correction was viewed later, a new 09:53 punch had been added directly,
and the live recomputation made 09:53 look like the OLD value being
struck through, the opposite of what was requested.

Nullable, not backfilled: existing correction rows have no way to recover
what the register said when they were created — that moment is gone. They
keep falling back to the live recomputation (the old behaviour) rather
than showing an invented value. Every correction created after this
migration gets a real, permanent snapshot.
"""

from alembic import op
import sqlalchemy as sa

revision = "c9e2a5f31b48"
down_revision = "b7f4d1e08a26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("corrections", sa.Column("snapshot_in", sa.DateTime(timezone=True), nullable=True))
    op.add_column("corrections", sa.Column("snapshot_out", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("corrections", "snapshot_out")
    op.drop_column("corrections", "snapshot_in")