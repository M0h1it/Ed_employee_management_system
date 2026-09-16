"""
app/cleanup_punch_photos.py

Deletes punch confirmation photos (photo_ref on PunchEvent) older than
PUNCH_PHOTO_RETENTION_DAYS (90, per PHASE-3-BRIEF.md's consent section).
Run on a schedule (cron, a systemd timer, whatever the deployment already
uses) — this script does one pass and exits, it is not a long-running
process:

    python -m app.cleanup_punch_photos
    python -m app.cleanup_punch_photos --dry-run   # report only, delete nothing

WHAT THIS DOES AND DOES NOT TOUCH
--------------------------------------
Deletes the FILE on disk and clears photo_ref (sets it to NULL) on the
PunchEvent row. It never touches the row itself: PunchEvent is append-only
by this project's own design rule (see PHASE-3-BRIEF.md — "Punch events are
append-only. Never updated, never deleted"), and clearing photo_ref is not
an exception to that rule so much as photo_ref recording "no photo exists
for this row anymore" the same way it already recorded "no photo was ever
taken" for a PIN punch (photo_ref is nullable and already None on that
path). The punch itself — who, when, which direction — is permanent
evidence exactly as before; only the photograph, the thing with an
explicit retention window, is removed.

Embeddings (face_templates) are NEVER touched by this job — those are a
separate retention policy (kept while the person is enrolled, deleted on
enrolment withdrawal per Phase 3's consent section) with nothing to do
with the 90-day window here.

WHY A SEPARATE SCRIPT RATHER THAN A BACKGROUND TASK INSIDE THE API PROCESS
----------------------------------------------------------------------------
A cron-style job that runs, does its work, and exits is far easier to
reason about than a scheduler living inside the same process that serves
kiosk punches — a bug in retention logic cannot affect punch latency or
availability if it is not in the same process at all, and re-running this
script after a crash mid-run is always safe (see the idempotency note
below), which a stuck in-process scheduler is not.

IDEMPOTENT AND SAFE TO RE-RUN
-----------------------------------
Each punch is handled independently: if a photo file is already gone (a
previous run deleted it, or it never existed) the row's photo_ref is still
cleared and the run continues — a missing file is not treated as an error
that stops the whole pass. Running this twice in a row, or after a crash
partway through, produces the same end state as running it once.
"""

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import PunchEvent

PUNCH_PHOTO_RETENTION_DAYS = 90

# Mirrors PUNCH_PHOTO_DIR in app/api/v1/face.py — duplicated as a literal
# here rather than imported, so this maintenance script has no dependency
# on the FastAPI app module (which pulls in the face-matching stack,
# InsightFace included) just to run a scheduled cleanup pass.
PUNCH_PHOTO_DIR = Path("uploads/punch_photos")


async def run(dry_run: bool) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=PUNCH_PHOTO_RETENTION_DAYS)

    async with SessionLocal() as session:
        rows = (await session.execute(
            select(PunchEvent).where(
                PunchEvent.photo_ref.is_not(None),
                PunchEvent.ts < cutoff,
            )
        )).scalars().all()

        if not rows:
            print(f"No punch photos older than {PUNCH_PHOTO_RETENTION_DAYS} days. Nothing to do.")
            return

        print(f"{len(rows)} punch photo(s) older than {PUNCH_PHOTO_RETENTION_DAYS} days"
              f" (cutoff: {cutoff.isoformat()}).")

        deleted, missing, failed = 0, 0, 0

        for punch in rows:
            # photo_ref is stored as "/uploads/punch_photos/<name>.jpg" (see
            # _save_punch_photo in app/api/v1/face.py) — only the filename
            # is trusted from it, never the full path, so a corrupted or
            # unexpected value in the column can never cause a write/delete
            # outside PUNCH_PHOTO_DIR.
            filename = Path(punch.photo_ref).name
            file_path = PUNCH_PHOTO_DIR / filename

            if dry_run:
                print(f"  would delete {file_path} (punch {punch.id}, {punch.ts.isoformat()})")
                continue

            try:
                file_path.unlink()
                deleted += 1
            except FileNotFoundError:
                # Already gone — a previous run, or manual cleanup. Still
                # clear photo_ref below; the row should not keep pointing
                # at a file that does not exist.
                missing += 1
            except OSError as exc:
                # Permissions, disk issue, etc. — skip THIS row's photo_ref
                # clear too, so the next run retries it rather than the
                # database silently disagreeing with what is actually on
                # disk.
                failed += 1
                print(f"  FAILED to delete {file_path}: {exc}", file=sys.stderr)
                continue

            punch.photo_ref = None

        if not dry_run:
            await session.commit()
            print(f"Deleted {deleted}, already-missing {missing}, failed {failed}.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report what would be deleted without deleting anything or touching the database.",
    )
    args = parser.parse_args()
    asyncio.run(run(dry_run=args.dry_run))


if __name__ == "__main__":
    main()