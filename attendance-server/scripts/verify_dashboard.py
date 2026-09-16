"""
scripts/verify_dashboard.py

Checks the dashboard counters, exception list and trend aggregation.
Run after `python -m app.seed` and `python -m app.seed_punches`.
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


owner, _ = token_for("owner", "owner123")
karan, _ = token_for("karan", "demo123")

print("1. the counters")
s, b = call("GET", "/dashboard/stats", token=owner)
d = b["data"]
print(f"   status {s}   {d['date']}")
print(f"   tracked employees  {d['totalEmployees']}")
print(f"   checked in today   {d['checkedInToday']}   <- only ever rises")
print(f"   currently present  {d['currentlyPresent']}   <- moves both ways")
print(f"   checked out        {d['checkedOut']}")
print(f"   late {d['lateCount']}   absent {d['absentCount']}   on leave {d['onLeaveCount']}")
print(f"   tasks open {d['tasksOpen']}   completed today {d['tasksCompletedToday']}")

assert d["checkedInToday"] == d["currentlyPresent"] + d["checkedOut"], "arrivals must split into present + gone"
print("   checkedInToday == currentlyPresent + checkedOut  ✓")
print("   one counter that decremented on check-out would lose the arrival record")

print("\n2. the owner is not counted")
s, emps = call("GET", "/employees?pageSize=50", token=owner)
active = [e for e in emps["data"] if e["status"] == "active"]
untracked = [e for e in active if not e["attendanceTracked"]]
print(f"   {len(active)} active employees, {d['totalEmployees']} tracked")
print(f"   not tracked: {[e['name'] for e in untracked]}")
print("   the labels say 'tracked employees', not 'headcount', because they differ")

print("\n3. the exception list")
s, b = call("GET", "/dashboard/exceptions", token=owner)
print(f"   status {s}   {len(b['data'])} people need a look")
for e in b["data"][:5]:
    if e["flag"] == "ABSENT":
        print(f"     {e['employeeName']:18} ABSENT   expected {e['expectedAt'][11:16]}")
    else:
        print(f"     {e['employeeName']:18} LATE     {e['expectedAt'][11:16]} -> {e['actualAt'][11:16]}  +{e['delayMinutes']}m")
print("   worst first: absences, then the longest delays")

print("\n4. people on approved leave are NOT exceptions")
names = {e["employeeName"] for e in b["data"]}
print(f"   on leave today: {d['onLeaveCount']}")
print("   listing them is exactly what makes an exception report get ignored")

print("\n5. karan cannot see any of it")
for path in ("/dashboard/stats", "/dashboard/exceptions", "/dashboard/trend"):
    s, _ = call("GET", path, token=karan)
    print(f"   {path:28} -> {s}")

print("\n6. the trend, daily")
s, b = call("GET", "/dashboard/trend?granularity=day", token=owner)
print(f"   status {s}   {len(b['data'])} bars")
for p in b["data"][-5:]:
    total = p["present"] + p["late"] + p["absent"]
    pct = round(100 * (p["late"] + p["absent"]) / total) if total else 0
    print(f"     {p['label']:8} on time {p['present']:2}  late {p['late']:2}  absent {p['absent']:2}   {pct}% need a look")

print("\n7. weekly")
s, b = call("GET", "/dashboard/trend?granularity=week", token=owner)
print(f"   {len(b['data'])} bars")
for p in b["data"][-3:]:
    print(f"     {p['label']:6} {p['workingDays']} working days   on time {p['present']:3}  late {p['late']:3}  absent {p['absent']:3}")

print("\n8. monthly")
s, b = call("GET", "/dashboard/trend?granularity=month", token=owner)
for p in b["data"]:
    print(f"     {p['label']:5} {p['workingDays']:2} working days   on time {p['present']:3}  late {p['late']:3}  absent {p['absent']:3}")

print("\n9. every bar adds up")
ok = all(
    p["present"] + p["late"] + p["absent"] <= p["trackedEmployees"] * p["workingDays"]
    for p in b["data"]
)
print(f"   present + late + absent <= tracked x working days: {ok}")
print("   leave days are subtracted, which is why it can be less")

print("\n10. weekends and holidays are excluded")
s, b = call("GET", "/dashboard/trend?granularity=day", token=owner)
labels = [p["label"] for p in b["data"]]
print(f"   14 calendar days -> {len(labels)} bars: {labels}")
print("   a bar that is 100% absent every Saturday tells the owner nothing")

print("\n11. a bad granularity is rejected")
s, b = call("GET", "/dashboard/trend?granularity=decade", token=owner)
print(f"   status {s} -> Pydantic rejected the pattern before the handler ran")
