"""
scripts/verify_attendance.py

Checks the attendance API against a running server.
Run after `python -m app.seed` and `python -m app.seed_punches`.
"""

import json
import urllib.error
import urllib.request
from datetime import date, timedelta

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


owner, owner_user = token_for("owner", "owner123")
karan, karan_user = token_for("karan", "demo123")

today = date.today()
start = today - timedelta(days=13)

print("1. the register for the last 14 days")
s, b = call("GET", f"/attendance/days?dateFrom={start}&dateTo={today}&pageSize=200", token=owner)
rows = b["data"]
print(f"   status {s}   {b['meta']['total']} day-records computed from raw punches")

counts = {}
for r in rows:
    counts[r["status"]] = counts.get(r["status"], 0) + 1
print(f"   statuses: {counts}")

flags = {}
for r in rows:
    for f in r["flags"]:
        flags[f] = flags.get(f, 0) + 1
print(f"   flags:    {flags}")

print("\n2. holidays are not a company-wide no-show")
holiday_rows = [r for r in rows if r["status"] == "HOLIDAY"]
print(f"   {len(holiday_rows)} HOLIDAY records on {holiday_rows[0]['date'] if holiday_rows else '-'}")
print("   without the holidays table these would all read ABSENT")

print("\n3. approved leave is not absence")
leave_rows = [r for r in rows if r["status"] == "ON_LEAVE"]
for r in leave_rows:
    print(f"   {r['employeeName']} on {r['date']} -> ON_LEAVE (not ABSENT)")

print("\n4. exceptions-only filter")
s, b = call("GET", f"/attendance/days?dateFrom={start}&dateTo={today}&hasFlags=true&pageSize=200", token=owner)
print(f"   {b['meta']['total']} of {len(rows)} records need a human look")

print("\n5. karan sees only his own rows, even asking for everyone")
s, b = call("GET", f"/attendance/days?dateFrom={start}&dateTo={today}&pageSize=200", token=karan)
names = {r["employeeName"] for r in b["data"]}
print(f"   status {s}   names in the response: {names}")
print("   the query string asked for no filter; the server forced one")

print("\n6. karan asks for the owner's rows explicitly")
s, b = call("GET",
            f"/attendance/days?dateFrom={start}&dateTo={today}&employeeId={owner_user['employeeId']}",
            token=karan)
names = {r["employeeName"] for r in b["data"]}
print(f"   status {s}   still only: {names or 'nothing'}")
print("   scoping is applied to the filter itself, not checked afterwards")

print("\n7. who is inside right now")
s, b = call("GET", "/attendance/present", token=owner)
print(f"   status {s}   {len(b['data'])} people inside")
for p in b["data"][:3]:
    print(f"     {p['name']:18} in at {p['checkInAt'][11:16]}  {p['minutesSinceCheckIn']}m ago  late={p['isLate']}")

print("\n8. karan cannot see the present list")
s, b = call("GET", "/attendance/present", token=karan)
print(f"   status {s} -> needs attendance.view_all")

print("\n9. drill down to the raw punches behind one row")
sample = next(r for r in rows if r["punchCount"] > 0)
s, b = call("GET", f"/attendance/punches?employeeId={sample['employeeId']}&date={sample['date']}", token=owner)
print(f"   {sample['employeeName']} on {sample['date']}:")
for p in b["data"]:
    conf = f"{int(p['confidence'] * 100)}%" if p["confidence"] else "-"
    print(f"     {p['ts'][11:16]}  {p['direction']:3}  {p['source']:6}  match {conf}")

print("\n10. manual punch, and the duplicate gate")
ts = f"{today}T07:30:00+05:30"
s, b = call("POST", "/attendance/punches", {
    "employeeId": karan_user["employeeId"], "direction": "IN", "ts": ts, "source": "manual",
}, token=owner)
print(f"    first attempt  -> {s} ({'created' if s == 201 else b['error']['code']})")
s, b = call("POST", "/attendance/punches", {
    "employeeId": karan_user["employeeId"], "direction": "IN", "ts": ts, "source": "manual",
}, token=owner)
print(f"    same punch again -> {s} ({b['error']['code']})")
print("    the kiosk treats 409 as success and stops retrying")

print("\n11. a manual entry is visible as such")
s, b = call("GET", f"/attendance/days?dateFrom={today}&dateTo={today}&employeeId={karan_user['employeeId']}", token=owner)
row = b["data"][0]
print(f"    {row['employeeName']} today: status={row['status']} flags={row['flags']}")

print("\n12. the range is capped")
s, b = call("GET", f"/attendance/days?dateFrom={today - timedelta(days=400)}&dateTo={today}", token=owner)
print(f"    400-day request -> {s} ({b['error']['code']})")
print("    employees x days work; without a cap this is a denial of service")

print("\n13. karan's own day card")
s, b = call("GET", "/dashboard/my-today", token=karan)
d = b["data"]
print(f"    status={d['status']}  in={str(d['checkInAt'])[11:16]}  worked={d['workedMinutes']}m  late={d['isLate']}")
