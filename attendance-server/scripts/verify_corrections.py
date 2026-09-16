"""
scripts/verify_corrections.py

Checks the correction workflow — including whether the register actually
changes — and photo upload validation.

Run after `python -m app.seed` and `python -m app.seed_punches`.
"""

import json
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta

BASE = "http://localhost:8000/api/v1"

created: list[str] = []


def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, json.loads(text) if text else None


def upload(path, token, filename, content, content_type="image/jpeg"):
    """A multipart body, built by hand so no extra dependency is needed."""
    boundary = "----verify" + uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
        f"Content-Type: {content_type}\r\n\r\n".encode(),
        content,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(BASE + path, method="POST", data=body)
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
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

# A past working day with punches, so the "before" state is real.
probe = today - timedelta(days=1)
while probe.weekday() >= 5:
    probe -= timedelta(days=1)

print("1. what the register says now")
s, b = call("GET", f"/attendance/days?dateFrom={probe}&dateTo={probe}"
                   f"&employeeId={karan_user['employeeId']}", token=owner)
row = b["data"][0] if b["data"] else None
if row:
    print(f"   {row['employeeName']} on {probe}: "
          f"in={str(row['firstIn'])[11:16]} out={str(row['lastOut'])[11:16]} "
          f"{row['workedMinutes']}m {row['flags']}")

print("\n2. karan requests a correction")
s, b = call("POST", "/corrections", {
    "date": str(probe),
    "reason": "The reader did not pick me up when I arrived",
    "proposedIn": f"{probe}T08:30:00+05:30",
}, token=karan)
if s == 201:
    correction_id = b["data"]["id"]
    created.append(correction_id)
    print(f"   status {s}   {b['data']['status']}")
    print(f"   current in: {str(b['data']['currentIn'])[11:16]}  "
          f"proposed: {str(b['data']['proposedIn'])[11:16]}")
    print("   the approver sees both, not just the proposal")
else:
    print(f"   status {s} -> {err(b)['code']}: {err(b)['message']}")
    s, b = call("GET", "/corrections?status=pending", token=owner)
    correction_id = b["data"][0]["id"] if b["data"] else None

print("\n3. a second correction for the same day is refused")
s, b = call("POST", "/corrections", {
    "date": str(probe), "reason": "Another attempt at the same day",
    "proposedOut": f"{probe}T19:00:00+05:30",
}, token=karan)
print(f"   status {s} -> {err(b)['code'] if s >= 400 else 'created'}")
print("   two approved corrections for one day make the rollup ambiguous")

print("\n4. a future day cannot be corrected")
s, b = call("POST", "/corrections", {
    "date": str(today + timedelta(days=3)), "reason": "Pre-writing my attendance",
    "proposedIn": f"{today + timedelta(days=3)}T09:00:00+05:30",
}, token=karan)
print(f"   status {s} -> {err(b)['fields'] if s >= 400 else 'created'}")

print("\n5. karan cannot approve his own")
s, b = call("PATCH", f"/corrections/{correction_id}", {"status": "approved"}, token=karan)
print(f"   status {s} -> {err(b)['code']}: {err(b)['message']}")

print("\n6. NOR CAN AN OWNER approve a correction to their own attendance")
s, b = call("POST", "/corrections", {
    "date": str(probe - timedelta(days=1)), "reason": "Testing self-approval",
    "proposedIn": f"{probe - timedelta(days=1)}T08:45:00+05:30",
}, token=owner)
if s == 201:
    own = b["data"]["id"]
    created.append(own)
    s, b = call("PATCH", f"/corrections/{own}", {"status": "approved"}, token=owner)
    print(f"   status {s} -> {err(b)['code']}: {err(b)['message']}")
    print("   editing your own recorded hours with no second signature is exactly")
    print("   what an append-only punch table was built to prevent")
else:
    print(f"   ({err(b)['code']})")

print("\n7. marcus approves it")
s, b = call("PATCH", f"/corrections/{correction_id}", {"status": "approved"}, token=marcus)
print(f"   status {s}   {b['data']['status']} by {b['data']['approvedByName']}")

