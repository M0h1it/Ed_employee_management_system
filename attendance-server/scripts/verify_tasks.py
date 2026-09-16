"""
scripts/verify_tasks.py

Checks the tasks API against a running server.
Run after `python -m app.seed`.
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
marcus, marcus_user = token_for("marcus", "demo123")
karan, karan_user = token_for("karan", "demo123")

today = date.today()

print("1. owner assigns a task to karan")
s, b = call("POST", "/tasks", {
    "employeeId": karan_user["employeeId"],
    "title": "Reconcile October vendor invoices",
    "description": "Cross-check the three outstanding invoices against purchase orders.",
    "dueDate": str(today + timedelta(days=3)),
    "priority": "high",
}, token=owner)
assigned_id = b["data"]["id"]
print(f"   status {s}   assignedBy='{b['data']['assignedByName']}'  selfAssigned={b['data']['selfAssigned']}")

print("\n2. an overdue task")
s, b = call("POST", "/tasks", {
    "employeeId": karan_user["employeeId"], "title": "Audit the biometric sensor sync log",
    "dueDate": str(today - timedelta(days=2)), "priority": "high",
}, token=owner)
overdue_id = b["data"]["id"]
print(f"   dueDate {b['data']['dueDate']}  isOverdue={b['data']['isOverdue']}")
print("   computed on read, never stored — a stored value is wrong the next morning")

print("\n3. karan adds a task to his OWN list")
s, b = call("POST", "/tasks", {
    "employeeId": karan_user["employeeId"], "title": "Plan tomorrow's stock count",
    "priority": "medium", "selfAssigned": True,
}, token=karan)
own_id = b["data"]["id"]
print(f"   status {s}   selfAssigned={b['data']['selfAssigned']}  assignedBy='{b['data']['assignedByName']}'")
print("   tasks.create_own is enough — planning your own day is not authority over anyone")

print("\n4. karan tries to assign work to the OWNER")
s, b = call("POST", "/tasks", {
    "employeeId": owner_user["employeeId"], "title": "Approve my expenses", "priority": "high",
}, token=karan)
print(f"   status {s} -> {b['error']['message']}")
print("   without this check, create_own would let anyone assign work to their manager")

print("\n5. karan's board shows only his own")
s, b = call("GET", "/tasks", token=karan)
names = {t["employeeName"] for t in b["data"]}
print(f"   status {s}   {b['meta']['total']} tasks, all for: {names}")

print("\n6. overdue tasks sort to the top")
order = [(t["title"][:34], t["isOverdue"]) for t in b["data"][:3]]
for title, od in order:
    print(f"     {'OVERDUE' if od else '       '}  {title}")

print("\n7. karan completes his own task")
s, b = call("PATCH", f"/tasks/{own_id}/complete", token=karan)
print(f"   status {s}   status={b['data']['status']}  completedAt set by the SERVER: {b['data']['completedAt'][:19]}")

print("\n8. karan tries to EDIT a task's details")
s, b = call("PATCH", f"/tasks/{assigned_id}", {"title": "Something much easier"}, token=karan)
print(f"   status {s} -> {b['error']['message']}")
print("   moving your own task between columns is not the same act as rewriting it")

print("\n9. karan CAN move his own task between columns")
s, b = call("PATCH", f"/tasks/{assigned_id}", {"status": "in_progress"}, token=karan)
print(f"   status {s}   status={b['data']['status']}")

print("\n10. reopening clears the completion stamp")
s, b = call("PATCH", f"/tasks/{own_id}", {"status": "todo"}, token=karan)
print(f"    status={b['data']['status']}  completedAt={b['data']['completedAt']}")
print("    otherwise a reopened task keeps claiming it was finished")

print("\n11. marcus (Manager) can assign and edit")
s, b = call("POST", "/tasks", {
    "employeeId": karan_user["employeeId"], "title": "Write migration notes", "priority": "low",
}, token=marcus)
print(f"    POST  -> {s}")
s, b = call("PATCH", f"/tasks/{assigned_id}", {"priority": "low"}, token=marcus)
print(f"    PATCH -> {s}  priority={b['data']['priority']}  (Manager has tasks.edit)")

print("\n12. karan cannot complete somebody else's task")
s, b = call("POST", "/tasks", {
    "employeeId": marcus_user["employeeId"], "title": "Marcus only", "priority": "low",
}, token=owner)
marcus_task = b["data"]["id"]
s, b = call("PATCH", f"/tasks/{marcus_task}/complete", token=karan)
print(f"    status {s} -> {b['error']['message']}")

print("\n13. filters")
s, b = call("GET", "/tasks?status=todo&priority=high", token=owner)
print(f"    todo + high -> {b['meta']['total']}")
s, b = call("GET", "/tasks?search=invoice", token=owner)
print(f"    search 'invoice' -> {b['meta']['total']}: {[t['title'][:30] for t in b['data']]}")

print("\n14. a title that is too short")
s, b = call("POST", "/tasks", {
    "employeeId": karan_user["employeeId"], "title": "x", "priority": "low",
}, token=owner)
print(f"    status {s} -> Pydantic rejected it before the handler ran")
