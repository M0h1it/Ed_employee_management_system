/**
 * src/mocks/fixtures/tasks.ts
 *
 * Assigned work. Mutable, because the board creates and completes tasks and
 * those changes must survive until reload.
 *
 * Deliberately includes: two overdue, one completed today, one with no due
 * date, and several employees with nothing assigned — so the empty column and
 * the overdue styling both get exercised.
 */

import { format, addDays, subDays } from 'date-fns';
import type { Task, TaskId, EmployeeId, UserId } from '@/contracts/types';
import { employees } from './employees';

const d = (offset: number) => format(addDays(new Date(), offset), 'yyyy-MM-dd');
const ts = (offset: number) =>
  `${format(subDays(new Date(), offset), 'yyyy-MM-dd')}T10:00:00+05:30`;

function emp(index: number) {
  const e = employees[index];
  return {
    employeeId: e.id as EmployeeId,
    employeeName: e.name,
    employeePhotoUrl: e.photoUrl,
  };
}

const OWNER = 'user-01' as UserId;

let counter = 0;
const nextId = () => `task-${String(++counter).padStart(3, '0')}` as TaskId;

export const tasks: Task[] = [
  {
    id: nextId(),
    ...emp(2),
    assignedBy: OWNER,
    assignedByName: 'Elena Vance',
    title: 'Reconcile October vendor invoices',
    description: 'Cross-check the three outstanding invoices against purchase orders.',
    startDate: null,
    dueDate: d(-2), // overdue
    priority: 'high',
    status: 'in_progress',
    completedAt: null,
    createdAt: ts(6),
    isOverdue: true,
    selfAssigned: false,
  },
  {
    id: nextId(),
    ...emp(1),
    assignedBy: OWNER,
    assignedByName: 'Elena Vance',
    title: 'Ship the kiosk enrolment endpoint',
    description: 'Face template storage plus the enrolment API.',
    startDate: null,
    dueDate: d(3),
    priority: 'high',
    status: 'in_progress',
    completedAt: null,
    createdAt: ts(4),
    isOverdue: false,
    selfAssigned: false,
  },
  {
    id: nextId(),
    ...emp(4),
    assignedBy: OWNER,
    assignedByName: 'Elena Vance',
    title: 'Draft Q4 onboarding checklist',
    description: 'One page, covering IT setup, floor orientation and buddy assignment.',
    startDate: null,
    dueDate: d(1),
    priority: 'medium',
    status: 'todo',
    completedAt: null,
    createdAt: ts(2),
    isOverdue: false,
    selfAssigned: false,
  },
  {
    id: nextId(),
    ...emp(2),
    assignedBy: OWNER,
    assignedByName: 'Elena Vance',
    title: 'Audit the biometric sensor sync log',
    description: 'Four unverified clock-outs from the evening shift need checking.',
    startDate: null,
    dueDate: d(0),
    priority: 'high',
    status: 'todo',
    completedAt: null,
    createdAt: ts(1),
    isOverdue: false,
    selfAssigned: false,
  },
  {
    id: nextId(),
    ...emp(6),
    assignedBy: OWNER,
    assignedByName: 'Elena Vance',
    title: 'Close out the support backlog',
    description: 'Anything older than seven days gets a response or an escalation.',
    startDate: null,
    dueDate: d(-1), // overdue
    priority: 'medium',
    status: 'todo',
    completedAt: null,
    createdAt: ts(8),
    isOverdue: true,
    selfAssigned: false,
  },
  {
    id: nextId(),
    ...emp(5),
    assignedBy: OWNER,
    assignedByName: 'Elena Vance',
    title: 'Update the floor plan for the new desks',
    description: null as unknown as string,
    startDate: null,
    dueDate: null, // no deadline — a real and common case
    priority: 'low',
    status: 'todo',
    completedAt: null,
    createdAt: ts(3),
    isOverdue: false,
    selfAssigned: false,
  },
  {
    id: nextId(),
    ...emp(1),
    assignedBy: OWNER,
    assignedByName: 'Elena Vance',
    title: 'Approve overtime requests for Operations',
    description: 'Three requests pending since Friday.',
    startDate: null,
    dueDate: d(0),
    priority: 'medium',
    status: 'done',
    completedAt: `${format(new Date(), 'yyyy-MM-dd')}T11:02:00+05:30`,
    createdAt: ts(2),
    isOverdue: false,
    selfAssigned: false,
  },
  {
    id: nextId(),
    ...emp(9),
    assignedBy: OWNER,
    assignedByName: 'Elena Vance',
    title: 'Refresh the customer health dashboard',
    description: 'Pull the latest NPS figures into the weekly view.',
    startDate: null,
    dueDate: d(-4),
    priority: 'low',
    status: 'done',
    completedAt: ts(3),
    createdAt: ts(4),
    isOverdue: false,
    selfAssigned: false,
  },
  {
    id: nextId(),
    ...emp(7),
    assignedBy: OWNER,
    assignedByName: 'Elena Vance',
    title: 'Write migration notes for the punch table',
    description: 'Document the idempotency key format before the backend work starts.',
    startDate: null,
    dueDate: d(5),
    priority: 'medium',
    status: 'todo',
    completedAt: null,
    createdAt: ts(1),
    isOverdue: false,
    selfAssigned: false,
  },
];

export function findTask(id: string): Task | undefined {
  return tasks.find((t) => t.id === id);
}

export function nextTaskId(): TaskId {
  return nextId();
}
