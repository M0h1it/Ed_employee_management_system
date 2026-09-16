/**
 * src/features/tasks/timelineFixtures.ts
 *
 * TEMPORARY. Local fixture data for the timeline while the view is designed.
 *
 * WHY NOT THE MSW MOCK SERVER
 * ----------------------------
 * The rest of the app now talks to the real backend. Turning the service worker
 * back on for one feature would mean every other screen silently switched to
 * fake data too, and nobody would notice until a demo.
 *
 * So this is a plain module, read by one hook. When the backend endpoint
 * arrives, the body of `useTaskTimeline` changes and this file is deleted —
 * no component touches it directly, which is the whole point.
 *
 * The shapes are exactly the contract types, so the swap cannot silently
 * change what the chart receives.
 */

import { addDays, format, subDays } from 'date-fns';
import type {
  EmployeeId,
  TaskId,
  TaskPriority,
  TaskStatus,
  TimelineRow,
} from '@/contracts/types';

const d = (offset: number) => format(addDays(new Date(), offset), 'yyyy-MM-dd');
const today = () => format(new Date(), 'yyyy-MM-dd');

interface Seed {
  employee: string;
  name: string;
  department: string;
  tasks: [string, number, number, TaskStatus, TaskPriority][];
  // title, startOffset, endOffset, status, priority
}

/**
 * Deliberately uneven. Two people are overloaded, one has nothing this week,
 * several tasks are overdue, and a few run past the edge of the two-week view.
 *
 * Even fixtures make a chart look tidy and hide every layout problem it has —
 * overlapping bars, bars that start before the window, a row with no work at
 * all. All three are in here on purpose.
 */
const SEEDS: Seed[] = [
  {
    employee: 'emp-02',
    name: 'Marcus Ray',
    department: 'Engineering',
    tasks: [
      ['Ship the kiosk enrolment endpoint', -4, 6, 'in_progress', 'high'],
      ['Review the punch idempotency design', -2, 1, 'in_progress', 'medium'],
      ['Write migration notes for the punch table', 7, 12, 'todo', 'low'],
    ],
  },
  {
    employee: 'emp-03',
    name: 'Karan Patel',
    department: 'Operations',
    tasks: [
      // Starts before the window opens — the bar must clip, not disappear.
      ['Reconcile October vendor invoices', -9, -2, 'in_progress', 'high'],
      ['Audit the biometric sensor sync log', -1, 2, 'todo', 'high'],
      ['Plan tomorrow stock count', 3, 4, 'todo', 'medium'],
    ],
  },
  {
    employee: 'emp-05',
    name: 'Priya Raman',
    department: 'Product',
    tasks: [
      ['Draft Q4 onboarding checklist', -3, 1, 'done', 'medium'],
      // Runs past the right edge — must clip there too.
      ['Marketplace inventory spec', 2, 24, 'todo', 'high'],
    ],
  },
  {
    employee: 'emp-06',
    name: 'David Chen',
    department: 'Product',
    tasks: [
      ['Update the floor plan for the new desks', -6, -4, 'done', 'low'],
    ],
  },
  {
    employee: 'emp-07',
    name: 'Amina Ndiaye',
    department: 'Customer Success',
    tasks: [
      ['Close out the support backlog', -5, -1, 'in_progress', 'medium'],
      ['Refresh the customer health dashboard', 1, 5, 'todo', 'low'],
      ['Draft the escalation playbook', 4, 9, 'todo', 'medium'],
      // Two bars on the same days — the row has to stack them, not overlap.
      ['Weekly NPS review', 4, 6, 'todo', 'low'],
    ],
  },
  {
    employee: 'emp-08',
    name: 'Jack Lawson',
    department: 'Engineering',
    // Nobody assigned anything. An empty row is a real state and the chart
    // should say so rather than dropping the person.
    tasks: [],
  },
  {
    employee: 'emp-10',
    name: 'Rachel Wong',
    department: 'Customer Success',
    tasks: [
      ['Migrate the help centre articles', -1, 8, 'in_progress', 'medium'],
    ],
  },
];

let counter = 0;

export const timelineRows: TimelineRow[] = SEEDS.map((seed) => ({
  employeeId: seed.employee as EmployeeId,
  employeeName: seed.name,
  employeePhotoUrl: null,
  departmentName: seed.department,
  bars: seed.tasks.map(([title, from, to, status, priority]) => {
    const endDate = d(to);
    return {
      taskId: `tl-${++counter}` as TaskId,
      title,
      startDate: d(from),
      endDate,
      status,
      priority,
      // Computed here, not stored — the same rule as everywhere else. A stored
      // overdue flag is wrong the next morning.
      isOverdue: status !== 'done' && endDate < today(),
    };
  }),
}));
