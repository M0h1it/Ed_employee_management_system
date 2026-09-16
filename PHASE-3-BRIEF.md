# Attendance System — Phase 3 Brief

Everything decided so far, in one place. Read this first in a new conversation;
it is written to be picked up cold.

---

## Where the project stands

| Phase | State |
|-------|-------|
| 1 — Frontend on mock data | complete · 84 files |
| 2 — Backend, database, auth, RBAC | complete · 42 endpoints, 17 tables |
| **3 — Kiosk app and face recognition** | **next** |
| 4 — Shadow run | dropped by the client |
| 5 — Payroll export | dropped by the client |

**Verification in place:** 13 integration suites, 28 unit tests, a contract audit
that walks every endpoint the frontend calls, and a page audit that checks no
screen requests anything its viewer is not allowed to have. All pass, twice in a
row — they are written to be re-runnable.

---

## The stack

```
attendance-server/   FastAPI · SQLAlchemy async · PostgreSQL 16 + pgvector · Alembic
attendance-admin/    React 18 · TypeScript · Vite · TanStack Query · Zustand · Tailwind
attendance-kiosk/    React Native CLI · Android tablet          ← Phase 3
```

Postgres runs in Docker on **port 5433** (5432 is taken by a native install on
the development machine). Python 3.11. `tzdata` is a required dependency on
Windows.

---

## Phase 3 decisions — all settled

### The kiosk app

| Decision | Chosen | Why |
|----------|--------|-----|
| Platform | React Native CLI, Android tablet | Locks into kiosk mode, screen stays on |
| Trigger | **One button**, tap to start | Camera always-on would match every passer-by — that is surveillance, not attendance. A tap means the person started it |
| In or out | **Decided by the server**, not by the user | `is_currently_in()` reads the last punch. Two buttons let somebody tap "check out" at 9am and record their day backwards |
| Liveness | 3 frames over 1 second, micro-movement check | A photo held up to the tablet does not move. Without this one person can punch the whole office |
| Matching | **Server side** | Embeddings never reach the device. A stolen tablet would otherwise carry the whole company's biometric data |
| Confidence threshold | **0.85** | Below 0.70 → no match. 0.70–0.85 → "Are you Karan Patel?" confirm |
| Retry | 2 attempts → PIN → see your manager | Glasses, beard, lighting. Without a fallback people ask somebody else to punch for them, which is a bigger hole |
| Offline | **PIN + local queue** | Not a full offline mode. Wi-Fi drops; "the kiosk is broken" evenings are worse than half a day of work |
| Greeting | Photo + "Good morning, Karan Patel" / "Good evening … see you tomorrow" | The person sees immediately that the right face was matched |

### Enrolment

**Admin uploads one photo** (reuses the photo upload already built in Phase 2),
**plus automatic improvement**: any punch matching above **0.92** saves that
frame's embedding as an additional template. Capped at 5 per person, oldest
dropped.

Two weeks of normal use gives everyone 4–5 templates across different lighting
and days, with nobody called in for a photo session. `face_templates` allows
many rows per employee from migration 001, exactly for this.

**Quality check on upload is required**: face found, exactly one face, large
enough, not blurred. A dark or blurry enrolment photo makes every punch fail for
that person with no explanation anyone can see.

### PIN

- **Admin generates** an initial 6-digit PIN; shown once, never again
- **Employee can change it** in Settings, `must_change_pin` on first use
- **argon2 hashed**, same as passwords, never stored or logged in plain

Needed for the face fallback, for offline, and for anyone who declines biometric
enrolment.

### Hosting

**Hosted server, tablet over Wi-Fi.** Two consequences:

1. **HTTPS is mandatory.** The browser camera API refuses to run without it, and
   the device key would otherwise travel in plain text.
2. **Device key rotation** must exist from the start — a tablet that leaves the
   building needs revoking.

---

## What Phase 3 has to build

| # | Work | Estimate |
|---|------|----------|
| 1 | Migration: `users.pin_hash`, `must_change_pin`, `punch_events.device_ts` | 0.5 day |
| 2 | Face service: InsightFace (buffalo_l), enrol + match endpoints | 2 days |
| 3 | Enrolment UI: admin upload with quality check | 1 day |
| 4 | Device management: register, show key once, revoke | 1 day |
| 5 | PIN: admin generate, employee change | 0.5 day |
| 6 | **Kiosk app**: RN CLI, camera, 3 frames, greeting, state machine | 5 days |
| 7 | Offline queue + PIN fallback | 1 day |
| 8 | Auto-enrolment from high-confidence punches | 0.5 day |
| 9 | Photo retention cleanup job | 0.5 day |

**≈ 12 days.**

### Already in place from Phase 2 — nothing to build

- `face_templates` with `Vector(512)` and an ivfflat cosine index
- `devices` with `device_key_hash` and `is_active`
- `punch_events` with `confidence`, `photo_ref`, `device_id`, `idempotency_key`
- `idempotency_key` format: `employeeId:YYYY-MM-DD:DIRECTION:HHMM` — minute-level,
  so a replayed offline punch is rejected by a UNIQUE constraint rather than by
  application code two requests can both slip past
- `is_currently_in()` in `app/domain/attendance_rules.py`

---

## Kiosk state machine

```
IDLE
  Company name, clock, one large button

TAP → CAPTURING
  "Please look at the camera"
  3 frames over 1 second

MATCHING
  POST /api/v1/kiosk/punch  (device key, 3 frames)
  Server: liveness → embedding → pgvector nearest → direction from last punch

MATCH  (≥ 0.85)
  Photo + "Good morning, Karan Patel"
  "Checked in at 9:04 AM"
  → IDLE after 4s

UNSURE  (0.70 – 0.85)
  "Are you Karan Patel?"  [Yes] [No]

NO MATCH
  Attempt 2 → PIN screen → "Please see your manager"

OFFLINE
  PIN only. Punch queued locally.
  Banner: "3 punches waiting to sync"
```

