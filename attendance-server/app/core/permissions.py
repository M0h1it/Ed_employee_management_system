"""
app/core/permissions.py

The permission catalogue — the exact same list as the frontend's
contracts/permissions.ts, and the source the seed script writes into the
database.

A permission is a gate written into the application, in two places: the screen
that hides a control, and the endpoint that refuses the request. One inserted at
runtime would be consulted by nothing — a checkbox that appears to lock
something down while locking down nothing, which is worse than no checkbox.

So this list lives in code. New permissions arrive with new features, because
the feature is what enforces them.
"""

from typing import NamedTuple


class PermissionDef(NamedTuple):
    code: str
    module: str
    label: str
    description: str


PERMISSIONS: list[PermissionDef] = [
    # --- Employees ---------------------------------------------------------
    PermissionDef("employees.view_all", "Employees", "View all",
                  "See the whole company directory, with contact details, department and login status."),
    PermissionDef("employees.view_own", "Employees", "View own",
                  "See only their own employee record. Everyone needs this to open their profile."),
    PermissionDef("employees.create", "Employees", "Create",
                  "Add a new person to the directory."),
    PermissionDef("employees.edit", "Employees", "Edit",
                  "Change anyone's details, or mark them inactive."),

    # --- Attendance --------------------------------------------------------
    PermissionDef("attendance.view_all", "Attendance", "View all",
                  "See every employee's check-in and check-out records and the exception list."),
    PermissionDef("attendance.view_own", "Attendance", "View own",
                  "See only their own attendance history."),
    PermissionDef("attendance.punch_manual", "Attendance", "Manual punch",
                  "Record a punch by hand when the kiosk missed someone. Entries stay marked as manual."),

    # --- Tasks -------------------------------------------------------------
    PermissionDef("tasks.view_all", "Tasks", "View all",
                  "See tasks assigned to everyone."),
    PermissionDef("tasks.view_own", "Tasks", "View own",
                  "See only tasks assigned to themselves."),
    PermissionDef("tasks.assign", "Tasks", "Assign",
                  "Create a task for somebody else."),
    PermissionDef("tasks.create_own", "Tasks", "Add own",
                  "Add a task to their own list."),
    PermissionDef("tasks.edit", "Tasks", "Edit",
                  "Change a task's title, description, due date or priority."),
    PermissionDef("tasks.complete_own", "Tasks", "Complete own",
                  "Tick off a task assigned to them."),

    # --- Administration ----------------------------------------------------
    PermissionDef("roles.manage", "Administration", "Manage roles",
                  "Create roles and change what every role can do. At least one role in use must keep it."),
    PermissionDef("users.manage", "Administration", "Manage users",
                  "Create login accounts, reset passwords, enable or disable access."),
    PermissionDef("users.change_role", "Administration", "Change role",
                  "Move someone to a different role, limited to roles no more powerful than your own."),
    # --- Leave -------------------------------------------------------------
    PermissionDef("leave.view_all", "Leave", "View all",
                  "See every employee's leave requests and their status."),
    PermissionDef("leave.view_own", "Leave", "View own",
                  "See only their own leave requests."),
    PermissionDef("leave.apply", "Leave", "Apply",
                  "Request leave for themselves."),
    PermissionDef("leave.approve", "Leave", "Approve",
                  "Approve or reject somebody else's leave. Nobody can approve their own, "
                  "whatever permissions they hold."),
    PermissionDef("holidays.manage", "Leave", "Manage holidays",
                  "Add and remove company holidays. A holiday stops a company-wide "
                  "zero-punch day from being reported as everybody being absent."),

    # --- Corrections -------------------------------------------------------
    PermissionDef("corrections.request", "Attendance", "Request a correction",
                  "Ask for a mistaken or missing punch to be fixed. The original "
                  "record is never altered — a correction is layered on top."),
    PermissionDef("corrections.view_all", "Attendance", "View all corrections",
                  "See correction requests from everyone."),
    PermissionDef("corrections.approve", "Attendance", "Approve corrections",
                  "Approve or reject a correction. Nobody can approve their own."),

    PermissionDef("settings.manage", "Administration", "Manage settings",
                  "Change shift times, the grace period, the minimum hours in a day, "
                  "and create departments."),
    PermissionDef("audit.view", "Administration", "View audit log",
                  "See who changed what and what it looked like before. Read-only — "
                  "the log itself cannot be edited or deleted through the system."),

    # --- Kiosk (Phase 3) -----------------------------------------------------
    PermissionDef("devices.manage", "Kiosk", "Manage kiosk devices",
                  "Register a new kiosk tablet, see the one-time device code, and revoke a "
                  "device that has left the building."),
    PermissionDef("face.enrol", "Kiosk", "Enrol face templates",
                  "Upload an employee's enrolment photo for the kiosk to recognise them. "
                  "Separate from employees.edit because it is biometric data with its own "
                  "consent requirement, not a profile detail."),
    PermissionDef("pin.generate", "Kiosk", "Generate kiosk PIN",
                  "Generate or regenerate an employee's kiosk PIN. Shown once, never stored "
                  "or logged in plain."),
]

ALL_CODES: set[str] = {p.code for p in PERMISSIONS}

# Seeded roles. Everything else is created through the API.
SEED_ROLES: dict[str, dict] = {
    "Owner": {
        "description": "Full access to everything, including roles and user accounts",
        "is_system": True,
        "permissions": sorted(ALL_CODES),
    },
    "Manager": {
        "description": "Sees the whole team and assigns work, but cannot manage access",
        "is_system": False,
        "permissions": [
            "employees.view_all", "employees.view_own",
            "attendance.view_all", "attendance.view_own",
            "tasks.view_all", "tasks.view_own", "tasks.assign",
            "tasks.create_own", "tasks.edit", "tasks.complete_own",
            "users.change_role",
            "leave.view_all", "leave.view_own", "leave.apply", "leave.approve",
            "corrections.request", "corrections.view_all", "corrections.approve",
            "face.enrol", "pin.generate",
        ],
    },
    "Employee": {
        "description": "Own record, own attendance, own tasks",
        "is_system": True,
        "permissions": [
            "employees.view_own",
            "attendance.view_own",
            "tasks.view_own", "tasks.create_own", "tasks.complete_own",
            "leave.view_own", "leave.apply",
            "corrections.request",
        ],
    },
}