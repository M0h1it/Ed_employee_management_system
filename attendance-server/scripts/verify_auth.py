import json, urllib.request, urllib.error

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

def show(label, status, body, keep=None):
    print(f"\n{label}")
    print(f"  status {status}")
    if body and keep:
        print("  ", {k: body.get(k) for k in keep})
    elif body:
        print("  ", json.dumps(body)[:200])

# 1. employee login and scoped permissions
s, b = call("POST", "/auth/login", {"username": "karan", "password": "demo123"})
token = b["accessToken"]
print("\n1. karan signs in")
print("   role:", b["user"]["roleName"])
print("   permissions:", b["user"]["permissions"])
print("   -> only 5, and none of them start with roles. or users.")

# 2. /me with that token
s, b = call("GET", "/me", token=token)
show("2. /me returns the same person", s, b["data"], ["name", "roleName", "attendanceTracked"])

# 3. wrong password
s, b = call("POST", "/auth/login", {"username": "owner", "password": "wrong"})
show("3. wrong password", s, b["error"], ["code", "message"])

# 4. username that does not exist -> IDENTICAL message
s2, b2 = call("POST", "/auth/login", {"username": "nobody", "password": "wrong"})
print("\n4. username that does not exist")
print("   status", s2, "message:", b2["error"]["message"])
print("   -> identical to #3, so usernames cannot be enumerated:",
      b["error"]["message"] == b2["error"]["message"])

# 5. no token
s, b = call("GET", "/me")
show("5. /me with no token", s, b["error"], ["code", "message"])

# 6. forged token
s, b = call("GET", "/me", token="eyJhbGciOiJIUzI1NiJ9.forged.signature")
show("6. /me with a forged token", s, b["error"], ["code", "message"])

# 7. password change, wrong current
s, b = call("PATCH", "/me/password",
            {"currentPassword": "nope", "newPassword": "brandnewpass"}, token=token)
show("7. change password with the wrong current one", s, b["error"], ["code", "fields"])

# 8. password change, too short -> Pydantic catches it before the route runs
s, b = call("PATCH", "/me/password",
            {"currentPassword": "demo123", "newPassword": "abc"}, token=token)
print("\n8. new password too short")
print("   status", s, "-> Pydantic rejected it before the handler ran")

# 9. owner sees everything
s, b = call("POST", "/auth/login", {"username": "owner", "password": "owner123"})
print("\n9. owner signs in")
print("   permissions:", len(b["user"]["permissions"]), "of 17")
print("   attendanceTracked:", b["user"]["attendanceTracked"], "-> owner is not on a shift")

# 10. manager sits in between
s, b = call("POST", "/auth/login", {"username": "marcus", "password": "demo123"})
print("\n10. marcus (Manager) signs in")
print("    permissions:", len(b["user"]["permissions"]))
print("    has roles.manage:", "roles.manage" in b["user"]["permissions"], "-> cannot create an Owner")
print("    has users.change_role:", "users.change_role" in b["user"]["permissions"])
