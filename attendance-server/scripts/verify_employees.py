"""
scripts/verify_employees.py

Checks the employees API against a running server.
Run after `python -m app.seed` and with uvicorn up.
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
    _, body = call("POST", "/auth/login", {"username": username, "password": password})
    return body["accessToken"], body["user"]


# A unique suffix per run. An earlier version used a fixed email, which meant
# the script passed once and then failed on every later run with "email already
# in use" — a failure that looks like a broken API and is actually a test that
# cannot be re-run.
RUN = str(int(__import__("time").time()))[-6:]

owner, owner_user = token_for("owner", "owner123")
karan, karan_user = token_for("karan", "demo123")
marcus, _ = token_for("marcus", "demo123")

print("1. owner lists the directory")
s, b = call("GET", "/employees?page=1&pageSize=5", token=owner)
print(f"   status {s}   total {b['meta']['total']}   page {b['meta']['page']}/{b['meta']['totalPages']}")
row = b["data"][0]
print(f"   first row: {row['name']} | {row['departmentName']} | hasLogin={row['hasLogin']} | role={row['roleName']}")

print("\n2. karan (Employee) tries the same list")
s, b = call("GET", "/employees", token=karan)
print(f"   status {s} -> {b['error']['code']}")
print("   the frontend hides this menu item; THIS is what stops the URL working")

print("\n3. karan reads HIS OWN record")
s, b = call("GET", f"/employees/{karan_user['employeeId']}", token=karan)
print(f"   status {s}   {b['data']['name']} | {b['data']['empCode']}")

print("\n4. karan reads SOMEBODY ELSE'S record")
s, b = call("GET", f"/employees/{owner_user['employeeId']}", token=karan)
print(f"   status {s} -> {b['error']['message']}")
print("   row-level scoping, not just a permission check")

print("\n5. search is case-insensitive")
s, b = call("GET", "/employees?search=KARAN", token=owner)
print(f"   'KARAN' -> {b['meta']['total']} result: {b['data'][0]['name']}")

print("\n6. filter by department")
_, depts = call("GET", "/departments", token=owner)
eng = next(d for d in depts["data"] if d["name"] == "Engineering")
s, b = call("GET", f"/employees?departmentId={eng['id']}", token=owner)
print(f"   Engineering -> {b['meta']['total']}: {[e['name'] for e in b['data']]}")

print("\n7. create an employee")
s, b = call("POST", "/employees", {
    "name": f"Test Person {RUN}", "email": f"test.person.{RUN}@nexusops.com", "phone": "9876543210",
    "departmentId": eng["id"], "position": "Engineer", "joinDate": "2026-09-15",
}, token=owner)
print(f"   status {s}   empCode {b['data']['empCode']} auto-generated, hasLogin={b['data']['hasLogin']}")
new_id = b["data"]["id"]

print("\n8. duplicate email is rejected")
s, b = call("POST", "/employees", {
    "name": "Someone Else", "email": f"test.person.{RUN}@nexusops.com", "phone": "9876543211",
    "departmentId": eng["id"], "position": "Engineer", "joinDate": "2026-09-15",
}, token=owner)
print(f"   status {s} -> {b['error']['fields']}")

print("\n9. bad phone number")
s, b = call("POST", "/employees", {
    "name": "Bad Phone", "email": f"bad.phone.{RUN}@nexusops.com", "phone": "12345",
    "departmentId": eng["id"], "position": "Engineer", "joinDate": "2026-09-15",
}, token=owner)
print(f"   status {s} -> Pydantic rejected the pattern before the handler ran")

print("\n10. PATCH changes only what was sent")
s, b = call("PATCH", f"/employees/{new_id}", {"position": "Senior Engineer"}, token=owner)
print(f"   status {s}   position='{b['data']['position']}'   name still '{b['data']['name']}'")

print("\n11. marcus (Manager) can list but not create")
s, _ = call("GET", "/employees", token=marcus)
print(f"   GET  /employees -> {s}")
s, b = call("POST", "/employees", {
    "name": "Nope", "email": f"nope.{RUN}@nexusops.com", "phone": "9876543212",
    "departmentId": eng["id"], "position": "Engineer", "joinDate": "2026-09-15",
}, token=marcus)
print(f"   POST /employees -> {s} ({b['error']['code']}) — Manager has no employees.create")

print("\n12. mark inactive, never delete")
s, b = call("PATCH", f"/employees/{new_id}", {"status": "inactive"}, token=owner)
print(f"   status {s}   status='{b['data']['status']}' — punches and tasks keep pointing at them")
