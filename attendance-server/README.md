# Attendance API — Phase 2

FastAPI + PostgreSQL backend for the check-in / check-out admin dashboard.

## First run

```powershell
# from attendance-server/
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

copy .env.example .env
# then edit .env — at minimum, generate a real JWT_SECRET:
python -c "import secrets; print(secrets.token_urlsafe(48))"

docker compose up -d          # Postgres on port 5433
uvicorn app.main:app --reload
```

Open http://localhost:8000/docs

## Checkpoints

| URL | Expects |
|-----|---------|
| `/api/v1/health` | `{"status": "ok", ...}` — the process is alive |
| `/api/v1/health/db` | `postgres: PostgreSQL 16.x`, `pgvector: true` |
| `/docs` | Swagger UI listing both endpoints |

`/health/db` returning 503 means Postgres is unreachable — check
`docker ps` before touching any code.

## Why port 5433

A native PostgreSQL service already holds 5432 on this machine, so
docker-compose publishes the container one port higher. Inside the container it
is still 5432; only the host side moves. The URL in `.env` must say 5433.

## What works right now

```powershell
alembic upgrade head          # 17 tables
python -m app.seed            # permissions, roles, 10 people, 8 logins
uvicorn app.main:app --reload
python -m app.seed_punches         # 14 days of history, a holiday, one leave
python scripts/verify_auth.py       # 10 checks
python scripts/verify_employees.py  # 12 checks
python scripts/verify_attendance.py # 13 checks
python scripts/verify_tasks.py      # 14 checks
python scripts/verify_admin.py      # 21 checks, escalation guards included
python scripts/verify_dashboard.py  # 11 checks, counters and trend
python scripts/verify_contract.py   # every endpoint the frontend calls
python scripts/verify_pages.py      # every screen, per role — no 403s
python scripts/verify_timeline.py   # 15 checks, task timeline
python scripts/verify_refresh.py    # 13 checks, rotation and reuse detection
python scripts/verify_audit.py      # 12 checks, every action leaves a record
python scripts/verify_leave.py      # 18 checks, leave, holidays and the CSV export
python scripts/verify_corrections.py # 20 checks, corrections and photo upload
pytest                              # 21 rule tests, no database needed
```

| Endpoint | Does |
|----------|------|
| `GET  /api/v1/health` | process alive |
| `GET  /api/v1/health/db` | Postgres reachable, pgvector present |
| `POST /api/v1/auth/login` | argon2 verify, JWT out, refresh cookie set |
| `GET  /api/v1/me` | current user, freshly read |
| `POST /api/v1/auth/refresh` | rotates the refresh cookie, returns a new access token |
| `POST /api/v1/auth/logout` | revokes every refresh token for the user |
| `PATCH /api/v1/me/password` | self-service change, current password required |
| `GET  /api/v1/departments` | reference data for filters and forms |
| `GET  /api/v1/shifts` | shift definitions |
| `GET  /api/v1/employees` | paginated, searchable, filterable · `employees.view_all` |
| `GET  /api/v1/employees/{id}` | own record always; anyone else's needs `view_all` |
| `POST /api/v1/employees` | auto emp_code · `employees.create` |
| `PATCH /api/v1/employees/{id}` | partial update · `employees.edit` |
| `GET  /api/v1/attendance/days` | the register, computed from punches on read |
| `GET  /api/v1/attendance/present` | who is inside now · `attendance.view_all` |
| `GET  /api/v1/attendance/punches` | raw events behind one day |
| `POST /api/v1/attendance/punches` | manual entry, idempotent · `attendance.punch_manual` |
| `GET  /api/v1/dashboard/my-today` | own check-in card |
| `GET  /api/v1/tasks` | board, scoped to own without `tasks.view_all` |
| `POST /api/v1/tasks` | assign (`tasks.assign`) or self-add (`tasks.create_own`) |
| `PATCH /api/v1/tasks/{id}` | content needs `tasks.edit`; moving columns does not |
| `PATCH /api/v1/tasks/{id}/complete` | tick off own work |
| `GET  /api/v1/tasks/timeline` | bars grouped by person, scoped |
| `GET  /api/v1/permissions` | the catalogue. No POST, by design |
| `GET  /api/v1/roles` | roles with their permission sets |
| `GET  /api/v1/roles/assignable` | roles this caller may hand out |
| `POST /api/v1/roles` | create, subject to the subset rule |
| `PATCH /api/v1/roles/{id}` | edit, with the last-admin guard |
| `DELETE /api/v1/roles/{id}` | only unused, non-system roles |
| `GET  /api/v1/users` | login accounts |
| `POST /api/v1/users` | create a login |
| `PATCH /api/v1/users/{id}/password` | admin reset, no current password |
| `PATCH /api/v1/users/{id}/status` | enable / disable, never delete |
| `PATCH /api/v1/users/{id}/role` | move somebody, subject to three guards |
| `GET  /api/v1/dashboard/stats` | three counters, tracked employees only |
| `GET  /api/v1/dashboard/exceptions` | today's absences and late arrivals |
| `GET  /api/v1/dashboard/trend` | present/late/absent by day, week or month |

