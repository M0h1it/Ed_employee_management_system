"""shift policy versions

Adds shift_policy_versions — a history of shift policy changes, each with
its own effective_from date. This is what makes a policy change stop
silently rewriting how every past day is reported.

WHY A SEPARATE TABLE RATHER THAN VERSIONING `shifts` ITSELF
------------------------------------------------------------------
`shifts` already has 9 read sites across the codebase (employees.py,
org.py, export.py, settings.py, dashboard.py, attendance.py,
corrections.py, seed.py) that all want "the current policy" and nothing
more — versioning the table itself would mean rewriting every one of them
to pick a row, when only 4 of those 9 (the ones that feed build_day() to
compute a specific day's attendance) actually need date-awareness at all.

Keeping `shifts` as "the current/latest policy" (unchanged shape, unchanged
behaviour for the 5 sites that only read it) and adding this table
alongside it means:
  - Saving a new policy updates `shifts` in place (so "what is the policy
    right now" keeps working with zero changes) AND inserts a row here
    with today's effective_from (so "what was the policy on day X" becomes
    answerable for every future day).
  - Days before this migration ran have no history row and fall back to
    whatever `shifts` said at read time — the same behaviour as before this
    feature existed, not a data-loss regression.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b7f4d1e08a26"
down_revision = "a4d92c6e1f73"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shift_policy_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("shift_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("grace_minutes", sa.Integer(), nullable=False),
        sa.Column("min_hours", sa.Numeric(4, 2), nullable=False),
        # The date this version takes effect, inclusive. build_day() for a
        # given day picks the version with the LATEST effective_from that
        # is still <= that day — see pick_shift_for_date in
        # attendance_rules.py.
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_shift_policy_versions_effective_from",
        "shift_policy_versions", ["effective_from"],
    )
    # One version per shift per day — saving the policy twice in one day
    # (a typo, then a correction) updates that same day's version rather
    # than creating an ambiguous second one effective from the same date.
    op.create_unique_constraint(
        "uq_shift_policy_versions_shift_effective_from",
        "shift_policy_versions", ["shift_id", "effective_from"],
    )


def downgrade() -> None:
    op.drop_table("shift_policy_versions")