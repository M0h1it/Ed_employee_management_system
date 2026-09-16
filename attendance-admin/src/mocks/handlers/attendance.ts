/**
 * src/mocks/handlers/attendance.ts
 *
 * The attendance endpoints.
 *
 * Note that the day records are COMPUTED here from raw punches on every
 * request, using the same buildDay function the UI imports for its labels.
 * They are never stored. That is the real design: punches are the truth, days
 * are a view of them. Change a rule, and every historical day is correct on
 * the next request without any migration.
 *
 * The real backend will precompute and cache these in an attendance_day table
 * for speed, but it recomputes from the same source with the same rules.
 */

import { http, HttpResponse, delay } from 'msw';
import { format } from 'date-fns';
import { EP } from '@/contracts/endpoints';
import type {
  AttendanceDay,
  PresentEmployee,
  PunchEvent,
  Paginated,
  Single,
  EmployeeId,
} from '@/contracts/types';
import { employees, findEmployee } from '../fixtures/employees';
import { shifts } from '../fixtures/org';
import { punches, punchesFor, punchesOn, addPunch } from '../fixtures/punches';
import { buildDay, isCurrentlyIn, buildIdempotencyKey } from '@/domain/attendanceRules';

const shift = shifts[0];

/** Every date string between two dates, inclusive. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(format(d, 'yyyy-MM-dd'));
  }
  return out;
}

export const attendanceHandlers = [
  /** Daily register: one row per employee per day in the range. */
  http.get(EP.attendance.days, async ({ request }) => {
    await delay(350);
    const url = new URL(request.url);

    const today = format(new Date(), 'yyyy-MM-dd');
    const from = url.searchParams.get('dateFrom') ?? today;
    const to = url.searchParams.get('dateTo') ?? today;
    const employeeId = url.searchParams.get('employeeId') ?? '';
    const departmentId = url.searchParams.get('departmentId') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const hasFlags = url.searchParams.get('hasFlags') === 'true';
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 15);

    // Untracked people (the owner) have no hours to report and must not
    // appear as ABSENT every day.
    let people = employees.filter((e) => e.status === 'active' && e.attendanceTracked);
    if (employeeId) people = people.filter((e) => e.id === employeeId);
    if (departmentId) people = people.filter((e) => e.departmentId === departmentId);
    if (search) people = people.filter((e) => e.name.toLowerCase().includes(search));

    let rows: AttendanceDay[] = [];
    for (const date of dateRange(from, to)) {
      for (const employee of people) {
        rows.push(
          buildDay({
            employee,
            date,
            punches: punchesFor(employee.id, date),
            shift,
          }),
        );
      }
    }

    // Weekends are noise in a register — drop them unless a single employee's
    // history is being viewed, where the gap itself is informative.
    if (!employeeId) rows = rows.filter((r) => r.status !== 'WEEKEND');

    if (status) rows = rows.filter((r) => r.status === status);
    if (hasFlags) rows = rows.filter((r) => r.flags.length > 0);

    // Newest first, then alphabetical inside a day.
    rows.sort(
      (a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName),
    );

    const total = rows.length;
    const start = (page - 1) * pageSize;

    const body: Paginated<AttendanceDay> = {
      data: rows.slice(start, start + pageSize),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
    return HttpResponse.json(body);
  }),

  /** Who is inside right now. */
  http.get(EP.attendance.present, async () => {
    await delay(250);
    const today = format(new Date(), 'yyyy-MM-dd');
    const now = new Date();

    const rows: PresentEmployee[] = [];
    for (const employee of employees.filter(
      (e) => e.status === 'active' && e.attendanceTracked,
    )) {
      const todays = punchesFor(employee.id, today);
      if (!isCurrentlyIn(todays)) continue;

      const firstIn = todays.find((p) => p.direction === 'IN');
      if (!firstIn) continue;

      const checkIn = new Date(firstIn.ts);
      const day = buildDay({ employee, date: today, punches: todays, shift });

      rows.push({
        employeeId: employee.id,
        name: employee.name,
        photoUrl: employee.photoUrl,
        departmentName: employee.departmentName,
        checkInAt: firstIn.ts,
        minutesSinceCheckIn: Math.round((now.getTime() - checkIn.getTime()) / 60000),
        isLate: day.flags.includes('LATE_IN'),
      });
    }

    rows.sort((a, b) => a.checkInAt.localeCompare(b.checkInAt));
    const body: Single<PresentEmployee[]> = { data: rows };
    return HttpResponse.json(body);
  }),

  /** Raw punches for one employee on one date — the drill-down. */
  http.get(EP.attendance.punches, async ({ request }) => {
    await delay(200);
    const url = new URL(request.url);
    const employeeId = url.searchParams.get('employeeId') ?? '';
    const date = url.searchParams.get('date') ?? '';

    const rows = punchesFor(employeeId, date).sort((a, b) => a.ts.localeCompare(b.ts));
    const body: Single<PunchEvent[]> = { data: rows };
    return HttpResponse.json(body);
  }),

  /** Manual punch entry from the admin UI. */
  http.post(EP.attendance.punches, async ({ request }) => {
    await delay(300);
    const body = (await request.json()) as {
      employeeId: string;
      direction: 'IN' | 'OUT';
      ts: string;
      idempotencyKey?: string;
    };

    const employee = findEmployee(body.employeeId);
    if (!employee) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Employee not found.' } },
        { status: 404 },
      );
    }

    const key =
      body.idempotencyKey ??
      buildIdempotencyKey(body.employeeId, body.ts, body.direction);

    // A duplicate is not an error. The client treats 409 as success and stops
    // retrying — which is exactly what the offline kiosk queue will need.
    const duplicate = punches.some(
      (p) => buildIdempotencyKey(p.employeeId, p.ts, p.direction) === key,
    );
    if (duplicate) {
      return HttpResponse.json(
        { error: { code: 'DUPLICATE_PUNCH', message: 'This punch already exists.' } },
        { status: 409 },
      );
    }

    const punch: PunchEvent = {
      id: `punch-manual-${Date.now()}` as PunchEvent['id'],
      employeeId: employee.id as EmployeeId,
      employeeName: employee.name,
      ts: body.ts,
      direction: body.direction,
      deviceId: null,
      deviceName: null,
      source: 'manual',
      confidence: null,
      photoRef: null,
    };
    addPunch(punch);

    const responseBody: Single<PunchEvent> = { data: punch };
    return HttpResponse.json(responseBody, { status: 201 });
  }),

  /** Today's summary for the signed-in employee's own dashboard card. */
  http.get(EP.dashboard.myToday, async ({ request }) => {
    await delay(200);
    const url = new URL(request.url);
    const employeeId = url.searchParams.get('employeeId') ?? '';
    const today = format(new Date(), 'yyyy-MM-dd');
    const employee = findEmployee(employeeId);

    if (!employee) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Employee not found.' } },
        { status: 404 },
      );
    }

    const todays = punchesFor(employeeId, today);
    const day = buildDay({ employee, date: today, punches: todays, shift });

    return HttpResponse.json({
      data: {
        status: day.firstIn ? day.status : 'NOT_YET_IN',
        checkInAt: day.firstIn,
        checkOutAt: day.lastOut,
        workedMinutes: day.workedMinutes,
        shiftStart: shift.startTime,
        shiftEnd: shift.endTime,
        isLate: day.flags.includes('LATE_IN'),
      },
    });
  }),

  /** Unused today, wired so the dashboard feature can consume it later. */
  http.get(EP.attendance.days + '/all-punches', () => {
    const body: Single<PunchEvent[]> = { data: punchesOn(format(new Date(), 'yyyy-MM-dd')) };
    return HttpResponse.json(body);
  }),
];