| `GET  /api/v1/settings` | shift policy |
| `PATCH /api/v1/settings` | change it · `settings.manage` · retroactive |
| `PATCH /api/v1/me/profile` | own contact details |

| `GET  /api/v1/audit` | who changed what · `audit.view` · read only |
| `GET  /api/v1/audit/actions` | action types present, for the filter |

| `GET  /api/v1/leaves` | requests, scoped without `leave.view_all` |
| `POST /api/v1/leaves` | apply · `leave.apply` |
| `PATCH /api/v1/leaves/{id}` | approve / reject / cancel · never your own |
| `GET  /api/v1/holidays` | readable by anyone signed in |
| `POST /api/v1/holidays` | `holidays.manage` |
| `DELETE /api/v1/holidays/{id}` | `holidays.manage` |
| `GET  /api/v1/attendance/export` | CSV · `attendance.view_all` |

| `GET  /api/v1/corrections` | requests, scoped without `corrections.view_all` |
| `POST /api/v1/corrections` | ask for a fix · `corrections.request` |
| `PATCH /api/v1/corrections/{id}` | approve / reject / withdraw · never your own |
| `POST /api/v1/employees/{id}/photo` | own photo, or anyone's with `employees.edit` |
| `DELETE /api/v1/employees/{id}/photo` | falls back to initials |

**42 endpoints.** Every one declares a permission.

## Connecting the frontend

```powershell
# terminal 1
cd attendance-server
uvicorn app.main:app --reload      # :8000

# terminal 2
cd attendance-admin
npm run dev                        # :5173
```

Vite proxies `/api` to `:8000`, so the browser sees one origin — no CORS, no
preflight, and the refresh cookie stays first-party.

`VITE_USE_MOCKS=true` in `attendance-admin/.env.local` switches back to the
Phase 1 mock service worker for offline work.

`scripts/verify_contract.py` walks every endpoint the frontend calls and checks
the field names. A mismatch does not announce itself — a renamed field arrives
as `undefined` and renders as blank, with nothing thrown — so the check is
mechanical rather than visual.

Sign in as `owner / owner123`, `marcus / demo123`, `karan / demo123`.

## Migrations

```powershell
alembic upgrade head      # create every table
alembic current           # which revision is applied
alembic downgrade base    # back to empty (tested, reversible)
```

17 tables. See `docs/SCHEMA.md` for what each group holds and which two
autogenerate traps are already fixed in migration 001.

## Layout

