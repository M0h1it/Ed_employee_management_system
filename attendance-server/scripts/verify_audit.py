"""
scripts/verify_audit.py

Performs real actions, then checks each one left a record — with secrets
redacted and the before/after diff intact.

Run after `python -m app.seed`.
"""

import json
import urllib.error
import urllib.request

BASE = "http://localhost:8000/api/v1"


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


def token_for(username, password):
    _, b = call("POST", "/auth/login", {"username": username, "password": password})
    return b["accessToken"], b["user"]


def latest(action, token, n=1):
    _, b = call(f"/audit?action={action}&pageSize={n}".replace("/audit", "/audit"), token=token) \
        if False else call("GET", f"/audit?action={action}&pageSize={n}", token=token)
    return b["data"]


owner, owner_user = token_for("owner", "owner123")
marcus, _ = token_for("marcus", "demo123")
karan, karan_user = token_for("karan", "demo123")

RUN = str(int(__import__("time").time()))[-6:]

print("1. signing in was recorded")
rows = latest("auth.login", owner, 3)
print(f"   {len(rows)} recent logins")
for r in rows[:3]:
    print(f"     {r['createdAt'][11:19]}  {r['actorName']:14} {r['after'].get('role')}  from {r['ipAddress']}")

print("\n2. changing a role is recorded with before AND after")
_, users = call("GET", "/users?pageSize=100", token=owner)
_, roles = call("GET", "/roles", token=owner)
karan_account = next(u for u in users["data"] if u["username"] == "karan")
by_name = {r["name"]: r for r in roles["data"]}

call("PATCH", f"/users/{karan_account['id']}/role",
     {"roleId": by_name["Manager"]["id"]}, token=owner)
call("PATCH", f"/users/{karan_account['id']}/role",
     {"roleId": by_name["Employee"]["id"]}, token=owner)

rows = latest("user.change_role", owner, 2)
for r in rows:
    print(f"   {r['actorName']} moved {r['before']['username']}: "
          f"{r['before']['role']} -> {r['after']['role']}")
print("   the single most consequential action in the system")

print("\n3. a password reset is recorded — WITHOUT the password")
# A THROWAWAY ACCOUNT, not one the other scripts sign in as.
#
# An earlier version reset karan's password here and restored it afterwards.
# Every other verification script signs in as karan, and any timing gap meant
# they failed — five times, after which the account locked itself. The scripts
# looked broken; the data was.
#
# This is the second time that mistake has been made in this project, which is
# why the rule is now: a test never touches an account another test depends on.
_, emps_all = call("GET", "/employees?pageSize=100", token=owner)
spare = next((e for e in emps_all["data"] if not e["hasLogin"] and e["status"] == "active"), None)

if spare is None:
    # Everyone already has a login. Create a throwaway employee rather than
    # skipping — this is the one assertion in the file that would matter most
    # if it ever broke, and a test that quietly does nothing is worse than no
    # test, because it reports success.
    s_emp, b_emp = call("POST", "/employees", {
        "name": f"Audit Probe {RUN}", "email": f"audit.probe.{RUN}@nexusops.com",
        "phone": "9800000000", "departmentId": None, "position": "Probe",
        "joinDate": "2026-01-01",
    }, token=owner)
    if s_emp != 201:
        _, depts = call("GET", "/departments", token=owner)
        s_emp, b_emp = call("POST", "/employees", {
            "name": f"Audit Probe {RUN}", "email": f"audit.probe.{RUN}@nexusops.com",
            "phone": "9800000000", "departmentId": depts["data"][0]["id"],
            "position": "Probe", "joinDate": "2026-01-01",
        }, token=owner)
    spare = b_emp["data"] if s_emp == 201 else None

if spare:
    s, b = call("POST", "/users", {
        "employeeId": spare["id"], "username": f"audit{RUN}",
        "temporaryPassword": "Initial-Pass-1", "roleId": by_name["Employee"]["id"],
        "mustChangePassword": False,
    }, token=owner)
    throwaway_id = b["data"]["id"] if s == 201 else None
else:
    throwaway_id = None

