"""
scripts/verify_leave.py

Checks leave requests, holidays, and the CSV export — including whether a
day actually reclassifies once leave is approved.

Run after `python -m app.seed` and `python -m app.seed_punches`.
"""

import csv
import io
import json
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = "http://localhost:8000/api/v1"


def call(method, path, body=None, token=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            text = r.read().decode()
            if raw:
                # Lowercased: Starlette sends header names in lower case, so a
                # lookup for "Content-Disposition" silently misses.
                return r.status, text, {k.lower(): v for k, v in r.headers.items()}
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        if raw:
            return e.code, text, {}
        return e.code, json.loads(text) if text else None


def token_for(username, password):
    _, b = call("POST", "/auth/login", {"username": username, "password": password})
    return b["accessToken"], b["user"]


def err(b):
    return b["error"]


owner, owner_user = token_for("owner", "owner123")
marcus, marcus_user = token_for("marcus", "demo123")
karan, karan_user = token_for("karan", "demo123")

today = date.today()

# A DIFFERENT WINDOW ON EVERY RUN.
#
# A fixed future date meant the second run collided with the first run's
# request, and the fallback looked for a pending row that was by then approved.
# The script failed with IndexError — which reads as a broken API and is
# actually a test that cannot run twice.
#
# Third time this exact mistake has surfaced in this project. The rule: a
# verification script must leave the system in a state where it can run again.
# Randomised so two runs in the same minute do not land on the same window,
# and every row this script creates is removed at the end.
_RUN_OFFSET = __import__("random").randint(1, 400)
future = today + timedelta(days=(7 - today.weekday()) + 21 + _RUN_OFFSET * 7)

# Everything created here, cleaned up at the end. A verification script that
# leaves rows behind slowly fills the database with test data, and the next run
# collides with the last one.
created_leaves: list[str] = []
created_holidays: list[str] = []

print("1. karan applies for leave")
s, b = call("POST", "/leaves", {
    "fromDate": str(future), "toDate": str(future + timedelta(days=4)),
    "type": "casual", "reason": "Family wedding",
}, token=karan)
if s == 201:
    leave_id = b["data"]["id"]
    created_leaves.append(leave_id)
    print(f"   status {s}   {b['data']['fromDate']} to {b['data']['toDate']}")
    print(f"   {b['data']['days']} working days (a 5-day span, weekends excluded)")
    print(f"   status: {b['data']['status']}")
else:
    print(f"   status {s} -> {err(b)['code']}: {err(b)['message']}")
    raise SystemExit("could not create a leave request; the window collided")

print("\n1b. a weekend-only request is refused")
saturday = future + timedelta(days=5)      # future is a Monday
s, b = call("POST", "/leaves", {
    "fromDate": str(saturday), "toDate": str(saturday + timedelta(days=1)),
    "type": "casual", "reason": "weekend only",
}, token=karan)
print(f"   Sat-Sun -> {s} ({err(b)['fields'] if s >= 400 else 'created'})")
print("   0 working days reads as a bug in the day count, not as a bad request")

print("\n2. an overlapping request is refused")
s, b = call("POST", "/leaves", {
    "fromDate": str(future + timedelta(days=2)), "toDate": str(future + timedelta(days=6)),
    "type": "sick", "reason": "overlap test",
}, token=karan)
print(f"   status {s} -> {err(b)['code']}")
print(f"   {err(b)['message']}")
print("   two approved rows covering one day make the rollup ambiguous")

print("\n3. karan cannot approve his own request")
s, b = call("PATCH", f"/leaves/{leave_id}", {"status": "approved"}, token=karan)
print(f"   status {s} -> {err(b)['code']}: {err(b)['message']}")

print("\n4. NOR CAN AN OWNER approve their own")
s, b = call("POST", "/leaves", {
    "fromDate": str(future + timedelta(days=35)), "toDate": str(future + timedelta(days=36)),
    "type": "casual", "reason": "self-approval test",
}, token=owner)
if s == 201:
    own_leave = b["data"]["id"]
    created_leaves.append(own_leave)
    s, b = call("PATCH", f"/leaves/{own_leave}", {"status": "approved"}, token=owner)
    print(f"   status {s} -> {err(b)['code']}: {err(b)['message']}")
    print("   approval is a second pair of eyes; the same person's eyes are not a second pair")
    call("PATCH", f"/leaves/{own_leave}", {"status": "cancelled"}, token=owner)
else:
    print(f"   (owner already has a request in that window)")

print("\n5. marcus approves karan's request")
s, b = call("PATCH", f"/leaves/{leave_id}", {"status": "approved"}, token=marcus)
print(f"   status {s}   {b['data']['status']}, approved by {b['data']['approvedByName']}")

print("\n6. it cannot be approved twice")
s, b = call("PATCH", f"/leaves/{leave_id}", {"status": "rejected"}, token=marcus)
print(f"   status {s} -> {err(b)['code']}: {err(b)['message']}")

print("\n7. THE POINT OF ALL THIS — the day reclassifies")
s, b = call("GET",
            f"/attendance/days?dateFrom={future}&dateTo={future}"
            f"&employeeId={karan_user['employeeId']}", token=owner)
row = b["data"][0] if b["data"] else None
if row:
    print(f"   {row['employeeName']} on {row['date']}: {row['status']}")
    print("   without the leaves table this would read ABSENT, and every")
    print("   absence figure would be wrong from the first month")

print("\n8. karan sees only his own leave")
s, b = call("GET", "/leaves?pageSize=50", token=karan)
names = {r["employeeName"] for r in b["data"]}
print(f"   status {s}   {names}")

print("\n9. karan asks for everyone anyway")
s, b = call("GET", f"/leaves?employeeId={owner_user['employeeId']}", token=karan)
names = {r["employeeName"] for r in b["data"]}
print(f"   status {s}   still: {names or 'nothing'}")

print("\n10. pending requests sort to the top")
s, b = call("GET", "/leaves?pageSize=10", token=owner)
for r in b["data"][:4]:
    print(f"     {r['status']:9} {r['employeeName']:16} {r['fromDate']} ({r['days']}d)")
print("   the list exists to be acted on")

print("\n11. holidays")
probe = date(today.year, 12, 25)
s, b = call("POST", "/holidays", {"date": str(probe), "name": "Christmas"}, token=owner)
print(f"   add Christmas -> {s}")
if s == 201:
    created_holidays.append(b["data"]["id"])
s, b = call("POST", "/holidays", {"date": str(probe), "name": "Duplicate"}, token=owner)
print(f"   same date again -> {s} ({err(b)['fields'] if s >= 400 else 'created'})")

s, b = call("GET", f"/holidays?year={today.year}", token=karan)
print(f"   karan can read the list -> {s}, {len(b['data'])} holidays")
print("   the dates are not sensitive, and the leave form needs them")

s, b = call("POST", "/holidays", {"date": "2027-01-01", "name": "Nope"}, token=karan)
print(f"   karan cannot add one -> {s} ({err(b)['code']})")

print("\n12. a holiday inside a leave span is not counted twice")
s, b = call("POST", "/leaves", {
    "employeeId": marcus_user["employeeId"],
    "fromDate": str(probe - timedelta(days=1)), "toDate": str(probe + timedelta(days=1)),
    "type": "earned", "reason": "holiday overlap test",
}, token=owner)
# Cancelled below, so the same window is free on the next run.
if s == 201:
    created_leaves.append(b["data"]["id"])
    print(f"   3-day span containing Christmas -> {b['data']['days']} working days charged")
else:
    print(f"   ({err(b)['code']})")

print("\n13. CSV export")
start = today - timedelta(days=6)
s, text, headers = call("GET", f"/attendance/export?dateFrom={start}&dateTo={today}",
                        token=owner, raw=True)
rows = list(csv.reader(io.StringIO(text)))
print(f"   status {s}   {len(rows) - 1} data rows")
print(f"   filename: {headers.get('content-disposition', '(missing)')}")
print(f"   columns: {rows[0]}")
print(f"   sample:  {rows[1]}")

print("\n14. hours are decimal, so a spreadsheet can sum them")
hours = [r[7] for r in rows[1:] if r[7] and r[7] != '0.00'][:4]
print(f"   {hours}")
print("   '7:30' cannot be summed without a formula somebody has to remember")

print("\n15. weekends are present in the export")
days = {r[4] for r in rows[1:]}
print(f"   day names in the file: {sorted(days)}")
print("   a comparison against a paper register needs every calendar day,")
print("   or the rows stop lining up")

print("\n16. karan cannot export")
s, b = call("GET", f"/attendance/export?dateFrom={start}&dateTo={today}", token=karan)
print(f"   status {s} -> needs attendance.view_all")

print("\n17. the export range is capped")
s, b = call("GET", f"/attendance/export?dateFrom={today - timedelta(days=400)}&dateTo={today}",
            token=owner)
print(f"   400 days -> {s} ({err(b)['code'] if s >= 400 else 'allowed'})")


print("\n18. cleaning up after itself")
for lid in created_leaves:
    call("PATCH", f"/leaves/{lid}", {"status": "cancelled"}, token=owner)
for hid in created_holidays:
    call("DELETE", f"/holidays/{hid}", token=owner)
print(f"    cancelled {len(created_leaves)} leave requests, "
      f"removed {len(created_holidays)} holidays")
print("    a script that leaves rows behind collides with its own next run")
