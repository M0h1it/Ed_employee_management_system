/**
 * src/mocks/handlers/dashboard.ts
 *
 * The dashboard counters and exception list.
 *
 * Every figure here is derived from punch events at request time using the same
 * buildDay rules the register uses. Nothing is stored and nothing is counted a
 * second, different way — which is what stops the dashboard and the register
 * from quietly disagreeing with each other.
 */

import { http, HttpResponse, delay } from 'msw';
import {
  format,
  parseISO,
  differenceInMinutes,
  subDays,
  subWeeks,
  subMonths,
  startOfWeek,
  startOfMonth,
  eachDayOfInterval,
  isWeekend,
  getISOWeek,
} from 'date-fns';
import { EP } from '@/contracts/endpoints';
import type {
  DashboardStats,
  AttendanceException,
  AttendanceTrendPoint,
  TrendGranularity,
  Single,
} from '@/contracts/types';
import { employees } from '../fixtures/employees';
import { shifts } from '../fixtures/org';
import { punchesFor } from '../fixtures/punches';
import { tasks } from '../fixtures/tasks';
import { buildDay, isCurrentlyIn } from '@/domain/attendanceRules';

const shift = shifts[0];

export const dashboardHandlers = [
  http.get(EP.dashboard.stats, async () => {
    await delay(300);
    const today = format(new Date(), 'yyyy-MM-dd');
    // Counts describe TRACKED people only. Including the owner would make
    // "36 of 40 checked in" permanently unreachable.
    const active = employees.filter((e) => e.status === 'active' && e.attendanceTracked);

    let checkedInToday = 0;
    let currentlyPresent = 0;
    let checkedOut = 0;
    let lateCount = 0;
    let absentCount = 0;

    for (const employee of active) {
      const todays = punchesFor(employee.id, today);
      const day = buildDay({ employee, date: today, punches: todays, shift });

      if (day.firstIn) {
        // Arrivals only ever go up during the day. This is the number payroll
        // and any late-arrival report depend on, so it must never be
        // decremented when somebody leaves.
        checkedInToday++;
        if (day.flags.includes('LATE_IN')) lateCount++;

        if (isCurrentlyIn(todays)) currentlyPresent++;
        else checkedOut++;
      } else {
        absentCount++;
      }
    }

    const body: Single<DashboardStats> = {
      data: {
        date: today,
        totalEmployees: active.length,
        checkedInToday,
        currentlyPresent,
        checkedOut,
        lateCount,
        absentCount,
        tasksOpen: tasks.filter((t) => t.status !== 'done').length,
        tasksCompletedToday: tasks.filter(
          (t) => t.completedAt && t.completedAt.startsWith(today),
        ).length,
      },
    };
    return HttpResponse.json(body);
  }),

  http.get(EP.dashboard.exceptions, async () => {
    await delay(320);
    const today = format(new Date(), 'yyyy-MM-dd');
    const rows: AttendanceException[] = [];

    for (const employee of employees.filter(
      (e) => e.status === 'active' && e.attendanceTracked,
    )) {
      const todays = punchesFor(employee.id, today);
      const day = buildDay({ employee, date: today, punches: todays, shift });
      const expectedAt = `${today}T${shift.startTime}:00+05:30`;

      if (!day.firstIn) {
        rows.push({
          employeeId: employee.id,
          employeeName: employee.name,
          photoUrl: employee.photoUrl,
          flag: 'ABSENT',
          expectedAt,
          actualAt: null,
          delayMinutes: null,
        });
        continue;
      }

      if (day.flags.includes('LATE_IN')) {
        rows.push({
          employeeId: employee.id,
          employeeName: employee.name,
          photoUrl: employee.photoUrl,
          flag: 'LATE_IN',
          expectedAt,
          actualAt: day.firstIn,
          delayMinutes: differenceInMinutes(parseISO(day.firstIn), parseISO(expectedAt)),
        });
      }
    }

    // Worst first: absences, then the longest delays.
    rows.sort((a, b) => {
      if (a.flag !== b.flag) return a.flag === 'ABSENT' ? -1 : 1;
      return (b.delayMinutes ?? 0) - (a.delayMinutes ?? 0);
    });

    const body: Single<AttendanceException[]> = { data: rows };
    return HttpResponse.json(body);
  }),

  /**
   * Present / late / absent per bucket, for the owner's trend chart.
   *
   * The aggregation happens HERE rather than in the browser. Six months of
   * day-level rows for a growing company is thousands of records to answer a
   * question about roughly twenty numbers — and it gets slower every month the
   * business operates. The server counts; the client draws.
   */
  http.get(EP.dashboard.trend, async ({ request }) => {
    await delay(350);

    const url = new URL(request.url);
    const granularity = (url.searchParams.get('granularity') ?? 'day') as TrendGranularity;

    const tracked = employees.filter((e) => e.status === 'active' && e.attendanceTracked);
    const now = new Date();

    // How far back each view looks. Enough bars to show a trend, few enough
    // that every bar stays wide enough to read.
    const start =
      granularity === 'day'
        ? subDays(now, 13)
        : granularity === 'week'
          ? startOfWeek(subWeeks(now, 11), { weekStartsOn: 1 })
          : startOfMonth(subMonths(now, 5));

    const buckets = new Map<string, AttendanceTrendPoint>();

    function bucketFor(date: Date) {
      if (granularity === 'day') {
        return {
          key: format(date, 'yyyy-MM-dd'),
          label: format(date, 'dd MMM'),
        };
      }
      if (granularity === 'week') {
        const monday = startOfWeek(date, { weekStartsOn: 1 });
        return {
          key: format(monday, 'yyyy-MM-dd'),
          label: `W${getISOWeek(date)}`,
        };
      }
      const first = startOfMonth(date);
      return { key: format(first, 'yyyy-MM-dd'), label: format(first, 'MMM') };
    }

    for (const date of eachDayOfInterval({ start, end: now })) {
      // Weekends carry no signal here — a bar that is 100% absent every
      // Saturday tells the owner nothing and crushes the scale of the bars
      // that matter.
      if (isWeekend(date)) continue;

      const iso = format(date, 'yyyy-MM-dd');
      const { key, label } = bucketFor(date);

      if (!buckets.has(key)) {
        buckets.set(key, {
          bucket: key,
          label,
          present: 0,
          late: 0,
          absent: 0,
          workingDays: 0,
          trackedEmployees: tracked.length,
        });
      }
      const point = buckets.get(key)!;
      point.workingDays += 1;

      for (const employee of tracked) {
        const day = buildDay({
          employee,
          date: iso,
          punches: punchesFor(employee.id, iso),
          shift,
        });

        if (!day.firstIn) point.absent += 1;
        else if (day.flags.includes('LATE_IN')) point.late += 1;
        else point.present += 1;
      }
    }

    const data = Array.from(buckets.values()).sort((a, b) =>
      a.bucket.localeCompare(b.bucket),
    );

    const body: Single<AttendanceTrendPoint[]> = { data };
    return HttpResponse.json(body);
  }),
];
