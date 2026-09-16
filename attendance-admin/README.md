# Attendance Admin — Phase 1

Workforce attendance and task management admin dashboard, running entirely on
mock data. No backend required.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173

### Updating an existing copy

Always stop the dev server first. Extracting over a running server makes Vite
restart mid-session, which leaves the browser holding a service worker
registration that no longer works — and the symptom is `/api` requests
returning 404 while the app otherwise looks fine.

```bash
# 1. Ctrl+C  — stop the server first
# 2. extract
npx msw init public/ --save   # 3. regenerate the worker to match the msw version
npm run dev
```

Then in the browser: **DevTools → Application → Service Workers → Unregister**,
followed by Ctrl+Shift+R. A stale worker does not replace itself.

On a healthy start the console prints `[mocks] ready — N handlers registered`.
If `/api` is 404ing and that line is missing, the worker did not start.

## Demo accounts

| Username | Password  | Role     | What they see |
|----------|-----------|----------|---------------|
| owner    | owner123  | Owner    | Everything, including Administration |
| marcus   | demo123   | Manager  | People section, no Administration |
| karan    | demo123   | Employee | Dashboard, Attendance, Tasks, Settings only |

Editing a role under Roles & Permissions changes what its accounts see at their
next sign-in. Sign out and back in to observe it.

Sign in as each in turn — the sidebar changes. That is the permission system
working, not three different layouts.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server with hot reload |
| `npm run typecheck` | TypeScript check, no output files |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |

## How a request flows

```
Component
  -> features/<name>/api.ts        query or mutation hook
  -> lib/apiClient.ts              fetch, token, error handling
  -> /api/v1/...
  -> mocks/handlers/<name>.ts      MSW intercepts (Phase 1)
                                   FastAPI answers  (Phase 2)
```

Components never call `fetch` or `apiClient` directly. They call a hook.

## Folder map

| Path | Responsibility | How often it changes |
|------|----------------|----------------------|
| `contracts/types.ts` | Every shape that crosses the network | Only when an endpoint changes |
| `contracts/permissions.ts` | Every valid permission code | Only when a permission is added |
| `contracts/endpoints.ts` | Every API URL | Only when an endpoint is added |
| `mocks/fixtures/` | Fake data | Phase 1 only |
| `mocks/handlers/` | Fake server | Deleted at Phase 2 cutover |
| `lib/apiClient.ts` | The only place that knows about tokens and fetch | Rarely |
| `lib/rbac.ts` | The only place that decides what a user may see | Rarely |
| `stores/authStore.ts` | Who is signed in | Rarely |
| `domain/attendanceRules.ts` | The business rules: punches to days, flags | Rarely, and carefully |
| `features/<name>/api.ts` | That feature's query and mutation hooks | Every new endpoint |
| `features/<name>/*.tsx` | Screens | Daily |
| `layouts/Sidebar.tsx` | Navigation, permission-filtered | When a module is added |
| `routes/index.tsx` | Route tree | When a page is added |

## Task timeline — on fixtures for now

`/tasks?view=timeline` shows a bar per dated task, one row per person, with a
today line. Underneath it, a table with start, end and how long until the
deadline.

| Viewer | Chart | Filter | Table |
|--------|-------|--------|-------|
| Owner | everyone | by employee | all, with assignee |
| Manager | everyone | by employee | all, with assignee |
| Employee | own row only | forced | own, no assignee column |

**This one feature still reads local fixtures** — `features/tasks/timelineFixtures.ts`
— because the endpoint does not exist yet. Everything above the hook is written
against the contract type and does not know. When the backend lands, the body
of `useTaskTimeline` changes and the fixture file is deleted.

Turning the MSW service worker back on for this would have switched *every*
screen to fake data, which nobody would notice until a demo. A plain module read
by one hook does not.

Two things it needs from the backend when that happens:

- `tasks.start_date` — a bar needs a start as well as an end. `createdAt` is
  when the task was written down, often weeks before anyone touched it, so a bar
  drawn from it makes everything look permanently late.
- `GET /tasks/timeline` — grouped by person, so the chart does not have to
  regroup a flat list on every render.

## Type checking — read this before trusting a green check

`npx tsc --noEmit` on this project checks **nothing**. `tsconfig.json` is
solution-style (`"files": []` plus `"references"`), and without `--build` the
compiler resolves zero files and reports success.

The command that actually runs the check:

```
npm run typecheck     # tsc -b --noEmit
```

`npm run build` runs it too, so a broken type cannot ship.

This mattered. `strict` was off *and* the check was running on nothing, which
together hid `const { show } = useToast()` in seven files — `useToast` returns a
function, so every one of those was `undefined is not a function` at runtime.
Both are now fixed and `strict` is on.

A green check that checks nothing is worse than no check, because it is believed.

## Design system

Shared with Ruver and Alya, so all three products look like one company.

| Token | Value |
|-------|-------|
| Font | Inter 300–800, 16px root, tabular numerals |
| Page canvas | `bg-base` `#FAF9F6` |
| Card | `bg-card` `#FFFFFF`, `border-black/[0.06]`, `shadow-xs` |
| Text ramp | `zinc-900` primary · `zinc-500` secondary · `zinc-400` muted |
| Primary | `indigo-600` `#4F46E5`, hover `indigo-700` |
| Radius | 4 chips · 8 small buttons · 12 buttons/inputs · 16 cards · full badges |
| Status pills | 15% tint + 600 text + 20% border, 9.5px |

