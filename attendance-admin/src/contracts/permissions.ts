/**
 * src/contracts/permissions.ts
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Permission codes are strings. In plain JavaScript a typo like
 * 'attendance.viewall' (missing underscore) compiles fine, returns false at
 * runtime, and silently shows the wrong UI to the wrong person. You find that
 * bug months later, in production.
 *
 * Declaring every valid code as a union type turns that typo into a red
 * squiggle in your editor, before you save the file.
 *
 * RULE: never write a permission string inline anywhere else. Import from here.
 */

export const PERMISSIONS = [
  // --- Employees ---------------------------------------------------------
  'employees.view_all',
  'employees.view_own',
  'employees.create',
  'employees.edit',

  // --- Attendance --------------------------------------------------------
  'attendance.view_all',
  'attendance.view_own',
  'attendance.punch_manual',

  // --- Tasks -------------------------------------------------------------
  'tasks.view_all',
  'tasks.view_own',
  'tasks.assign',
  'tasks.create_own',
  'tasks.edit',
  'tasks.complete_own',

  // --- Administration ----------------------------------------------------
  'roles.manage', // create roles, edit their permission sets
  'users.manage', // create logins, reset passwords, disable accounts
  'users.change_role', // move someone to a different role
  'leave.view_all',
  'leave.view_own',
  'leave.apply',
  'leave.approve',
  'holidays.manage',

  'corrections.request',
  'corrections.view_all',
  'corrections.approve',

  'settings.manage',
  'audit.view',

  // --- Kiosk (Phase 3) -----------------------------------------------------
  'devices.manage',
  'face.enrol',
  'pin.generate',
] as const;

/**
 * `as const` above freezes the array into readonly string literals. Without it
 * TypeScript widens the type to plain string[] and the entire safety benefit
 * disappears.
 *
 * This line turns the array into a union type:
 *   'employees.view_all' | 'employees.view_own' | ...
 */
export type Permission = (typeof PERMISSIONS)[number];

/**
 * WHY view_all AND view_own ARE SEPARATE PERMISSIONS
 * ---------------------------------------------------
 * The owner sees everyone's attendance; an employee sees only their own. With
 * a single 'attendance.view' permission you could not express that difference
 * and would end up hard-coding role names in the query layer — which breaks
 * the moment a custom role exists.
 *
 * With the split the scope comes from the permission alone:
 *   view_all -> no filter
 *   view_own -> filter to the logged-in person
 *
 * A 'view_team' variant slots in later without touching anything already
 * written.
 */

/** Grouping used to render the roles matrix screen. */
export const PERMISSION_MODULES = {
  Employees: PERMISSIONS.filter((p) => p.startsWith('employees.')),
  Attendance: PERMISSIONS.filter((p) => p.startsWith('attendance.')),
  Tasks: PERMISSIONS.filter((p) => p.startsWith('tasks.')),
  Administration: PERMISSIONS.filter(
    (p) =>
      p.startsWith('roles.') ||
      p.startsWith('users.') ||
      p.startsWith('settings.'),
  ),
  Kiosk: PERMISSIONS.filter(
    (p) => p.startsWith('devices.') || p.startsWith('face.') || p.startsWith('pin.'),
  ),
} satisfies Record<string, readonly Permission[]>;

