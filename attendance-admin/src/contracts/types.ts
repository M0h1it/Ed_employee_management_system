/**
 * src/contracts/types.ts  —  CORE v1
 *
 * Scope: login, dashboard, employees, attendance (today + history), tasks.
 *
 * Trimmed out of v1, to be added later without reshaping anything here:
 *   leave, holidays, corrections, daily logs, export, role management UI.
 *
 * Kept in v1 even though unused today, because retrofitting them is expensive:
 *   the Paginated envelope, the permissions array, append-only punch events,
 *   idempotency keys, and the status/flags split.
 *
 * RULE: every shape that crosses the network is declared here, once. If you
 * find yourself writing `{ id: string; name: string }` inline in a component,
 * that shape belongs in this file.
 */

import type { Permission } from './permissions';

/* ==========================================================================
 * SHARED PRIMITIVES
 * ========================================================================== */

/**
 * Branded IDs. All strings underneath, but TypeScript refuses to let you pass
 * a TaskId where an EmployeeId is expected. Catches a very common bug class.
 *
 * To create one from a plain string in fixtures: `'emp-01' as EmployeeId`.
 */
export type EmployeeId = string & { readonly __brand: 'EmployeeId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type PunchId = string & { readonly __brand: 'PunchId' };
export type DeviceId = string & { readonly __brand: 'DeviceId' };

/**
 * Dates stay as strings, deliberately. JSON has no Date type, so anything
 * arriving over the network is a string anyway. A half-parsed mix of strings
 * and Date objects is a reliable source of timezone bugs. Keep the raw string
 * here; parse at the edge with date-fns where you actually render it.
 */
export type ISODate = string; // '2026-10-24'
export type ISODateTime = string; // '2026-10-24T09:14:32+05:30'
export type TimeOfDay = string; // '09:00'

/* ==========================================================================
 * API ENVELOPE
 * ========================================================================== */

/**
 * Every list endpoint is paginated from day one.
 *
 * Forty employees fit on one page today. Two hundred will not. If the UI is
 * built assuming it receives a plain array, adding pagination later means
 * rewriting every table, every filter and every query hook. The envelope costs
 * nothing now.
 */
export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface Single<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: string; // 'VALIDATION_FAILED'
    message: string; // human readable
    fields?: Record<string, string>; // { email: 'Already in use' }
  };
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

/* ==========================================================================
 * ORGANISATION
 * ========================================================================== */

export interface Department {
  id: string;
  name: string;
}

/**
 * One company-wide shift in v1. Per-employee shifts are a later addition —
 * `Employee.shiftId` already exists so that change stays additive.
 */
export interface Shift {
  id: string;
  name: string; // 'General'
  startTime: TimeOfDay; // '09:00'
  endTime: TimeOfDay; // '18:00'
  graceMinutes: number; // 15 -> 09:15 still counts as on time
  minHours: number; // below this, the day is flagged SHORT_HOURS
}

/* ==========================================================================
 * EMPLOYEE
 * ========================================================================== */

export type EmployeeStatus = 'active' | 'inactive';

export interface Employee {
  id: EmployeeId;
  empCode: string; // 'EMP-0042' — the human-facing identifier
  name: string;
  email: string;
  phone: string;
  photoUrl: string | null;
  departmentId: string;
  departmentName: string; // denormalised, see note below
  position: string; // plain string in v1, a Position table later
  shiftId: string;
  joinDate: ISODate;
  status: EmployeeStatus;
  faceEnrolled: boolean;
  hasLogin: boolean;
  roleName: string | null; // null when hasLogin is false

  /**
   * Whether this person's hours are recorded at all.
   *
   * WHY THIS IS A FIELD AND NOT A ROLE CHECK
   * -----------------------------------------
   * The owner comes and goes as the business needs and is not on a shift, so
   * they have no check-in to show and must not appear in the register — without
   * this flag they would be marked ABSENT every single day and sit at the top
   * of the exception list forever.
   *
   * Inferring it from the role ("owners are not tracked") would break the first
   * time a working partner, a contractor or a director wants their own hours
   * kept. It is a property of the person, not of their access level.
   */
  attendanceTracked: boolean;
}

/**
 * WHY departmentName SITS NEXT TO departmentId
 * ---------------------------------------------
 * A table row needs to print "Engineering", not a UUID. If only the id came
 * back, every screen would fetch the departments list separately and join in
 * the browser — extra request, extra loading state, extra bug surface, on
 * every screen.
 *
 * The trade-off: the name is a snapshot, so a rename shows stale until
 * refetch. Fine for a display label. Never denormalise anything you compute
 * with.
 */

