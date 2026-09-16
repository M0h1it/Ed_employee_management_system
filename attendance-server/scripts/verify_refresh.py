"""
scripts/verify_refresh.py

Checks the refresh token flow, including rotation and reuse detection.

Uses a cookie jar, because the refresh token is httpOnly — the client code never
reads it, the browser attaches it. This script has to behave the same way.
"""

import http.cookiejar
import json
import urllib.error
import urllib.request

BASE = "http://localhost:8000/api/v1"


def make_client():
    """A fresh cookie jar per client, so two 'browsers' can be simulated."""
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    return opener, jar


def call(opener, method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with opener.open(req, data) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, json.loads(raw) if raw else None


def cookie_names(jar):
    return sorted(c.name for c in jar)


print("1. sign in — a refresh cookie is set")
client, jar = make_client()
s, b = call(client, "POST", "/auth/login", {"username": "karan", "password": "demo123"})
access_1 = b["accessToken"]
print(f"   status {s}   cookies: {cookie_names(jar)}")
refresh_cookie = next(c for c in jar if c.name == "refresh_token")
print(f"   httpOnly path: {refresh_cookie.path}")
print("   scoped to /api/v1/auth, so it is not attached to ordinary API calls")

print("\n2. the access token works")
s, b = call(client, "GET", "/me", token=access_1)
print(f"   status {s}   {b['data']['name']}")

print("\n3. refresh returns a NEW access token")
s, b = call(client, "POST", "/auth/refresh")
access_2 = b["accessToken"]
print(f"   status {s}   token changed: {access_1 != access_2}")
print(f"   the user comes back too: {b['user']['name']} ({b['user']['roleName']})")
print("   so a role change made mid-session reaches the client without a /me call")

print("\n4. the new access token works")
s, b = call(client, "GET", "/me", token=access_2)
print(f"   status {s}")

print("\n5. the refresh cookie ROTATED")
new_cookie = next(c for c in jar if c.name == "refresh_token")
print(f"   value changed: {refresh_cookie.value != new_cookie.value}")
print("   every refresh issues a new token and spends the old one")

print("\n6. REPLAY — the old refresh token is presented again")
# A second client, carrying only the stolen (old) cookie. This is what a thief
# holds after the real user has already refreshed.
thief, thief_jar = make_client()
thief_jar.set_cookie(refresh_cookie)
s, b = call(thief, "POST", "/auth/refresh")
print(f"   status {s} -> {b['error']['code'] if s >= 400 else 'ACCEPTED'}")
print("   an already-spent token cannot appear in normal operation —")
print("   the legitimate client threw its copy away the moment it rotated")

print("\n7. the VICTIM is signed out too")
s, b = call(client, "POST", "/auth/refresh")
print(f"   status {s} -> {b['error']['code'] if s >= 400 else 'still valid'}")
print("   deliberate: the victim signs back in with a password the thief")
print("   does not have, and the thief cannot follow")

print("\n8. sign in again, then log out")
client, jar = make_client()
s, b = call(client, "POST", "/auth/login", {"username": "karan", "password": "demo123"})
access = b["accessToken"]
s, _ = call(client, "POST", "/auth/logout", token=access)
print(f"   logout -> {s}")
s, b = call(client, "POST", "/auth/refresh")
print(f"   refresh after logout -> {s} ({b['error']['code'] if s >= 400 else 'ACCEPTED'})")
print("   logout revokes every refresh token for the user, not just this one")

print("\n9. no cookie at all")
bare, _ = make_client()
s, b = call(bare, "POST", "/auth/refresh")
print(f"   status {s} -> {b['error']['code']}")

print("\n10. a garbage cookie")
fake, fake_jar = make_client()
cookie = http.cookiejar.Cookie(
    version=0, name="refresh_token", value="not-a-real-token", port=None,
    port_specified=False, domain="localhost.local", domain_specified=False,
    domain_initial_dot=False, path="/api/v1/auth", path_specified=True,
    secure=False, expires=None, discard=False, comment=None, comment_url=None,
    rest={}, rfc2109=False,
)
fake_jar.set_cookie(cookie)
s, b = call(fake, "POST", "/auth/refresh")
print(f"   status {s} -> {b['error']['code']}")
print("   only the HASH is stored, so a made-up value matches nothing")

print("\n11. two independent sessions do not disturb each other")
a, _ = make_client()
c, _ = make_client()
call(a, "POST", "/auth/login", {"username": "karan", "password": "demo123"})
call(c, "POST", "/auth/login", {"username": "karan", "password": "demo123"})
sa, _ = call(a, "POST", "/auth/refresh")
sc, _ = call(c, "POST", "/auth/refresh")
print(f"   laptop -> {sa}   phone -> {sc}")
print("   rotation is per token, not per user — signing in twice is normal")

print("\n12. a disabled account cannot refresh")
owner_client, _ = make_client()
_, ob = call(owner_client, "POST", "/auth/login", {"username": "owner", "password": "owner123"})
owner_token = ob["accessToken"]

victim, _ = make_client()
_, vb = call(victim, "POST", "/auth/login", {"username": "karan", "password": "demo123"})
_, users = call(owner_client, "GET", "/users?pageSize=50", token=owner_token)
karan_account = next(u for u in users["data"] if u["username"] == "karan")

call(owner_client, "PATCH", f"/users/{karan_account['id']}/status",
     {"isActive": False}, token=owner_token)
s, b = call(victim, "POST", "/auth/refresh")
print(f"   status {s} -> {b['error']['code'] if s >= 400 else 'ACCEPTED'}")
print("   the token is still cryptographically valid, which is exactly why")
print("   account state is checked on every refresh rather than trusted")

call(owner_client, "PATCH", f"/users/{karan_account['id']}/status",
     {"isActive": True}, token=owner_token)
print("\n13. karan restored")
s, _ = call(make_client()[0], "POST", "/auth/login",
            {"username": "karan", "password": "demo123"})
print(f"   sign in -> {s}")