Tailwind's default palette is available — use `zinc`, `indigo`, `emerald`,
`amber`, `red` directly rather than inventing colour names.

Pointer cursor, transitions and the focus ring are applied once in
`index.css`, so no component has to remember them.

### Responsive behaviour

One breakpoint does the work: **`lg` (1024px)**.

| Width | Sidebar | Content |
|-------|---------|---------|
| < 1024px | Off-canvas drawer, opened from a top bar | Full width, no offset |
| >= 1024px | Fixed, 252px or 72px collapsed | Offset by the sidebar width |

The collapsed preference is stored in `localStorage` because it is a deliberate
choice. The mobile drawer state is not, because nobody wants to land on a page
with a menu already covering it — two flags, in `stores/uiStore.ts`.

Wide tables (attendance register, present list, roles matrix) keep a minimum
width and scroll horizontally inside their card. Squeezing a timestamp onto two
lines is worse than scrolling to it, and in the roles matrix the sticky first
column keeps the role name visible — a checkbox with no visible row label tells
you nothing.

Filter bars go two-per-row on phones (`w-[calc(50%-0.25rem)]`) rather than
stacking into a tall column.

### Attendance tracking

`Employee.attendanceTracked` decides whether someone's hours are recorded at
all. The owner is `false`: they set their own schedule, so they have no
check-in card, generate no punches, and never appear in the register or the
exception list. Without the flag they would be marked ABSENT every day and sit
permanently at the top of the owner's own exception panel.

It is a property of the person, not of their role — a working partner or a
director may well want their hours kept, and inferring it from access level
would break the first time that happens.

Dashboard counters say "tracked employees", not "headcount", because the two
numbers genuinely differ.

### Charts

| Chart | Who sees it | What it answers |
|-------|-------------|-----------------|
| `TeamTrendChart` | anyone with `attendance.view_all` | Is attendance getting worse? Daily / weekly / monthly stacked bars |
| `MonthChart` | anyone who is attendance-tracked | How were my own hours over 30 days? |

The trend is aggregated server-side (`GET /dashboard/trend?granularity=`).
Six months of day-level rows for a growing company is thousands of records to
answer a question about twenty numbers — the server counts, the client draws.

Absent sits at the top of each stack on purpose: a middle segment has no common
baseline and cannot be compared across bars, so the thing that matters most
gets the flat top of the bar to sit against.

### Changing someone's role

`users.change_role` lets an owner move anyone, and a manager move employees.
Three rules are enforced **on the server**, in `mocks/handlers/users.ts`:

1. **Subset** — you may only assign a role whose permissions you already hold.
   A manager cannot grant `roles.manage`, so cannot create an owner.
2. **Not yourself** — otherwise self-promotion is one request.
3. **Not a peer** — you cannot move someone who also holds `users.change_role`,
   unless you hold `roles.manage`.

Rule 1 does the real work: escalation becomes impossible without any hard-coded
hierarchy of roles. The dropdown is filtered by the server too
(`GET /roles/assignable`), but that is a convenience — the check on write is the
control.

Managers reach it from the employee detail drawer, since Access Control needs
`users.manage` (passwords, account status), which they do not have.

### Sessions

Two independent limits, in `src/lib/session.ts`:

| Limit | Default | Resets on activity? | Warns first? |
|-------|---------|---------------------|--------------|
| Idle | 30 min | Yes | Yes, last 2 min |
| Absolute | 10 hours | No | No |

Activity means mouse, keyboard, wheel, scroll, touch, or the tab becoming
visible again — so somebody reading a long register is not signed out
mid-task. The listeners are passive and the timestamp lives in a ref, so
continuous mouse movement costs no re-renders.

When a session ends, `clearSession(reason)` flips `isAuthenticated` to false.
`ProtectedRoute` reads that, so every guarded route bounces to `/login`
immediately and the sidebar goes with the shell — nothing needs disabling by
hand, and no module is reachable by typing a URL. The login screen then
explains which limit was hit.

Change the numbers in `session.ts`; nothing else needs touching.

### Dialogs

Never use `window.confirm`, `alert`, or an alert library. Use:

```tsx
const confirm = useConfirm();
const ok = await confirm({ title: '…', tone: 'danger' });

const toast = useToast();
toast('Task assigned');
```

`confirm` for anything the user must decide, `toast` for outcomes they only
need told. Both are built on the same Radix Dialog as every other modal, so
focus, Escape and scroll-lock behave identically everywhere.

## Security model

The permission checks in this codebase — `useCan`, `PermissionGate`,
`ProtectedRoute`, the sidebar filter — are **user experience, not security**.
They stop people seeing controls they cannot use. They do not stop anyone
opening developer tools and calling the API directly.

In Phase 2 every permission is re-checked on the server, on every endpoint,
including reads, plus row-level scoping so a manager's query is filtered to
their own team in SQL rather than in the browser.

## Phase 2 cutover

Delete the `enableMocking()` call in `src/main.tsx`. That is the whole change.
Every URL, hook and component stays exactly as it is.

## Build order

1. Login + auth + RBAC — **done**
2. AppShell + sidebar — **done**
3. Employees list, create/edit, detail drawer — **done**
4. Attendance register, history, punch drill-down, manual punch — **done**
5. Tasks
7. Roles & permissions matrix
8. Access control — create logins, reset passwords
9. Dashboard
10. Settings & profile