if throwaway_id:
    call("PATCH", f"/users/{throwaway_id}/password",
         {"newPassword": "Sup3r-Secret-Value", "mustChangePassword": False}, token=owner)
    row = latest("user.reset_password", owner)[0]
    print(f"   after: {row['after']}")
    leaked = "Sup3r-Secret-Value" in json.dumps(row)
    print(f"   the actual password appears anywhere in the row: {leaked}")
    print("   the KEY is kept so the log shows a reset happened; the VALUE is not")
else:
    print("   skipped — no spare employee without a login")

print("\n4. disabling and enabling an account")
target_id = throwaway_id or karan_account["id"]
call("PATCH", f"/users/{target_id}/status", {"isActive": False}, token=owner)
call("PATCH", f"/users/{target_id}/status", {"isActive": True}, token=owner)
for r in latest("user.", owner, 4):
    if r["action"] in ("user.disable", "user.enable"):
        print(f"   {r['action']:14} {r['after']['username']}  "
              f"{r['before']['isActive']} -> {r['after']['isActive']}")

print("\n5. an employee edit records only what changed")
_, emps = call("GET", "/employees?pageSize=50", token=owner)
target = next(e for e in emps["data"] if e["name"] == "Rachel Wong")
original = target["position"]
call("PATCH", f"/employees/{target['id']}", {"position": f"Lead {RUN}"}, token=owner)
row = latest("employee.update", owner)[0]
print(f"   before: {row['before']}")
print(f"   after:  {row['after']}")
print("   a diff of forty unchanged columns would bury the one that moved")
call("PATCH", f"/employees/{target['id']}", {"position": original}, token=owner)

print("\n6. a manual punch is recorded")
import datetime as _dt
ts = f"{_dt.date.today()}T06:{RUN[-2:]}:00+05:30"
s, _ = call("POST", "/attendance/punches", {
    "employeeId": karan_user["employeeId"], "direction": "IN", "ts": ts, "source": "manual",
}, token=owner)
if s == 201:
    row = latest("punch.manual", owner)[0]
    print(f"   {row['actorName']} entered {row['after']['direction']} for "
          f"{row['after']['employee']} at {row['after']['ts'][11:16]}")
    print("   the one attendance record with no device behind it")
else:
    print("   (duplicate punch, already recorded on an earlier run)")

print("\n7. a policy change records the OLD rule")
call("PATCH", "/settings", {"graceMinutes": 10}, token=owner)
row = latest("settings.update", owner)[0]
print(f"   grace {row['before']['graceMinutes']} -> {row['after']['graceMinutes']} minutes")
print("   the change is retroactive, so the old rule is the only way to explain")
print("   later why last month's figures moved")
call("PATCH", "/settings", {"graceMinutes": 15}, token=owner)

print("\n8. role permission edits")
s, b = call("POST", "/roles", {
    "name": f"Temp {RUN}", "description": "for the audit test",
    "permissions": ["tasks.view_own"],
}, token=owner)
temp_id = b["data"]["id"]
call("PATCH", f"/roles/{temp_id}",
     {"permissions": ["tasks.view_own", "attendance.view_own"]}, token=owner)
row = latest("role.update", owner)[0]
print(f"   permissions: '{row['before']['permissions']}'")
print(f"             -> '{row['after']['permissions']}'")
call("DELETE", f"/roles/{temp_id}", token=owner)
row = latest("role.delete", owner)[0]
print(f"   then deleted: {row['before']['name']}")

print("\n9. only audit.view can read it")
for name, tok in (("marcus", marcus), ("karan", karan)):
    s, _ = call("GET", "/audit", token=tok)
    print(f"   {name:7} -> {s}")

print("\n10. there is no way to write or erase a row")
for method, path in (("POST", "/audit"), ("DELETE", "/audit"),
                     ("PATCH", "/audit/00000000-0000-0000-0000-000000000000")):
    s, _ = call(method, path, {} if method != "DELETE" else None, token=owner)
    print(f"   {method:6} {path:48} -> {s}")
print("   405 means the route does not accept it — no endpoint exists at all.")
print("   A log the application can edit is not evidence.")

print("\n11. filters")
for f in ("action=user", "action=auth", "entity=role"):
    s, b = call("GET", f"/audit?{f}&pageSize=1", token=owner)
    print(f"   {f:16} -> {b['meta']['total']} rows")

print("\n12. what the log currently holds")
s, b = call("GET", "/audit/actions", token=owner)
for item in b["data"]:
    print(f"   {item['action']:24} {item['count']}")