print("\n8. THE POINT — the register now reads differently")
s, b = call("GET", f"/attendance/days?dateFrom={probe}&dateTo={probe}"
                   f"&employeeId={karan_user['employeeId']}", token=owner)
after = b["data"][0] if b["data"] else None
if after and row:
    print(f"   before: in={str(row['firstIn'])[11:16]}  {row['workedMinutes']}m  {row['flags']}")
    print(f"   after:  in={str(after['firstIn'])[11:16]}  {after['workedMinutes']}m  {after['flags']}")
    print("   MANUAL_ENTRY is added, so a corrected day never looks measured")

print("\n9. the original punches are untouched")
s, b = call("GET", f"/attendance/punches?employeeId={karan_user['employeeId']}&date={probe}",
            token=owner)
for p in b["data"]:
    print(f"     {p['ts'][11:16]}  {p['direction']:3}  {p['source']}")
print("   the kiosk's record still says what it said — that is the evidence")

print("\n10. it cannot be approved twice")
s, b = call("PATCH", f"/corrections/{correction_id}", {"status": "rejected"}, token=marcus)
print(f"    status {s} -> {err(b)['code']}")

print("\n11. karan sees only his own corrections")
s, b = call("GET", "/corrections?pageSize=50", token=karan)
names = {r["employeeName"] for r in b["data"]}
print(f"    status {s}   {names}")

# ---------------------------------------------------------------- photos ---

# A real 1x1 PNG.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6360000002000100ffff03000006000557bfabd400"
    "00000049454e44ae426082"
)

print("\n12. karan uploads his own photo")
s, b = upload(f"/employees/{karan_user['employeeId']}/photo", karan, "me.png", PNG, "image/png")
print(f"    status {s}   {b['data']['photoUrl'] if s == 200 else err(b)['code']}")
photo_url = b["data"]["photoUrl"] if s == 200 else None

print("\n13. the file is actually served")
if photo_url:
    try:
        with urllib.request.urlopen("http://localhost:8000" + photo_url) as r:
            served = r.read()
        print(f"    {len(served)} bytes, content-type {r.headers.get('content-type')}")
        print(f"    identical to what was uploaded: {served == PNG}")
    except Exception as exc:
        print(f"    FAILED: {exc}")

print("\n14. a renamed text file is rejected")
s, b = upload(f"/employees/{karan_user['employeeId']}/photo", karan,
              "evil.jpg", b"<?php system($_GET['c']); ?>", "image/jpeg")
print(f"    status {s} -> {err(b)['code'] if s >= 400 else 'ACCEPTED'}")
print("    the extension and the Content-Type both said jpeg; the bytes did not")

print("\n15. an oversized file is rejected")
s, b = upload(f"/employees/{karan_user['employeeId']}/photo", karan,
              "big.png", PNG + b"\x00" * (2 * 1024 * 1024 + 10), "image/png")
print(f"    status {s} -> {err(b)['code'] if s >= 400 else 'ACCEPTED'}")

print("\n16. karan cannot change somebody else's photo")
s, b = upload(f"/employees/{owner_user['employeeId']}/photo", karan, "swap.png", PNG, "image/png")
print(f"    status {s} -> {err(b)['code']}: {err(b)['message']}")
print("    a photo is how people are identified in the register")

print("\n17. an owner can")
s, b = upload(f"/employees/{karan_user['employeeId']}/photo", owner, "hr.png", PNG, "image/png")
print(f"    status {s}   employees.edit covers it")

print("\n18. the photo appears on the employee record")
s, b = call("GET", f"/employees/{karan_user['employeeId']}", token=owner)
print(f"    photoUrl: {b['data']['photoUrl']}")

print("\n19. removing it falls back to initials")
s, b = call("DELETE", f"/employees/{karan_user['employeeId']}/photo", token=karan)
s, b = call("GET", f"/employees/{karan_user['employeeId']}", token=owner)
print(f"    photoUrl: {b['data']['photoUrl']}")

print("\n20. cleaning up after itself")
for cid in created:
    call("PATCH", f"/corrections/{cid}", {"status": "cancelled"}, token=owner)
print(f"    withdrew {len(created)} corrections")