export interface CreateEmployeeRequest {
  name: string;
  email: string;
  phone: string;
  departmentId: string;
  position: string;
  shiftId: string;
  joinDate: ISODate;
}

export type UpdateEmployeeRequest = Partial<CreateEmployeeRequest> & {
  status?: EmployeeStatus;
};

export interface EmployeeListParams extends ListParams {
  departmentId?: string;
  status?: EmployeeStatus;
  hasLogin?: boolean;
}

/* ==========================================================================
 * ATTENDANCE — the core of v1
 * ========================================================================== */

export type PunchDirection = 'IN' | 'OUT';

/** 'kiosk' and 'pin' both arrive from the kiosk app in Phase 3 — 'pin' is the
 * offline/face-match-failed fallback path, not a separate admin action. */
export type PunchSource = 'kiosk' | 'manual' | 'pin';

/**
 * A single raw punch. APPEND-ONLY: never edited, never deleted.
 *
 * The first time someone disputes their hours, this is the evidence. If rows
 * can be edited, there is no evidence. A mistaken punch gets fixed by adding a
 * correction record on top (later phase), not by rewriting history.
 */
export interface PunchEvent {
  id: PunchId;
  employeeId: EmployeeId;
  employeeName: string;
  ts: ISODateTime;
  direction: PunchDirection;
  deviceId: DeviceId | null;
  deviceName: string | null;
  source: PunchSource;
  confidence: number | null; // 0..1 for face matches, null for manual entry
  photoRef: string | null; // frame captured at punch time
}

/** Things worth a human look. A day can carry several, or none. */
export type AttendanceFlag =
  | 'LATE_IN'
  | 'EARLY_OUT'
  | 'MISSING_OUT' // came in, never punched out
  | 'MISSING_IN' // punched out with no matching in
  | 'SHORT_HOURS'
  | 'MANUAL_ENTRY';

/** What kind of day this was. Exactly one value. */
export type AttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'WEEKEND'
  | 'NOT_YET_IN'; // today, before the person has arrived

/**
 * WHY status AND flags ARE SEPARATE FIELDS
 * -----------------------------------------
 * `status` answers "what kind of day was this" — one value, and it is what any
 * future payroll logic reads. `flags` answer "what needs a human look" — zero
 * or more, and they drive the exception list.
 *
 * Someone can be PRESENT and also LATE_IN and SHORT_HOURS. Squeezing both
 * ideas into one field forces values like 'PRESENT_BUT_LATE_AND_SHORT', which
 * does not scale past about three combinations.
 */

/**
 * One employee, one day. DERIVED from PunchEvents — never written by hand,
 * always rebuildable. If a rule changes, recompute and every past day is
 * correct again.
 */
export interface AttendanceDay {
  employeeId: EmployeeId;
  employeeName: string;
  employeePhotoUrl: string | null;
  departmentName: string;
  date: ISODate;

  firstIn: ISODateTime | null;
  lastOut: ISODateTime | null;
  workedMinutes: number;

  status: AttendanceStatus;
  flags: AttendanceFlag[];

  punchCount: number; // how many raw events rolled up into this day
}

export interface AttendanceListParams extends ListParams {
  dateFrom: ISODate;
  dateTo: ISODate;
  employeeId?: EmployeeId | 'me';
  departmentId?: string;
  status?: AttendanceStatus;
  hasFlags?: boolean; // exceptions-only filter
}

/** The live "who is inside right now" list on the dashboard. */
export interface PresentEmployee {
  employeeId: EmployeeId;
  name: string;
  photoUrl: string | null;
  departmentName: string;
  checkInAt: ISODateTime;
  minutesSinceCheckIn: number;
  isLate: boolean;
}

/** Manual punch entry from the admin UI. Phase 3 adds the kiosk equivalent. */
export interface CreatePunchRequest {
  employeeId: EmployeeId;
  direction: PunchDirection;
  ts: ISODateTime;
  source: PunchSource;
  /**
   * `${employeeId}:${date}:${direction}:${HH:mm}`
   *
   * Needed now, not later. The Phase 3 kiosk writes punches locally first and
   * drains the queue when the network returns, so the same punch can
   * legitimately arrive twice. The server rejects the duplicate on this key.
   * A 409 is SUCCESS from the client's point of view, not an error to retry.
   *
   * Adding this field after the punch table exists means backfilling keys for
   * every historical row. One line now, a migration later.
   */
  idempotencyKey: string;
}

