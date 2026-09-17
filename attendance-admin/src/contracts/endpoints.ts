/**
 * src/contracts/endpoints.ts
 *
 * Every API URL in the application, in one place.
 *
 * WHY: inline URL strings get typo'd, and a typo'd URL fails at runtime with a
 * confusing 404 rather than at compile time. They also get duplicated, so
 * changing a path means grepping the whole codebase.
 *
 * The MSW mock handlers register against these same constants, which means a
 * mock and its real endpoint can never drift apart.
 */

export const API_BASE = '/api/v1';

export const EP = {
  auth: {
    login: `${API_BASE}/auth/login`,
    logout: `${API_BASE}/auth/logout`,
    me: `${API_BASE}/me`,
    profile: `${API_BASE}/me/profile`,
    changePassword: `${API_BASE}/me/password`,
  },

  dashboard: {
    stats: `${API_BASE}/dashboard/stats`,
    exceptions: `${API_BASE}/dashboard/exceptions`,
    myToday: `${API_BASE}/dashboard/my-today`,
    trend: `${API_BASE}/dashboard/trend`,
  },

  employees: {
    list: `${API_BASE}/employees`,
    detail: (id: string) => `${API_BASE}/employees/${id}`,
  },

  attendance: {
    days: `${API_BASE}/attendance/days`,
    present: `${API_BASE}/attendance/present`,
    punches: `${API_BASE}/attendance/punches`,
  },

  tasks: {
    list: `${API_BASE}/tasks`,
    detail: (id: string) => `${API_BASE}/tasks/${id}`,
    complete: (id: string) => `${API_BASE}/tasks/${id}/complete`,
    timeline: `${API_BASE}/tasks/timeline`,
  },

  roles: {
    list: `${API_BASE}/roles`,
    detail: (id: string) => `${API_BASE}/roles/${id}`,
  },

  permissions: {
    catalogue: `${API_BASE}/permissions`,
  },

  users: {
    list: `${API_BASE}/users`,
    detail: (id: string) => `${API_BASE}/users/${id}`,
    password: (id: string) => `${API_BASE}/users/${id}/password`,
    status: (id: string) => `${API_BASE}/users/${id}/status`,
    role: (id: string) => `${API_BASE}/users/${id}/role`,
    pin: (id: string) => `${API_BASE}/users/${id}/pin`,
    byEmployee: (employeeId: string) => `${API_BASE}/users?employeeId=${employeeId}`,
  },

  leave: {
    list: `${API_BASE}/leaves`,
    create: `${API_BASE}/leaves`,
    decide: (id: string) => `${API_BASE}/leaves/${id}`,
  },

  holidays: {
    list: `${API_BASE}/holidays`,
    create: `${API_BASE}/holidays`,
    remove: (id: string) => `${API_BASE}/holidays/${id}`,
  },

  corrections: {
    list: `${API_BASE}/corrections`,
    create: `${API_BASE}/corrections`,
    decide: (id: string) => `${API_BASE}/corrections/${id}`,
  },

  photos: {
    upload: (employeeId: string) => `${API_BASE}/employees/${employeeId}/photo`,
    remove: (employeeId: string) => `${API_BASE}/employees/${employeeId}/photo`,
  },

  face: {
    enrol: (employeeId: string) => `${API_BASE}/employees/${employeeId}/face`,
  },

  devices: {
    list: `${API_BASE}/devices`,
    create: `${API_BASE}/devices`,
    revoke: (deviceId: string) => `${API_BASE}/devices/${deviceId}/revoke`,
    reactivate: (deviceId: string) => `${API_BASE}/devices/${deviceId}/reactivate`,
    history: (deviceId: string) => `${API_BASE}/devices/${deviceId}/history`,
  },

  audit: {
    list: `${API_BASE}/audit`,
    actions: `${API_BASE}/audit/actions`,
  },

  org: {
    exportAttendance: `${API_BASE}/attendance/export`,
    departments: `${API_BASE}/departments`,
    shifts: `${API_BASE}/shifts`,
    settings: `${API_BASE}/settings`,
    settingsHistory: `${API_BASE}/settings/history`,
  },
} as const;

/**
 * MSW registers handlers with patterns, not concrete URLs, so paths with an
 * :id segment are listed here in pattern form.
 */
export const EP_PATTERNS = {
  employeeDetail: `${API_BASE}/employees/:id`,
  taskDetail: `${API_BASE}/tasks/:id`,
  taskComplete: `${API_BASE}/tasks/:id/complete`,
  roleDetail: `${API_BASE}/roles/:id`,
  userDetail: `${API_BASE}/users/:id`,
  userPassword: `${API_BASE}/users/:id/password`,
  userStatus: `${API_BASE}/users/:id/status`,
  userRole: `${API_BASE}/users/:id/role`,
} as const;