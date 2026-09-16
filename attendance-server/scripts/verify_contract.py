"""
scripts/verify_contract.py

Walks every endpoint the Phase 1 frontend calls and checks the live backend
answers it in the shape the frozen contract promised.

WHY THIS EXISTS
---------------
The cutover is one flag in main.tsx. That only works if every URL, every query
parameter and every field name actually matches — and a mismatch does not
announce itself. A missing field arrives as `undefined` and renders as blank;
a renamed one renders as blank too. Nothing throws. The screen just quietly
shows nothing where a number should be.

So the check is mechanical rather than visual.
"""

import json
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = "http://localhost:8000/api/v1"
failures: list[str] = []


def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, json.loads(raw) if raw else None


def check(label, condition, detail=""):
    mark = "OK  " if condition else "FAIL"
    print(f"  {mark}  {label}{('  — ' + detail) if detail and not condition else ''}")
    if not condition:
        failures.append(label)


def has_fields(obj: dict, fields: list[str]) -> tuple[bool, str]:
    missing = [f for f in fields if f not in obj]
    return (not missing, f"missing {missing}")


_, login = call("POST", "/auth/login", {"username": "owner", "password": "owner123"})
owner = login["accessToken"]
owner_user = login["user"]

_, klogin = call("POST", "/auth/login", {"username": "karan", "password": "demo123"})
karan = klogin["accessToken"]
karan_user = klogin["user"]

today = date.today()
start = today - timedelta(days=13)

print("\nAUTH  — authStore and LoginPage")
ok, why = has_fields(owner_user, [
    "id", "employeeId", "name", "email", "username", "photoUrl",
    "departmentName", "position", "roleName", "permissions",
    "mustChangePassword", "attendanceTracked",
])
check("LoginResponse.user has every CurrentUser field", ok, why)
check("accessToken present", "accessToken" in login)
check("permissions is a flat string array", isinstance(owner_user["permissions"], list)
      and all(isinstance(p, str) for p in owner_user["permissions"]))

s, b = call("GET", "/me", token=owner)
check("GET /me returns Single<CurrentUser>", s == 200 and "data" in b)

print("\nERROR ENVELOPE  — lib/apiClient.ts reads body.error")
s, b = call("GET", "/me")
check("401 uses { error: { code, message } }", "error" in (b or {}) and "code" in b.get("error", {}))
s, b = call("POST", "/auth/login", {"username": "x"})
check("422 uses { error: { code, message, fields } }",
      "error" in (b or {}) and "fields" in b.get("error", {}))

print("\nORG  — useDepartments, useShifts")
s, b = call("GET", "/departments", token=owner)
check("GET /departments -> Single<Department[]>", s == 200 and isinstance(b.get("data"), list))
if b.get("data"):
    ok, why = has_fields(b["data"][0], ["id", "name"])
    check("Department fields", ok, why)

s, b = call("GET", "/shifts", token=owner)
check("GET /shifts -> Single<Shift[]>", s == 200 and isinstance(b.get("data"), list))
if b.get("data"):
    ok, why = has_fields(b["data"][0], ["id", "name", "startTime", "endTime", "graceMinutes", "minHours"])
    check("Shift fields", ok, why)

print("\nEMPLOYEES  — DataTable and EmployeeDetailDrawer")
s, b = call("GET", "/employees?page=1&pageSize=10&search=&status=active", token=owner)
check("GET /employees -> Paginated envelope", s == 200 and "data" in b and "meta" in b)
ok, why = has_fields(b.get("meta", {}), ["page", "pageSize", "total", "totalPages"])
check("meta fields", ok, why)
if b.get("data"):
    ok, why = has_fields(b["data"][0], [
        "id", "empCode", "name", "email", "phone", "photoUrl",
        "departmentId", "departmentName", "position", "shiftId",
        "joinDate", "status", "faceEnrolled", "hasLogin", "roleName",
        "attendanceTracked",
    ])
    check("Employee fields", ok, why)

print("\nATTENDANCE  — AttendancePage, PunchList, MyDayStrip")
s, b = call("GET", f"/attendance/days?dateFrom={start}&dateTo={today}&pageSize=20", token=owner)
check("GET /attendance/days -> Paginated", s == 200 and "meta" in b)
if b.get("data"):
    ok, why = has_fields(b["data"][0], [
        "employeeId", "employeeName", "employeePhotoUrl", "departmentName",
        "date", "firstIn", "lastOut", "workedMinutes", "status", "flags", "punchCount",
    ])
    check("AttendanceDay fields", ok, why)
    sample = b["data"][0]