```
app/
├── main.py          FastAPI app, CORS, router mounting
├── core/
│   ├── config.py    every setting, from the environment
│   └── db.py        engine, session factory, get_session dependency
├── api/v1/
│   ├── router.py    collects every v1 router
│   └── health.py    liveness + readiness
├── models/          SQLAlchemy tables            (17 tables)
│   ├── base.py      UUID + timestamp mixins
│   ├── org.py       departments, shifts, holidays
│   ├── employee.py  employees
│   ├── auth.py      users, roles, permissions, refresh tokens
│   ├── attendance.py punch_events, attendance_days, leaves, corrections
│   ├── task.py      tasks
│   ├── audit.py     audit_log
│   └── face.py      face_templates (pgvector, Phase 3)
├── schemas/         Pydantic request/response    (next)
└── domain/          pure business rules          (next)
alembic/             migrations
tests/
```

## Time zones

On **Windows**, install `tzdata` (it is in requirements.txt). Linux and macOS
ship the IANA timezone database with the OS; Windows does not, and without it
the server refuses to start with `ZoneInfoNotFoundError`.


Store and transmit UTC. Compare against shift rules, and decide which calendar
day something belongs to, in LOCAL time (`TIMEZONE` in `.env`).

Getting this backwards is not cosmetic. Comparing a UTC instant against
"09:00" in a +05:30 country marks everyone as leaving early every day and hides
every late arrival — and the numbers look plausible enough that nobody
questions them until payroll does. `tests/test_attendance_rules.py` pins it.

## Error shape

Every error leaves in one shape, enforced by handlers in `app/core/errors.py`:

```json
{ "error": { "code": "...", "message": "...", "fields": { "email": "..." } } }
```

FastAPI wraps `HTTPException` detail in `{"detail": ...}` and Pydantic emits a
third shape entirely, so without the handlers the frontend would face three
formats. The contract was frozen in Phase 1; the backend matches it rather than
the other way round.

## Asking only for what the screen needs

`verify_contract.py` signs in as an owner, so it can never see a permission
problem. The first time the frontend was connected for real, an employee
opening the tasks board got three 403s.

The cause was not a missing permission. Three modals fetched the employee
directory to fill a picker that was hidden — and modals render while closed, so
their hooks fire on mount regardless. The fix was to gate those queries, not to
widen the permission.

`verify_pages.py` walks the screens each role can reach and fails on any refused
request. A request that should not happen is a bug even when it succeeds: with
an owner signed in, those three calls quietly loaded the whole directory for a
picker nobody could see.

## Writing verification scripts

Three rules, all learned the hard way in this project:

**Do not mutate state other scripts depend on.** An earlier `verify_admin.py`
reset karan's password when everyone already had a login. Every other script
signs in as karan, so they all began failing, and after five attempts the
account locked itself. The scripts looked broken; the data was.

**Make them re-runnable.** `verify_employees.py` used a fixed email, passed
once, then failed on every later run with "email already in use" — a failure
that looks like a broken API and is actually a test that cannot run twice.

**Never let a check silently skip.** `verify_audit.py` fell back to "no spare
employee, skipping" for the password-redaction assertion — the single most
important check in the file. A test that quietly does nothing is worse than no
test, because it reports success. It now creates what it needs.

## Two traps in the second migration

**Frozen timestamp defaults.** `server_default="now()"` as a plain string
renders as `DEFAULT 'now()'`, which Postgres evaluates ONCE at DDL time. Four
tables ended up with `created_at` defaulting to the exact moment the migration
ran — so every future punch, audit row and face template would have carried the
same timestamp, forever. It only shows up when somebody notices an audit log
where everything happened in the same second. `func.now()` is the fix, and
migration 002 corrects it.

It was caught by reading the generated migration before running it. That habit
is the whole reason to read them.

**Route order.** `/tasks/timeline` must be declared before `/tasks/{task_id}`.
FastAPI matches in declaration order, so the other way round "timeline" is
parsed as a task id and the endpoint is unreachable. Same trap as
`/roles/assignable`.

