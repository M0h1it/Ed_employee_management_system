/**
 * src/mocks/fixtures/org.ts
 *
 * Departments and the single company-wide shift.
 */

import type { Department, Shift } from '@/contracts/types';

export const departments: Department[] = [
  { id: 'dept-eng', name: 'Engineering' },
  { id: 'dept-ops', name: 'Operations' },
  { id: 'dept-prd', name: 'Product' },
  { id: 'dept-cs', name: 'Customer Success' },
];

export const shifts: Shift[] = [
  {
    id: 'shift-general',
    name: 'General',
    startTime: '09:00',
    endTime: '18:00',
    graceMinutes: 15, // 09:15 still counts as on time
    minHours: 8,
  },
];
