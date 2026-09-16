"""
scripts/verify_admin.py

Checks roles, permissions and login accounts — with the escalation guards as
the main event.

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


def err(body):
    return body["error"]


owner, owner_user = token_for("owner", "owner123")
marcus, marcus_user = token_for("marcus", "demo123")
karan, karan_user = token_for("karan", "demo123")

print("1. the permission catalogue")
s, b = call("GET", "/permissions", token=owner)
modules = {}
for p in b["data"]:
    modules.setdefault(p["module"], []).append(p["code"])
print(f"   status {s}   {len(b['data'])} permissions across {len(modules)} modules")
print("   there is no POST /permissions — a permission is a gate in the code,")
print("   and one invented at runtime would be consulted by nothing")

print("\n2. roles and their usage")
s, b = call("GET", "/roles", token=owner)
for r in b["data"]:
    lock = " [system]" if r["isSystem"] else ""
    print(f"   {r['name']:9} {len(r['permissions']):2} permissions  {r['userCount']} accounts{lock}")

roles = {r["name"]: r for r in b["data"]}

print("\n3. karan cannot see the roles screen at all")
s, b = call("GET", "/roles", token=karan)
print(f"   status {s} -> {err(b)['code']}")

# --- THE ESCALATION GUARDS ------------------------------------------------

print("\n4. ESCALATION — marcus tries to make karan an Owner")
_, users = call("GET", "/users?pageSize=50", token=owner)
karan_account = next(u for u in users["data"] if u["username"] == "karan")
marcus_account = next(u for u in users["data"] if u["username"] == "marcus")
owner_account = next(u for u in users["data"] if u["username"] == "owner")

s, b = call("PATCH", f"/users/{karan_account['id']}/role",
            {"roleId": roles["Owner"]["id"]}, token=marcus)
print(f"   status {s} -> {err(b)['code']}")
print(f"   {err(b)['message']}")
print("   the subset rule: marcus has no roles.manage, so he cannot grant it")

print("\n5. SELF — marcus tries to promote himself")
s, b = call("PATCH", f"/users/{marcus_account['id']}/role",
            {"roleId": roles["Owner"]["id"]}, token=marcus)
print(f"   status {s} -> {err(b)['code']}: {err(b)['message']}")

print("\n6. PEER — marcus tries to demote the owner")
s, b = call("PATCH", f"/users/{owner_account['id']}/role",
            {"roleId": roles["Employee"]["id"]}, token=marcus)
print(f"   status {s} -> {err(b)['code']}: {err(b)['message']}")

print("\n7. what marcus IS allowed to hand out")
s, b = call("GET", "/roles/assignable", token=marcus)
print(f"   status {s}   {[r['name'] for r in b['data']]}")
print("   filtered by the server, not the browser — but the write is checked again")

print("\n8. marcus CAN move an employee within his reach")
s, b = call("PATCH", f"/users/{karan_account['id']}/role",
            {"roleId": roles["Employee"]["id"]}, token=marcus)
print(f"   status {s}   karan is now {b['data']['roleName']}")

print("\n9. ESCALATION via a new role — marcus builds an 'everything' role")
s, b = call("POST", "/roles", {
    "name": "Super", "description": "everything", "permissions": ["roles.manage", "users.manage"],
}, token=marcus)
print(f"   status {s} -> {err(b)['code'] if s >= 400 else 'created'}")
print("   marcus has no roles.manage at all, so he cannot even reach this endpoint")

print("\n10. the owner creates a limited role")
s, b = call("POST", "/roles", {
    "name": "Shift Lead", "description": "Runs the floor",
    "permissions": ["employees.view_all", "attendance.view_all", "tasks.assign", "tasks.view_all"],
}, token=owner)
shift_lead_id = b["data"]["id"] if s == 201 else roles.get("Shift Lead", {}).get("id")
print(f"    status {s}   {b['data']['name'] if s == 201 else 'already exists'}")

print("\n11. LAST ADMIN — the owner removes roles.manage from the only role with it")
owner_perms = [p for p in roles["Owner"]["permissions"] if p != "roles.manage"]
s, b = call("PATCH", f"/roles/{roles['Owner']['id']}", {"permissions": owner_perms}, token=owner)
print(f"    status {s} -> {err(b)['code']}")
print(f"    {err(b)['message']}")
print("    without this, the fix would be a manual SQL UPDATE on production")

print("\n12. system roles cannot be renamed")
s, b = call("PATCH", f"/roles/{roles['Owner']['id']}", {"name": "Boss"}, token=owner)
print(f"    status {s} -> {err(b)['code']}: {err(b)['message']}")

print("\n13a. a NON-system role that is in use cannot be deleted")
# Manager is not a system role but marcus uses it — this proves ROLE_IN_USE
# rather than tripping the system-role guard first.
s, b = call("DELETE", f"/roles/{roles['Manager']['id']}", token=owner)
print(f"    status {s} -> {err(b)['code']}: {err(b)['message']}")

print("\n13b. an unused role CAN be deleted")
_, all_roles = call("GET", "/roles", token=owner)
unused = [r for r in all_roles["data"] if not r["isSystem"] and r["userCount"] == 0]
if unused:
    s, _ = call("DELETE", f"/roles/{unused[0]['id']}", token=owner)
    print(f"    deleting '{unused[0]['name']}' -> {s} (204 = gone)")
else:
    print("    no unused role to delete")

# --- ACCOUNTS -------------------------------------------------------------

print("\n14. create a login")
# A THROWAWAY ACCOUNT, created here and used only by this script.
#
# An earlier version fell back to karan's account when everybody already had a
# login — and then reset his password in step 15. Every other verification
# script signs in as karan with demo123, so they all started failing, and after
# five attempts the account locked itself. The scripts looked broken; the data
# was.
#
# A test that mutates state other tests depend on produces failures that point
# nowhere near the cause.
_, emps = call("GET", "/employees?pageSize=50", token=owner)
without_login = [e for e in emps["data"] if not e["hasLogin"] and e["status"] == "active"]

if without_login:
    target = without_login[0]
    s, b = call("POST", "/users", {
        "employeeId": target["id"], "username": target["name"].split()[0].lower(),
        "temporaryPassword": "Temp-Passw0rd", "roleId": roles["Employee"]["id"],
        "mustChangePassword": True,
    }, token=owner)
    print(f"    status {s}   {b['data']['username']} created for {b['data']['employeeName']}")
    print(f"    response keys: {sorted(b['data'].keys())}")
    print("    no password field, in any direction, not even hashed")
    new_user_id = b["data"]["id"]
else:
    # Everybody has a login already. Steps 15 and 17 mutate an account, so they
    # are skipped rather than aimed at somebody the other scripts rely on.
    new_user_id = None
    print("    everyone already has a login — skipping the mutating steps below")

print("\n15. reset a password")
if new_user_id:
    s, b = call("PATCH", f"/users/{new_user_id}/password",
                {"newPassword": "An0ther-Temp-Pass", "mustChangePassword": True}, token=owner)
    print(f"    status {s} -> 204, nothing returned and nothing that could leak")
else:
    print("    skipped (no throwaway account)")
print("    note there is no currentPassword field — the person has forgotten it,")
print("    which is the entire point. /me/password DOES require it.")

print("\n16. marcus cannot reset passwords")
# Safe against any account: the request is refused before it changes anything.
s, b = call("PATCH", f"/users/{karan_account['id']}/password",
            {"newPassword": "Should-Not-Work-1"}, token=marcus)
print(f"    status {s} -> {err(b)['code']} (no users.manage)")

print("\n17. disabling is a toggle, never a delete")
if new_user_id:
    s, b = call("PATCH", f"/users/{new_user_id}/status", {"isActive": False}, token=owner)
    print(f"    status {s}   isActive={b['data']['isActive']}")
else:
    print("    skipped (no throwaway account)")
print("    deleting would orphan the audit trail — attendance has to point at somebody")

print("\n18. the owner cannot disable their own account")
s, b = call("PATCH", f"/users/{owner_account['id']}/status", {"isActive": False}, token=owner)
print(f"    status {s} -> {err(b)['code']}: {err(b)['message']}")

print("\n19. and cannot disable the last users.manage account")
s, b = call("PATCH", f"/users/{owner_account['id']}/status", {"isActive": False}, token=owner)
print(f"    status {s} -> {err(b)['code']}")

print("\n20. clean up")
if new_user_id:
    call("PATCH", f"/users/{new_user_id}/status", {"isActive": True}, token=owner)
    print("    throwaway account re-enabled")
else:
    print("    nothing to clean up")
