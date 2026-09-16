# Attendance — full stack

```
attendance-server/   FastAPI + PostgreSQL   :8000
attendance-admin/    React + Vite           :5173
```

## First run

**Terminal 1 — backend**

```powershell
cd attendance-server
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt        # includes tzdata, needed on Windows

docker compose up -d                   # Postgres on 5433
alembic upgrade head                   # 17 tables
python -m app.seed                     # permissions, roles, 10 people, 8 logins
python -m app.seed_punches             # 14 days of history, a holiday, one leave

uvicorn app.main:app --reload
```

**Terminal 2 — frontend**

```powershell
cd attendance-admin
npm install
npm run dev
```

http://localhost:5173

| Username | Password | Role |
|----------|----------|------|
| owner | owner123 | Owner — everything |
| marcus | demo123 | Manager — no Administration |
| karan | demo123 | Employee — own data only |

The console prints `[api] live backend via /api/v1`. If it says
`mock service worker`, `VITE_USE_MOCKS` is still set.

## The cutover

Phase 1 ran on a Service Worker answering `/api/v1` in the browser. Phase 2 has
FastAPI answering the same URLs with the same shapes. Switching is one flag:

```
VITE_USE_MOCKS=true   -> mock service worker, no backend needed
VITE_USE_MOCKS=false  -> the real server (default)
```

No component, hook, query key or URL changed. That is why the Phase 1 mock was
written to filter, sort, paginate and validate like a real server rather than
just returning arrays.

Vite proxies `/api` to `:8000`, so the browser sees one origin: no CORS, no
preflight, and the refresh cookie stays first-party.

## Checking it

```powershell
cd attendance-server
python scripts/verify_contract.py    # every endpoint, every field name
python scripts/verify_pages.py       # every screen, per role — no 403s
pytest                               # 21 rule tests, no database needed
```

Plus per-feature suites: `verify_auth`, `verify_employees`, `verify_attendance`,
`verify_tasks`, `verify_admin`, `verify_dashboard`.

Two different things are being checked. `verify_contract` signs in as an owner
and checks shapes — it can never see a permission problem. `verify_pages` walks
what each role's screens actually request and fails on anything refused. The
first live connection produced three 403s that only the second kind catches.

## What is done

| Phase | State |
|-------|-------|
| 1 — Frontend on mock data | complete, 84 files |
| 2 — Backend, database, real auth and RBAC | complete, 30 endpoints |
| 3 — Kiosk app and face enrolment | not started |
| 4 — Shadow run alongside the manual register | not started |
| 5 — Payroll export | not started |

## Still open

**Phase 4 is not optional.** Running this alongside the existing manual register
for three to four weeks is the only way to find which punches the system misses
and which flags are wrong — before any of it touches a salary calculation.

**Biometric consent** needs legal review before Phase 3. Employee face templates
are personal data processed by an employer: written consent, a defined retention
period, embeddings stored rather than photographs, and a PIN fallback for anyone
who declines.