s, b = call("GET", f"/attendance/days?dateFrom={start}&dateTo={today}&hasFlags=true", token=owner)
check("hasFlags filter accepted", s == 200)

s, b = call("GET", "/attendance/present", token=owner)
check("GET /attendance/present -> Single<PresentEmployee[]>", s == 200 and isinstance(b.get("data"), list))
if b.get("data"):
    ok, why = has_fields(b["data"][0], [
        "employeeId", "name", "photoUrl", "departmentName",
        "checkInAt", "minutesSinceCheckIn", "isLate",
    ])
    check("PresentEmployee fields", ok, why)

s, b = call("GET", f"/attendance/punches?employeeId={sample['employeeId']}&date={sample['date']}", token=owner)
check("GET /attendance/punches -> Single<PunchEvent[]>", s == 200)
if b.get("data"):
    ok, why = has_fields(b["data"][0], [
        "id", "employeeId", "employeeName", "ts", "direction",
        "deviceId", "deviceName", "source", "confidence", "photoRef",
    ])
    check("PunchEvent fields", ok, why)

s, b = call("GET", "/dashboard/my-today", token=karan)
ok, why = has_fields(b.get("data", {}), [
    "status", "checkInAt", "checkOutAt", "workedMinutes", "shiftStart", "shiftEnd", "isLate",
])
check("MyAttendanceToday fields", s == 200 and ok, why)

print("\nTASKS  — TasksPage, TaskCard, EmployeeDashboard")
s, b = call("GET", "/tasks?employeeId=me", token=karan)
check("GET /tasks?employeeId=me accepted", s == 200 and "meta" in b)
s, b = call("GET", "/tasks?pageSize=50", token=owner)
if b.get("data"):
    ok, why = has_fields(b["data"][0], [
        "id", "employeeId", "employeeName", "employeePhotoUrl",
        "assignedBy", "assignedByName", "title", "description",
        "dueDate", "priority", "status", "completedAt", "createdAt",
        "isOverdue", "selfAssigned",
    ])
    check("Task fields", ok, why)

print("\nADMIN  — RolesPage, UsersPage, ChangeRoleModal")
s, b = call("GET", "/roles", token=owner)
check("GET /roles -> Single<Role[]>", s == 200 and isinstance(b.get("data"), list))
if b.get("data"):
    ok, why = has_fields(b["data"][0], ["id", "name", "description", "isSystem", "permissions", "userCount"])
    check("Role fields", ok, why)

s, b = call("GET", "/roles/assignable", token=owner)
check("GET /roles/assignable resolves before /roles/{id}", s == 200 and isinstance(b.get("data"), list))

s, b = call("GET", "/permissions", token=owner)
check("GET /permissions -> Single<Permission[]>", s == 200)
if b.get("data"):
    ok, why = has_fields(b["data"][0], ["code", "module", "label", "description"])
    check("Permission fields", ok, why)

s, b = call("GET", "/users?pageSize=50", token=owner)
check("GET /users -> Paginated<User>", s == 200 and "meta" in b)
if b.get("data"):
    row = b["data"][0]
    ok, why = has_fields(row, [
        "id", "employeeId", "employeeName", "employeePhotoUrl", "username",
        "roleId", "roleName", "isActive", "mustChangePassword",
        "lastLoginAt", "createdAt",
    ])
    check("User fields", ok, why)
    leaked = [k for k in row if "password" in k.lower() and k != "mustChangePassword"]
    check("no password field leaks in User", not leaked, f"found {leaked}")

s, b = call("GET", f"/users?employeeId={karan_user['employeeId']}", token=owner)
check("GET /users?employeeId= filter (drawer role change)", s == 200)

print("\nDASHBOARD  — OwnerDashboard, TeamTrendChart")
s, b = call("GET", "/dashboard/stats", token=owner)
ok, why = has_fields(b.get("data", {}), [
    "date", "totalEmployees", "checkedInToday", "currentlyPresent", "checkedOut",
    "lateCount", "absentCount", "tasksOpen", "tasksCompletedToday",
])
check("DashboardStats fields", s == 200 and ok, why)

s, b = call("GET", "/dashboard/exceptions", token=owner)
check("GET /dashboard/exceptions -> Single<AttendanceException[]>", s == 200)
if b.get("data"):
    ok, why = has_fields(b["data"][0], [
        "employeeId", "employeeName", "photoUrl", "flag",
        "expectedAt", "actualAt", "delayMinutes",
    ])
    check("AttendanceException fields", ok, why)