## Reporting honestly

Two rules the dashboard follows, both learned by looking at wrong output:

**Counters are three numbers, not one.** `checkedInToday` only rises;
`currentlyPresent` moves both ways; `checkedOut` counts departures. A single
counter decremented on check-out loses the arrival record by evening — and the
arrival record is what payroll and any late-arrival report need.
`checkedInToday == currentlyPresent + checkedOut` is asserted in the
verification script.

**Never report on a period with no data.** The trend window is a maximum, not a
promise. A six-month view on a system that started three weeks ago showed five
months in which every employee was absent every working day — a plausible
looking figure that was entirely an artefact of there being no records. The
window is clamped to the first punch ever recorded.

## Corrections

`punch_events` is append-only. The first time somebody disputes their hours,
that table is the evidence — and if rows can be rewritten there is no evidence,
only a record saying whatever the last person to touch it wanted.

So a correction is a separate approved row, layered on top. The register
recomputes from both; expanding the day still shows the original punches.

- **Nobody approves a correction to their own attendance**, not even an owner.
  Editing your own hours with no second signature is exactly what an
  append-only table was built to prevent, and routing it through a "correction"
  would put the hole back with extra steps.
- **A corrected day carries MANUAL_ENTRY**, so it never looks measured.
- **Only the times that changed are sent.** A correction supplying a missing OUT
  must not overwrite an IN the kiosk recorded correctly.
- **One correction per person per day**, and never for a future date.

## Photos

Stored on disk under `uploads/photos/`, path in the database. A 200 KB image as
a column means every backup, replica and `SELECT *` carries it.

- **Type is detected from magic bytes**, not the filename or the Content-Type
  header — both are supplied by the client and mean nothing. A `.php` renamed to
  `.jpg` arrives with a convincing `image/jpeg` header.
- **The stored filename is generated**, never taken from the upload.
  `../../app/main.py` is a perfectly valid string to send.
- **The old file is deleted after the new one is written**, so a failed write
  never leaves somebody with no photo.

Served from `/uploads`, outside `/api/v1`: an `<img src>` cannot send an
Authorization header, so the URLs are unguessable rather than access-controlled
— the same trade every photo CDN makes.

## Work from home — staged, not wired

`AttendanceStatus.WORK_FROM_HOME` and the `work_from_home` leave type exist in
the rules and the database. Nothing passes them yet.

It is deliberately NOT a kind of leave: filing it as one would mark the day
ON_LEAVE, which says the person was away. They worked. The hours count, the day
is not an exception, and it does not come out of a leave balance. Hours are
credited from the shift because the kiosk is in the office and a home day has no
punches — real punches win when there are any.

`tests/test_attendance_rules.py` pins all of that, so the behaviour is fixed
before anything depends on it.

## Leave and holidays

Without either, a zero-punch day has one meaning: ABSENT. Somebody on approved
leave and somebody who did not turn up are indistinguishable, and a public
holiday reads as the entire company failing to appear.

The tables and the rollup have handled both since migration 001. What was
missing was any way to put a row in them — so in practice they would have stayed
empty and every absence figure would have been wrong.

Four rules worth knowing:

- **Nobody approves their own leave**, not even an owner holding every
  permission. Approval is a second pair of eyes, and the same person's eyes are
  not a second pair.
- **Working days only.** Weekends and company holidays are not charged against a
  request. Counting calendar days bills somebody two days for a weekend they were
  never going to work.
- **A span with no working days is rejected** at 422. A request for a Saturday
  would sit in the pending list needing a decision that changes nothing, and
  "0 days" in a list reads as a bug in the day count.
- **Overlapping requests are refused** at 409. Two approved rows covering one day
  make the rollup ambiguous about which leave that day belongs to.

## Export

`GET /attendance/export` returns a CSV. Hours are decimal (`7.35`, not `7:21`)
because the file exists to be summed in a spreadsheet, and weekends are included
because a comparison against a paper register needs every calendar day or the
rows stop lining up.

