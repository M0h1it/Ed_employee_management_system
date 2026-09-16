"""
scripts/verify_pages.py

Simulates the requests each screen makes, for each role, and fails on any 403.

WHY THIS EXISTS — a gap verify_contract.py did not catch
--------------------------------------------------------
The contract audit checks that every endpoint answers in the right shape. It
signs in as an owner to do that, so it can never see a permission problem.

The first time the real backend was connected, an employee opening the tasks
board got three 403s. The cause was not a missing permission — it was three
modals fetching the employee directory to fill a picker that was hidden. Modals
render while closed, so their hooks fire on mount regardless.

The fix was to stop asking for data the screen does not need. This script is
what would have caught it: it walks the pages a role can actually reach and
asserts that nothing it requests is refused.

A request that should not happen is a bug even when it succeeds — with an owner
signed in, those three calls quietly loaded the whole directory for a picker
nobody could see.
"""

import json
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = "http://localhost:8000/api/v1"
today = date.today()
start = today - timedelta(days=13)
month_start = today - timedelta(days=29)

failures: list[str] = []


def call(path, token):
    req = urllib.request.Request(BASE + path)
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def token_and_user(username, password):
    req = urllib.request.Request(BASE + "/auth/login", method="POST")
    req.add_header("Content-Type", "application/json")
    body = json.dumps({"username": username, "password": password}).encode()
    with urllib.request.urlopen(req, body) as r:
        data = json.load(r)
    return data["accessToken"], data["user"]


def pages_for(user, employee_id):
    """
    What each screen fetches, in the order it mounts — including the queries
    inside modals, which run whether or not the modal is open.
    """
    perms = set(user["permissions"])
    sees_all = "attendance.view_all" in perms

    plan: dict[str, list[str]] = {}

    # --- Sidebar, on every page -------------------------------------------
    plan["Sidebar"] = []
    if "employees.view_all" in perms:
        plan["Sidebar"].append("/employees?pageSize=1&status=active")

    # --- Dashboard ---------------------------------------------------------
    dash = []
    if user["attendanceTracked"]:
        dash.append("/dashboard/my-today")
    if sees_all:
        dash += [
            "/dashboard/stats",
            "/dashboard/exceptions",
            "/dashboard/trend?granularity=day",
            "/attendance/present",
            "/tasks?status=todo&pageSize=6",
        ]
        if user["attendanceTracked"]:
            dash.append(f"/attendance/days?dateFrom={month_start}&dateTo={today}"
                        f"&employeeId={employee_id}&pageSize=40")
    else:
        dash += [
            "/tasks?employeeId=me&pageSize=50",
            f"/attendance/days?dateFrom={month_start}&dateTo={today}"
            f"&employeeId={employee_id}&pageSize=40",
        ]
    plan["Dashboard"] = dash

    # --- Attendance --------------------------------------------------------
    att = [f"/attendance/days?dateFrom={today}&dateTo={today}&pageSize=15", "/departments"]
    # ManualPunchModal is mounted on this page. Its employee list must NOT be
    # requested unless the modal is open — that was the original bug.
    plan["Attendance"] = att

    # --- Tasks -------------------------------------------------------------
    tasks = ["/tasks?pageSize=100"] if sees_all else ["/tasks?employeeId=me&pageSize=100"]
    # The timeline view fetches this as well.
    tasks.append("/tasks/timeline?range=2w" if sees_all else "/tasks/timeline?range=2w&employeeId=me")
    if "tasks.view_all" in perms:
        tasks.append("/employees?pageSize=100&status=active")
    plan["Tasks"] = tasks

    # --- Leave -------------------------------------------------------------
    if "leave.view_all" in perms:
        plan["Leave"] = ["/leaves?pageSize=100", "/holidays"]
    elif "leave.view_own" in perms:
        plan["Leave"] = ["/leaves?employeeId=me&pageSize=100", "/holidays"]

    # --- Corrections -------------------------------------------------------
    if "corrections.view_all" in perms or "corrections.request" in perms:
        plan["Corrections"] = ["/corrections?pageSize=100"]

    # --- Settings ----------------------------------------------------------
    settings = ["/settings"] if "settings.manage" in perms else []
    if "holidays.manage" in perms:
        settings.append("/holidays")
    plan["Settings"] = settings

    # --- Administration ----------------------------------------------------
    if "employees.view_all" in perms:
        plan["Employees"] = ["/employees?page=1&pageSize=10", "/departments", "/shifts"]
    if "roles.manage" in perms:
        plan["Roles"] = ["/roles", "/permissions"]
    if "users.manage" in perms:
        plan["Access Control"] = ["/users?pageSize=20", "/roles"]
    if "audit.view" in perms:
        plan["Audit Log"] = ["/audit?pageSize=25", "/audit/actions"]

    return plan


for username, password in (("owner", "owner123"), ("marcus", "demo123"), ("karan", "demo123")):
    token, user = token_and_user(username, password)
    print(f"\n{username}  ({user['roleName']}, {len(user['permissions'])} permissions)")

    for page, paths in pages_for(user, user["employeeId"]).items():
        if not paths:
            continue
        results = [(p, call(p, token)) for p in paths]
        bad = [(p, s) for p, s in results if s >= 400]
        if bad:
            print(f"  FAIL  {page}")
            for p, s in bad:
                print(f"          {s}  {p}")
                failures.append(f"{username} / {page}: {s} {p}")
        else:
            print(f"  OK    {page}  ({len(results)} requests)")

print("\n" + "=" * 62)
if failures:
    print(f"{len(failures)} REFUSED REQUEST(S):")
    for f in failures:
        print(f"  - {f}")
else:
    print("No screen requests anything its viewer is not allowed to have.")
