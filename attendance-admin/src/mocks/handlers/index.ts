/**
 * src/mocks/handlers/index.ts
 *
 * Every handler the mock server knows about. Each new feature adds its handler
 * file here.
 */

import { authHandlers } from './auth';
import { orgHandlers } from './org';
import { employeeHandlers } from './employees';
import { attendanceHandlers } from './attendance';
import { taskHandlers } from './tasks';
import { roleHandlers } from './roles';
import { userHandlers } from './users';
import { dashboardHandlers } from './dashboard';
import { settingsHandlers } from './settings';

export const handlers = [
  ...authHandlers,
  ...orgHandlers,
  ...employeeHandlers,
  ...attendanceHandlers,
  ...taskHandlers,
  ...roleHandlers,
  ...userHandlers,
  ...dashboardHandlers,
  ...settingsHandlers,
];