for g in ("day", "week", "month"):
    s, b = call("GET", f"/dashboard/trend?granularity={g}", token=owner)
    ok = s == 200 and isinstance(b.get("data"), list)
    if ok and b["data"]:
        ok, why = has_fields(b["data"][0], [
            "bucket", "label", "present", "late", "absent", "workingDays", "trackedEmployees",
        ])
    else:
        why = ""
    check(f"GET /dashboard/trend?granularity={g}", ok, why)

print("\nSETTINGS  — SettingsPage")
s, b = call("GET", "/settings", token=owner)
ok, why = has_fields(b.get("data", {}), ["shiftStart", "shiftEnd", "graceMinutes", "minHours", "companyName"])
check("GET /settings -> OrgSettings", s == 200 and ok, why)

s, b = call("PATCH", "/settings", {"graceMinutes": 15}, token=owner)
check("PATCH /settings accepted", s == 200)

s, b = call("PATCH", "/me/profile", {"phone": "9810012003"}, token=karan)
check("PATCH /me/profile accepted", s == 200)

s, b = call("PATCH", "/settings", {"graceMinutes": 15}, token=karan)
check("PATCH /settings refused without settings.manage", s == 403)

print("\nLEAVE  — LeavePage, LeaveForm, HolidayPanel")
s, b = call("GET", "/leaves?pageSize=10", token=owner)
check("GET /leaves -> Paginated<Leave>", s == 200 and "meta" in b)
if b.get("data"):
    ok, why = has_fields(b["data"][0], [
        "id", "employeeId", "employeeName", "employeePhotoUrl", "departmentName",
        "fromDate", "toDate", "days", "type", "reason", "status",
        "approvedBy", "approvedByName", "approvedAt", "createdAt",
    ])
    check("Leave fields", ok, why)

s, b = call("GET", "/leaves?employeeId=me", token=karan)
check("GET /leaves?employeeId=me accepted", s == 200)

s, b = call("GET", f"/holidays?year={date.today().year}", token=karan)
check("GET /holidays readable by any signed-in user", s == 200 and isinstance(b.get("data"), list))
if b.get("data"):
    ok, why = has_fields(b["data"][0], ["id", "date", "name"])
    check("Holiday fields", ok, why)

s, b = call("POST", "/holidays", {"date": "2099-01-01", "name": "Nope"}, token=karan)
check("POST /holidays refused without holidays.manage", s == 403)

print("\nEXPORT  — the Export button on AttendancePage")
import urllib.request as _u
req = _u.Request(f"{BASE}/attendance/export?dateFrom={date.today()}&dateTo={date.today()}")
req.add_header("Authorization", f"Bearer {owner}")
try:
    with _u.urlopen(req) as r:
        headers = {k.lower(): v for k, v in r.headers.items()}
        body_text = r.read().decode()
    check("GET /attendance/export returns CSV", "text/csv" in headers.get("content-type", ""))
    check("filename header present", "attachment" in headers.get("content-disposition", ""),
          headers.get("content-disposition", "(none)"))
    check("header row matches the expected columns",
          body_text.splitlines()[0].startswith("Employee code,Name,Department,Date,Day"))
except Exception as exc:
    check("GET /attendance/export returns CSV", False, str(exc))

print("\nCORRECTIONS  — CorrectionsPage, CorrectionForm")
s, b = call("GET", "/corrections?pageSize=10", token=owner)
check("GET /corrections -> Paginated<Correction>", s == 200 and "meta" in b)
if b.get("data"):
    ok, why = has_fields(b["data"][0], [
        "id", "employeeId", "employeeName", "employeePhotoUrl", "date", "reason",
        "proposedIn", "proposedOut", "currentIn", "currentOut", "status",
        "requestedBy", "requestedByName", "approvedBy", "approvedByName",
        "approvedAt", "createdAt",
    ])
    check("Correction fields", ok, why)

s, b = call("GET", "/corrections", token=karan)
check("an employee can read their own corrections", s == 200)

print("\n" + "=" * 62)
if failures:
    print(f"{len(failures)} MISMATCH(ES):")
    for f in failures:
        print(f"  - {f}")
else:
    print("Every endpoint the frontend calls matches the frozen contract.")
    print("The cutover is one flag in main.tsx.")