/* ==========================================================================
 * TASKS
 * ========================================================================== */

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: TaskId;
  employeeId: EmployeeId;
  employeeName: string;
  employeePhotoUrl: string | null;
  assignedBy: UserId;
  assignedByName: string;
  title: string;
  description: string;

  /**
   * When the work is meant to begin.
   *
   * WHY A SEPARATE FIELD AND NOT createdAt
   * ---------------------------------------
   * A timeline bar needs a start and an end. createdAt is when the task was
   * written down, which is often weeks before anyone touches it — a bar drawn
   * from it would say the work has been running since the day it was thought
   * of, and every project would look permanently late.
   *
   * Null means undated: the task appears in the list but not on the timeline,
   * because a bar with no start has nowhere to sit.
   */
  startDate: ISODate | null;

  /** The deadline. Together with startDate this is the bar. */
  dueDate: ISODate | null;

  priority: TaskPriority;
  status: TaskStatus;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
  isOverdue: boolean; // computed server-side, see note
  /** True when the person created this for themselves rather than being given it. */
  selfAssigned: boolean;
}

/**
 * WHY isOverdue COMES FROM THE SERVER
 * ------------------------------------
 * Computed in the browser it depends on the device clock, which can be wrong
 * or in another timezone — two people would see different states for the same
 * task. Anything that is a fact about the data rather than about the viewer
 * belongs on the server.
 */

export interface CreateTaskRequest {
  employeeId: EmployeeId;
  title: string;
  description: string;
  /** When the work should begin. Null means it does not appear on the timeline. */
  startDate: ISODate | null;
  dueDate: ISODate | null;
  priority: TaskPriority;
  /** Set when someone adds a task to their own list. */
  selfAssigned?: boolean;
}

export type UpdateTaskRequest = Partial<CreateTaskRequest> & {
  status?: TaskStatus;
};

export interface TaskListParams extends ListParams {
  employeeId?: EmployeeId | 'me';
  status?: TaskStatus;
  priority?: TaskPriority;
  dueFrom?: ISODate;
  dueTo?: ISODate;
}

/* ==========================================================================
 * AUTH
 * ========================================================================== */

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: CurrentUser;
}

/**
 * WHY permissions IS A FLAT ARRAY AND NOT A ROLE NAME
 * ---------------------------------------------------
 * v1 has only two roles, so `role: 'owner' | 'employee'` would work today.
 * It would also spread `if (user.role === 'owner')` across forty components,
 * and every one of them would need finding and changing the day a third role
 * appears.
 *
 * A resolved permission array costs one extra line now. Components ask
 * `can('attendance.view_all')` — a question about capability, not identity —
 * and that question keeps working no matter how many roles exist later.
 *
 * The server resolves roles into permissions because it must do that
 * resolution anyway for enforcement. Doing it once avoids two implementations
 * that can disagree.
 */
