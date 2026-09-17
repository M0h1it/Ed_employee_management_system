"""
scripts/verify_files_synced.py

Checks that every file this session touched actually has the expected
content on THIS machine — run this any time uvicorn fails to import, or
before assuming a fix is "not working" when it might just not be deployed
yet.

    python scripts/verify_files_synced.py

Exits non-zero and prints exactly which file is stale if anything is
missing, rather than a generic ImportError with a traceback that doesn't
say which of several possible files is the actual problem.
"""

import sys

CHECKS = [
    ("app/models/org.py", "class ShiftPolicyVersion"),
    ("app/models/__init__.py", "ShiftPolicyVersion"),
    ("app/domain/attendance_rules.py", "class ShiftPolicyVersion"),
    ("app/domain/attendance_rules.py", "def pick_shift_for_date"),
    ("app/domain/attendance_rules.py", "OVERTIME"),
    ("app/api/v1/attendance.py", "pick_shift_for_date"),
    ("app/api/v1/corrections.py", "snapshot_in"),
    ("app/api/v1/dashboard.py", "pick_shift_for_date"),
    ("app/api/v1/export.py", "pick_shift_for_date"),
    ("app/api/v1/settings.py", "effective_from"),
    ("app/models/attendance.py", "snapshot_in"),
    ("alembic/versions/20260917_0900_shift_policy_versions.py", "shift_policy_versions"),
    ("alembic/versions/20260917_1400_correction_snapshot.py", "snapshot_in"),
]

failures = []
for path, needle in CHECKS:
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        failures.append((path, needle, "FILE DOES NOT EXIST"))
        continue
    if needle not in content:
        failures.append((path, needle, "file exists but does not contain expected text"))

if failures:
    print(f"{len(failures)} file(s) are stale or missing:\n")
    for path, needle, reason in failures:
        print(f"  {path}")
        print(f"    looking for: {needle!r}")
        print(f"    {reason}\n")
    sys.exit(1)
else:
    print(f"All {len(CHECKS)} checks passed — every file is up to date.")
    sys.exit(0)