---

## Still open — needed before code

**Biometric consent, reviewed by somebody qualified.** Raised four times and
still outstanding. This is the one item that cannot be fixed in code later.

Before anyone is enrolled:

- Written consent from each employee
- A defined retention period for punch photos (90 days suggested; 40 people × 2
  punches × 250 days ≈ 20,000 photos a year)
- Embeddings stored, source photographs deleted after encoding
- A PIN-only path for anyone who declines — already being built

---

## Design rules carried from Phases 1 and 2

These are load-bearing. Breaking one breaks something that currently works.

**Punch events are append-only.** Never updated, never deleted. A mistaken punch
is fixed by adding an approved `corrections` row on top, and the day is computed
from both. The first time somebody disputes their hours, that table is the
evidence — if rows can be rewritten there is no evidence.

**Attendance days are derived, never stored.** Computed from punches on read by
`app/domain/attendance_rules.py`. A policy change reclassifies every past day
with no migration and no backfill.

**`domain/` stays pure.** No FastAPI, no SQLAlchemy, no I/O. Plain values in, a
result out. That is why 28 tests run in 0.05 seconds with no database.

**Store UTC, compare in local time.** `TIMEZONE` in `.env`. Comparing a UTC
instant against "09:00" in a +05:30 country marked everybody as leaving early
every day and hid every late arrival — a bug that reached a running server and
looked entirely plausible.

**Every endpoint declares a permission.** `Depends(requires("..."))`. The
frontend's checks are user experience; these are the control.

**Scoping is applied to the filter, not checked afterwards.** Someone without
`view_all` gets their own id forced into the query, whatever the query string
says.

**Nobody approves their own.** Leave, corrections, role changes — not even an
owner holding every permission. Approval is a second pair of eyes.

**Secrets are redacted by key in the audit log, not dropped.** A password reset
records `"newPassword": "[redacted]"` — the key stays so the log shows a reset
happened.

**Compute anything date-dependent on read.** `isOverdue` stored today is wrong
tomorrow morning, and nothing tells you.

---

## Traps already hit in this project — do not re-learn these

**`npx tsc --noEmit` checks NOTHING here.** The root tsconfig is solution-style
(`files: []` + `references`), and without `--build` the compiler resolves zero
files and reports success. Use `npm run typecheck` (`tsc -b --noEmit`), which is
also part of `npm run build`. This hid `const { show } = useToast()` in seven
files — `useToast` returns a function, so all seven were `undefined is not a
function` at runtime.

**`server_default="now()"` as a string** renders as `DEFAULT 'now()'`, which
Postgres evaluates once at DDL time. Four tables ended up with `created_at`
frozen to the moment the migration ran. Use `func.now()`.

**Alembic autogenerate does not detect new ENUM values.** It compares tables and
columns, not type contents. Enum additions are hand-written with
`ALTER TYPE ... ADD VALUE` inside an autocommit block.

**Alembic autogenerate omits the pgvector import** it writes into the migration.
Fixed in `alembic/script.py.mako`, so every future migration is correct.

**`drop_table` does not drop the ENUM type it created.** Without explicit
`DROP TYPE`, a downgrade appears to succeed and the next upgrade fails with
"type already exists" on a database that looks empty.

**Never delete a migration file without checking whether it was applied.** Doing
so left the database pointing at a revision with no file. Recovery was
`alembic stamp <rev> --purge`.

**Read every autogenerated migration before running it.** It cannot see a
rename, so it writes DROP + CREATE — which is data loss.

**Verification scripts must not mutate state other scripts depend on, must be
re-runnable, and must never silently skip a check.** All three were violated at
least once; the third is the worst, because a test that quietly does nothing
reports success.

**Modals render while closed**, so hooks inside them fire on mount. Three
components fetched the employee directory for a hidden picker, which gave an
employee three 403s on page load. The fix was to stop asking for data the screen
does not need, not to widen the permission.

**Vite proxies only what you list.** `/uploads` was missing, so uploads
succeeded, the database held the right path, and the image silently did not
appear.

**React StrictMode runs effects twice in development.** The session bootstrap
fired two refresh calls, and because refresh tokens rotate, the second presented
a spent token — which the server correctly reads as theft and revokes every
session.

---

## Demo accounts

| Username | Password | Role |
|----------|----------|------|
| owner | owner123 | Owner — 26 permissions |
| marcus | demo123 | Manager — 18 |
| karan | demo123 | Employee — 8 |

## Running it

```powershell
# backend
cd attendance-server
.\.venv\Scripts\Activate.ps1
docker compose up -d
alembic upgrade head
python -m app.seed
python -m app.seed_punches
python -m app.seed_tasks
uvicorn app.main:app --reload

# frontend
cd attendance-admin
npm run dev
```

```powershell
# checks
python scripts/verify_contract.py    # every endpoint the frontend calls
python scripts/verify_pages.py       # every screen, per role, no 403s
pytest                               # 28 rule tests, no database
npm run typecheck                    # the real one
```

---

## Not yet done, outside Phase 3

- **Deployment.** Everything runs on localhost. Hosting means a Dockerfile,
  HTTPS, database backups, and the uploads directory surviving a redeploy.
- **Work from home** is staged, not wired. `AttendanceStatus.WORK_FROM_HOME` and
  the `work_from_home` leave type exist in the rules and the database, with four
  tests pinning the behaviour. Nothing passes them yet. It is deliberately not a
  leave type: filing it as one would mark the day ON_LEAVE, which says the
  person was away. They worked.