/** Short column labels for the matrix header. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'employees.view_all': 'View all',
  'employees.view_own': 'View own',
  'employees.create': 'Create',
  'employees.edit': 'Edit',

  'attendance.view_all': 'View all',
  'attendance.view_own': 'View own',
  'attendance.punch_manual': 'Manual punch',

  'tasks.view_all': 'View all',
  'tasks.view_own': 'View own',
  'tasks.assign': 'Assign',
  'tasks.create_own': 'Add own',
  'tasks.edit': 'Edit',
  'tasks.complete_own': 'Complete own',

  'roles.manage': 'Manage roles',
  'users.manage': 'Manage users',
  'users.change_role': 'Change role',
  'leave.view_all': 'View all',
  'leave.view_own': 'View own',
  'leave.apply': 'Apply',
  'leave.approve': 'Approve',
  'holidays.manage': 'Manage holidays',
  'corrections.request': 'Request a correction',
  'corrections.view_all': 'View all corrections',
  'corrections.approve': 'Approve corrections',
  'settings.manage': 'Manage settings',
  'audit.view': 'View audit log',

  'devices.manage': 'Manage kiosk devices',
  'face.enrol': 'Enrol face templates',
  'pin.generate': 'Generate kiosk PIN',
};

/**
 * Plain-English meaning of every permission, shown in the roles matrix so an
 * owner is never guessing what a checkbox does.
 *
 * WHY PERMISSIONS CANNOT BE CREATED FROM THE UI
 * ----------------------------------------------
 * A permission is not data — it is a gate written into the code, in two places:
 * the screen that hides a control, and the API endpoint that refuses the
 * request. Inventing a new code here would produce a checkbox that no code
 * consults: it would appear to lock something down while locking down nothing,
 * which is worse than having no checkbox at all.
 *
 * New permissions arrive with new features, because the feature is what
 * enforces them. What IS freely creatable is a ROLE — any combination of the
 * permissions below, named however you like.
 */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'employees.view_all':
    'See the whole company directory, with everyone\u2019s contact details, department and login status.',
  'employees.view_own':
    'See only their own employee record. Everyone needs this to open their profile.',
  'employees.create': 'Add a new person to the directory.',
  'employees.edit':
    'Change anyone\u2019s details \u2014 name, contact, department, position, or mark them inactive.',

  'attendance.view_all':
    'See every employee\u2019s check-in and check-out records, and the exception list. This is what turns the dashboard into the company-wide view.',
  'attendance.view_own':
    'See only their own attendance history. Everyone needs this to check their own hours.',
  'attendance.punch_manual':
    'Record a check-in or check-out by hand, for when the kiosk misses someone. Entries are marked as manual and stay visible as such.',

  'tasks.view_all': 'See tasks assigned to everyone, and filter the board by person.',
  'tasks.view_own': 'See only tasks assigned to themselves.',
  'tasks.assign': 'Create a task for somebody else and set its due date and priority.',
  'tasks.create_own':
    'Add a task to their own list. Useful when people plan their own day rather than waiting to be assigned work.',
  'tasks.edit': 'Change a task\u2019s title, description, due date or priority after it was created.',
  'tasks.complete_own': 'Tick off a task assigned to them.',

  'roles.manage':
    'Create roles and change what every role can do \u2014 including this screen. At least one role in use must always keep it.',
  'users.manage':
    'Create login accounts, reset passwords, and enable or disable someone\u2019s access.',
  'users.change_role':
    'Move someone to a different role. You can only assign roles that are no more powerful than your own, and you cannot change your own role \u2014 otherwise anyone with this could promote themselves.',
  'settings.manage':
    'Change company policy: shift times, the grace period before someone counts as late, the minimum hours in a day, and create departments.',
  'leave.view_all': "See every employee's leave requests and their status.",
  'leave.view_own': 'See only their own leave requests.',
  'leave.apply': 'Request leave for themselves.',
  'leave.approve':
    'Approve or reject somebody else\u2019s leave. Nobody can approve their own, whatever permissions they hold.',
  'holidays.manage':
    'Add and remove company holidays. A holiday stops a company-wide zero-punch day from being reported as everybody being absent.',
  'corrections.request':
    'Ask for a mistaken or missing punch to be fixed. The original record is never altered \u2014 a correction is layered on top.',
  'corrections.view_all': 'See correction requests from everyone.',
  'corrections.approve':
    'Approve or reject a correction. Nobody can approve a correction to their own attendance.',
  'audit.view':
    'See who changed what and what it looked like before. Read-only \u2014 the log cannot be edited or deleted through the system, which is what makes it evidence.',

  'devices.manage':
    'Register a new kiosk tablet, see the one-time device code, and revoke a device that has left the building.',
  'face.enrol':
    'Upload an employee\u2019s enrolment photo for the kiosk to recognise them. Separate from employees.edit because it is biometric data with its own consent requirement, not a profile detail.',
  'pin.generate':
    'Generate or regenerate an employee\u2019s kiosk PIN. Shown once, never stored or logged in plain.',
};