This is what Phase 4 runs on: three or four weeks of this system beside the
manual register, compared in a spreadsheet, before any of it touches a salary.

## Audit log

Recorded: sign-ins, lockouts, refresh-token reuse, login creation, password
resets, account enable/disable, role changes, role permission edits, employee
create and edit, manual punches, and policy changes.

Three decisions worth knowing:

**Written in the same transaction as the change.** Both commit or neither does.
A separate connection would let a change succeed while its record failed — the
exact state the log exists to make impossible. The cost is that a broken audit
write rolls back the operation, which is the right trade here: a role change
nobody can account for is worse than one that did not happen.

**Secrets are redacted by key, not dropped.** A password reset records
`"newPassword": "[redacted]"` — the key stays so the log shows a reset happened,
the value never appears. An audit trail is read by more people than the data it
describes and kept far longer, so anything sensitive landing here has been
copied into the one table nobody treats as sensitive.

**There is no write or delete endpoint.** Rows can only be created by the code
performing the change. A log the application can edit is not evidence — it is a
record the person you would most want to trace can rewrite.

This is also the one remaining feature that could not have been deferred:
an audit log has no backfill. Every other item on the list can be built next
month with no loss; this one would simply be missing everything that happened
in between.

## Sessions and refresh

| Token | Lifetime | Stored where | Readable by JS |
|-------|----------|--------------|----------------|
| Access | 15 min | a module variable | yes, briefly |
| Refresh | 7 days | httpOnly cookie, `/api/v1/auth` | no |

The access token is deliberately NOT in localStorage: anything there is readable
by any script on the page, so an XSS bug becomes a full account takeover. Keeping
it in memory means a reload discards it — and the refresh cookie restores the
session on startup, so a reload keeps you signed in for up to seven days without
any long-lived credential ever being readable.

**Rotation.** Every refresh issues a new token and revokes the one presented, so
a refresh token is single-use. That is what makes theft detectable: a replayed
token has already been spent, which cannot happen in normal operation because
the legitimate client discards its copy the moment it rotates. On that signal
every token for the user is revoked — signing out the thief and the victim. The
victim signs back in with a password the attacker does not have.

**Single flight.** A dashboard fires five queries at once, so an expired token
produces five simultaneous 401s. Without a shared in-flight promise, each would
start its own refresh, four would present an already-spent token, and the server
would read that as replay and sign everybody out. `lib/apiClient.ts` holds one
promise and the rest await it.

## Escalation guards

`PATCH /users/{id}/role` enforces three rules, in `app/api/v1/admin.py`:

1. **Not yourself** — self-promotion is otherwise one request.
2. **Not a peer** — you cannot move somebody who also holds
   `users.change_role`, unless you hold `roles.manage`.
3. **Subset** — you may only assign a role whose permissions you already hold.

Rule 3 does the real work: escalation becomes impossible with no hard-coded
hierarchy of roles to maintain. The same rule applies to creating a role and to
creating a login account, because both are escalation by another route.

Two more guards protect the system from being locked shut:

- The last **in-use** role holding `roles.manage` cannot lose it.
- The last **active** account that can manage users cannot be disabled, and
  nobody can disable their own account.

Without these, recovering means a manual SQL UPDATE on production.

## Rules carried over from Phase 1

- **Everything mounts under `/api/v1`** — the frontend has been calling these
  exact paths for weeks. Matching them is what makes the cutover one deleted
  line in `main.tsx`.
- **`domain/` stays pure.** No FastAPI, no SQLAlchemy, no I/O. It is the port of
  `domain/attendanceRules.ts` and the only place business rules live.
- **Punch events are append-only.** Corrections are new rows.
- **Every permission is re-checked server-side**, on every endpoint, including
  reads. Phase 1's checks were user experience; these are the control.
