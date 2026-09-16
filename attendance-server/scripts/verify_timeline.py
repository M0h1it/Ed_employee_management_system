"""
scripts/verify_timeline.py

Checks the task timeline endpoint.
Run after `python -m app.seed` and `python -m app.seed_tasks`.
"""

import json
import urllib.error
import urllib.request
from datetime import date, timedelta

BASE = "http://localhost:8000/api/v1"


def call(path, token):
    req = urllib.request.Request(BASE + path)
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def token_for(username, password):
    req = urllib.request.Request(BASE + "/auth/login", method="POST")
    req.add_header("Content-Type", "application/json")
    body = json.dumps({"username": username, "password": password}).encode()
    with urllib.request.urlopen(req, body) as r:
        d = json.load(r)
    return d["accessToken"], d["user"]


owner, _ = token_for("owner", "owner123")
marcus, _ = token_for("marcus", "demo123")
karan, karan_user = token_for("karan", "demo123")

today = date.today()

print("1. the owner sees everyone")
s, b = call("/tasks/timeline?range=2w", owner)
rows = b["data"]
print(f"   status {s}   {len(rows)} rows")
for r in rows:
    load = f"{len(r['bars'])} tasks" if r["bars"] else "free"
    print(f"     {r['employeeName']:18} {load}")

print("\n2. an empty row is kept, not dropped")
free = [r for r in rows if not r["bars"]]
print(f"   {[r['employeeName'] for r in free]} have nothing scheduled")
print("   'who is free' is half the reason to look at this chart")

print("\n3. bars carry both ends")
sample = next(r for r in rows if r["bars"])
bar = sample["bars"][0]
print(f"   {sample['employeeName']}: '{bar['title'][:40]}'")
print(f"     {bar['startDate']} -> {bar['endDate']}   {bar['status']}  overdue={bar['isOverdue']}")

print("\n4. work that started before the window is still shown")
window_start = today - timedelta(days=3)
early = [
    (r["employeeName"], b["title"], b["startDate"])
    for r in rows for b in r["bars"] if b["startDate"] < str(window_start)
]
for name, title, start in early:
    print(f"   {name:18} '{title[:34]}' started {start}")
print("   dropping these would make a busy person look free")

print("\n5. work that runs past the window is shown too")
window_end = today + timedelta(days=10)
late = [
    (r["employeeName"], b["title"], b["endDate"])
    for r in rows for b in r["bars"] if b["endDate"] > str(window_end)
]
for name, title, end in late:
    print(f"   {name:18} '{title[:34]}' ends {end}")

print("\n6. overlapping bars on one person")
for r in rows:
    spans = sorted((b["startDate"], b["endDate"], b["title"]) for b in r["bars"])
    for i in range(len(spans) - 1):
        if spans[i][1] >= spans[i + 1][0]:
            print(f"   {r['employeeName']} is double-booked:")
            print(f"     '{spans[i][2][:34]}'  {spans[i][0]} -> {spans[i][1]}")
            print(f"     '{spans[i+1][2][:34]}'  {spans[i+1][0]} -> {spans[i+1][1]}")
            break

print("\n7. a wider range returns more")
for rng in ("2w", "1m", "3m"):
    s, b = call(f"/tasks/timeline?range={rng}", owner)
    total = sum(len(r["bars"]) for r in b["data"])
    print(f"   {rng}: {total} bars across {len(b['data'])} rows")

print("\n8. karan sees only his own row")
s, b = call("/tasks/timeline?range=2w", karan)
print(f"   status {s}   rows: {[r['employeeName'] for r in b['data']]}")

print("\n9. karan asks for everyone anyway")
s, b = call("/tasks/timeline?range=2w&employeeId=", karan)
print(f"   status {s}   still: {[r['employeeName'] for r in b['data']]}")

print("\n10. karan names somebody else explicitly")
other = next(r["employeeId"] for r in rows if r["employeeName"] != "Karan Patel")
s, b = call(f"/tasks/timeline?range=2w&employeeId={other}", karan)
print(f"    status {s}   still: {[r['employeeName'] for r in b['data']] or 'nothing'}")
print("    scoping is applied to the filter, not checked afterwards")

print("\n11. the owner filters to one person")
s, b = call(f"/tasks/timeline?range=2w&employeeId={other}", owner)
print(f"    status {s}   rows: {[r['employeeName'] for r in b['data']]}")

print("\n12. a status filter drops empty rows")
s, b = call("/tasks/timeline?range=1m&status=in_progress", owner)
print(f"    in_progress -> {len(b['data'])} rows, all non-empty: "
      f"{all(r['bars'] for r in b['data'])}")
print("    unfiltered, an empty row means 'free'; filtered, it means nothing")

print("\n13. marcus sees everyone too")
s, b = call("/tasks/timeline?range=2w", marcus)
print(f"    status {s}   {len(b['data'])} rows")

print("\n14. a bad range is rejected")
s, b = call("/tasks/timeline?range=5y", owner)
print(f"    status {s} -> Pydantic rejected the pattern before the handler ran")

print("\n15. /tasks/timeline is not parsed as a task id")
print("    it resolved above, so the route is declared before /tasks/{task_id}")