export interface CurrentUser {
  id: UserId;
  employeeId: EmployeeId;
  name: string;
  email: string;
  username: string;
  photoUrl: string | null;
  departmentName: string;
  position: string;
  roleName: string; // display only — never branch on this
  permissions: Permission[]; // branch on this
  mustChangePassword: boolean; // force a password change before anything else
  /** Whether to show this person their own check-in card. */
  attendanceTracked: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/* ==========================================================================
 * DASHBOARD
 * ========================================================================== */

/**
 * THREE SEPARATE COUNTERS, NOT ONE
 * ---------------------------------
 * `checkedInToday` counts arrivals and only goes up during the day.
 * `currentlyPresent` counts people inside right now and moves both ways.
 * `checkedOut` counts departures.
 *
 * Decrementing a single counter on check-out destroys the arrival record by
 * end of day — and the arrival record is exactly what any late-arrival report
 * or future payroll export needs.
 */
export interface DashboardStats {
  date: ISODate;
  totalEmployees: number;
  checkedInToday: number;
  currentlyPresent: number;
  checkedOut: number;
  lateCount: number;
  absentCount: number;
  tasksOpen: number;
  tasksCompletedToday: number;
}

/** A row in the dashboard's exceptions panel. */
export interface AttendanceException {
  employeeId: EmployeeId;
  employeeName: string;
  photoUrl: string | null;
  flag: AttendanceFlag | 'ABSENT';
  expectedAt: ISODateTime | null;
  actualAt: ISODateTime | null;
  delayMinutes: number | null;
}

/** The employee's own dashboard card: am I in, and since when. */
export interface MyAttendanceToday {
  status: AttendanceStatus;
  checkInAt: ISODateTime | null;
  checkOutAt: ISODateTime | null;
  workedMinutes: number;
  shiftStart: TimeOfDay;
  shiftEnd: TimeOfDay;
  isLate: boolean;
}

/* ==========================================================================
 * ROLES & USERS
 * ========================================================================== */

export type RoleId = string & { readonly __brand: 'RoleId' };

export interface Role {
  id: RoleId;
  name: string;
  description: string;
  isSystem: boolean; // system roles cannot be deleted or renamed
  permissions: Permission[];
  userCount: number; // how many logins currently use this role
}

export interface CreateRoleRequest {
  name: string;
  description: string;
  permissions: Permission[];
}

export type UpdateRoleRequest = Partial<CreateRoleRequest>;

/**
 * A login account. Deliberately separate from Employee.
 *
 * WHY TWO SEPARATE THINGS: not every employee needs a login — someone may only
 * ever be punched in at the kiosk. And a login must be disableable without
 * removing the person from the directory or destroying their attendance
 * history. Merging them would force a "has no password" state onto Employee
 * and make revoking access destructive.
 */
export interface User {
  id: UserId;
  employeeId: EmployeeId;
  employeeName: string;
  employeePhotoUrl: string | null;
  username: string;
  roleId: RoleId;
  roleName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  /** Whether a kiosk PIN has ever been generated for this account — never
   * the PIN itself. Used only to show a "PIN set" indicator in
   * PinGenerator.tsx. */
  hasPinSet: boolean;
  lastLoginAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface CreateUserRequest {
  employeeId: EmployeeId;
  username: string;
  temporaryPassword: string;
  roleId: RoleId;
  mustChangePassword: boolean;
}

/** Admin resetting somebody else's password — no current password required. */
export interface ResetPasswordRequest {
  newPassword: string;
  mustChangePassword: boolean;
}

export interface UserListParams extends ListParams {
  roleId?: RoleId;
  isActive?: boolean;
}

/* ==========================================================================
 * KIOSK DEVICES
 * ========================================================================== */

export interface Device {
  id: string;
  name: string;
  location: string;
  isActive: boolean;
  createdAt: ISODateTime;
  lastSeenAt: ISODateTime | null;
  revokedAt: ISODateTime | null;
}

/** Returned once, at registration OR reactivation — the plain-text code is
 * never retrievable again after this response. */
export interface DeviceCreated {
  device: Device;
  deviceCode: string;
}

export interface CreateDeviceRequest {
  name: string;
  location?: string;
}

export interface DeviceHistoryEntry {
  action: string;
  at: ISODateTime;
  actorName: string | null;
}

/* ==========================================================================
 * SETTINGS
 * ========================================================================== */

/** Company-wide attendance policy. Drives every rollup rule. */
export interface OrgSettings {
  shiftStart: TimeOfDay;
  shiftEnd: TimeOfDay;
  graceMinutes: number;
  minHours: number;
  companyName: string;
}

/** What can actually be sent to PATCH /settings — a Partial<OrgSettings>
 * would also allow sending companyName, which this endpoint has no field
 * for at all (see settings.py's _shift_out, which hardcodes it). */
export interface OrgSettingsUpdate {
  shiftStart?: TimeOfDay;
  shiftEnd?: TimeOfDay;
  graceMinutes?: number;
  minHours?: number;
  /** The date this policy takes effect. Omitted means "today" — see
   * settings.py's update_settings for why this is what makes a policy
   * change stop being retroactive for days before it. */
  effectiveFrom?: ISODate;
}

/** One saved policy version — a row from GET /settings/history. */
export interface ShiftPolicyVersion {
  id: string;
  shiftStart: TimeOfDay;
  shiftEnd: TimeOfDay;
  graceMinutes: number;
  minHours: number;
  effectiveFrom: ISODate;
  createdAt: ISODateTime;
}

/** The fields a person may change about themselves. */
export interface UpdateProfileRequest {
  phone?: string;
  email?: string;
}

/** Moving someone to a different role. */
export interface ChangeRoleRequest {
  roleId: RoleId;
}

/* ==========================================================================
 * ATTENDANCE TREND
 * ========================================================================== */

export type TrendGranularity = 'day' | 'week' | 'month';

/**
 * One bar on the owner's trend chart: how many people were present, late or
 * absent in that bucket.
 *
 * AGGREGATED ON THE SERVER, NOT IN THE BROWSER
 * ---------------------------------------------
 * Six months at day-level for forty people is roughly five thousand rows. The
 * browser does not need them; it needs about twenty numbers. Shipping the raw
 * rows so the client can count them wastes the bandwidth and gets slower every
 * month the company operates.
 */
export interface AttendanceTrendPoint {
  bucket: ISODate; // first day of the bucket
  label: string; // '14 Sep', 'W38', 'Sep'
  present: number; // on time
  late: number;
  absent: number;
  /** Working days in the bucket, so a short week is not read as a bad week. */
  workingDays: number;
  trackedEmployees: number;
}

/* ==========================================================================
 * TASK TIMELINE
 * ========================================================================== */

/**
 * One person's row on the timeline, with every dated task they hold.
 *
 * GROUPED BY PERSON, NOT A FLAT LIST OF BARS
 * -------------------------------------------
 * The question an owner is asking is "who is loaded and who is free", and that
 * is only answerable when one person's work sits on one line. A flat list
 * sorted by date answers "what is due soon" instead — which the table below
 * the chart already does, better.
 */
export interface TimelineRow {
  employeeId: EmployeeId;
  employeeName: string;
  employeePhotoUrl: string | null;
  departmentName: string;
  bars: TimelineBar[];
}

export interface TimelineBar {
  taskId: TaskId;
  title: string;
  startDate: ISODate;
  endDate: ISODate;
  status: TaskStatus;
  priority: TaskPriority;
  isOverdue: boolean;
}

export type TimelineRange = '2w' | '1m' | '3m';

export interface TimelineParams {
  range: TimelineRange;
  employeeId?: EmployeeId | 'me';
  status?: TaskStatus;
}

/* ==========================================================================
 * AUDIT LOG
 * ========================================================================== */

export interface AuditEntry {
  id: string;
  actorUserId: UserId | null;
  /** "Removed account" when the actor no longer exists — rows outlive accounts. */
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  /** Only the fields that changed. Secrets arrive as "[redacted]". */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: ISODateTime;
}

export interface AuditListParams extends ListParams {
  action?: string;
  entity?: string;
  actorUserId?: UserId;
  dateFrom?: ISODate;
  dateTo?: ISODate;
}

/* ==========================================================================
 * LEAVE AND HOLIDAYS
 * ========================================================================== */

export type LeaveType = 'casual' | 'sick' | 'earned' | 'unpaid' | 'comp_off' | 'planned' | 'unplanned' | 'emergency';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Leave {
  id: string;
  employeeId: EmployeeId;
  employeeName: string;
  employeePhotoUrl: string | null;
  departmentName: string;
  fromDate: ISODate;
  toDate: ISODate;
  /** Working days only — weekends and company holidays are not charged. */
  days: number;
  type: LeaveType;
  reason: string;
  status: LeaveStatus;
  approvedBy: UserId | null;
  approvedByName: string | null;
  approvedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface CreateLeaveRequest {
  /** Omitted means "for myself". */
  employeeId?: EmployeeId;
  fromDate: ISODate;
  toDate: ISODate;
  type: LeaveType;
  reason: string;
}

export interface LeaveListParams extends ListParams {
  employeeId?: EmployeeId | 'me';
  status?: LeaveStatus;
  dateFrom?: ISODate;
  dateTo?: ISODate;
}

export interface Holiday {
  id: string;
  date: ISODate;
  name: string;
}

/* ==========================================================================
 * CORRECTIONS
 * ========================================================================== */

export type CorrectionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Correction {
  id: string;
  employeeId: EmployeeId;
  employeeName: string;
  employeePhotoUrl: string | null;
  date: ISODate;
  reason: string;
  proposedIn: ISODateTime | null;
  proposedOut: ISODateTime | null;
  /** What the register says right now, so the change is visible, not just the ask. */
  currentIn: ISODateTime | null;
  currentOut: ISODateTime | null;
  status: CorrectionStatus;
  requestedBy: UserId | null;
  requestedByName: string;
  approvedBy: UserId | null;
  approvedByName: string | null;
  approvedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface CreateCorrectionRequest {
  employeeId?: EmployeeId;
  date: ISODate;
  reason: string;
  proposedIn?: ISODateTime | null;
  proposedOut?: ISODateTime | null;
}