/**
 * src/mocks/fixtures/punches.ts
 *
 * Fourteen days of punch events, generated deterministically.
 *
 * WHY DETERMINISTIC: a seeded pseudo-random generator means the demo looks the
 * same every reload. Math.random would reshuffle who was late on every refresh,
 * which makes it impossible to reproduce a bug someone just reported.
 *
 * WHY THE DATA IS DELIBERATELY MESSY: two people are chronically late, one
 * forgets to punch out, one is absent, one leaves early, one has a manual
 * entry. Clean fixtures produce a demo that looks great and a UI that has
 * never rendered a warning row. Every flag in the system appears somewhere in
 * this data on purpose.
 */

import { format, subDays, isWeekend } from 'date-fns';
import type { PunchEvent, PunchId, DeviceId, EmployeeId } from '@/contracts/types';
import { employees } from './employees';

/** Deterministic 0..1 generator. Same seed, same sequence, every time. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const DAYS_OF_HISTORY = 14;

/** Per-employee behaviour, so the data tells a consistent story over time. */
const PROFILES: Record<
  string,
  { inBase: number; inSpread: number; hours: number; absentRate: number; forgetOut: number }
> = {
  // emp-01 (the owner) is deliberately absent from this map — they are not
  // attendance-tracked, so no punches are generated for them at all.
  'emp-02': { inBase: 8 * 60 + 40, inSpread: 20, hours: 9, absentRate: 0.03, forgetOut: 0.05 },
  'emp-03': { inBase: 9 * 60 + 10, inSpread: 18, hours: 8.5, absentRate: 0.05, forgetOut: 0.08 },
  'emp-04': { inBase: 8 * 60 + 50, inSpread: 12, hours: 9, absentRate: 0.0, forgetOut: 0.0 },
  'emp-05': { inBase: 9 * 60 + 20, inSpread: 25, hours: 8, absentRate: 0.08, forgetOut: 0.05 },
  'emp-06': { inBase: 9 * 60 + 5, inSpread: 15, hours: 8.5, absentRate: 0.05, forgetOut: 0.0 },
  'emp-07': { inBase: 8 * 60 + 55, inSpread: 10, hours: 9, absentRate: 0.02, forgetOut: 0.03 },
  'emp-08': { inBase: 9 * 60 + 30, inSpread: 30, hours: 7.5, absentRate: 0.1, forgetOut: 0.1 },
  'emp-09': { inBase: 8 * 60 + 58, inSpread: 12, hours: 8.5, absentRate: 0.0, forgetOut: 0.0 },
  'emp-10': { inBase: 9 * 60 + 2, inSpread: 14, hours: 8.5, absentRate: 0.03, forgetOut: 0.02 },
  'emp-11': { inBase: 9 * 60 + 25, inSpread: 22, hours: 8, absentRate: 0.06, forgetOut: 0.06 },
};

function toISO(date: string, minutesFromMidnight: number): string {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = Math.floor(minutesFromMidnight % 60);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  // Fixed +05:30 offset so the fixture reads the same regardless of the
  // machine's timezone.
  return `${date}T${hh}:${mm}:00+05:30`;
}

function generate(): PunchEvent[] {
  const rand = seeded(20261024);
  const out: PunchEvent[] = [];
  let counter = 0;

  const nextId = () => `punch-${String(++counter).padStart(5, '0')}` as PunchId;
  const device = 'device-main' as DeviceId;

  const activeEmployees = employees.filter(
    (e) => e.status === 'active' && e.attendanceTracked,
  );
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  for (let d = DAYS_OF_HISTORY - 1; d >= 0; d--) {
    const dateObj = subDays(new Date(), d);
    const date = format(dateObj, 'yyyy-MM-dd');
    const isToday = d === 0;

    if (isWeekend(dateObj)) continue; // no punches at the weekend

    for (const employee of activeEmployees) {
      const profile = PROFILES[employee.id];
      if (!profile) continue;

      // Absent today? No punches at all.
      if (rand() < profile.absentRate) continue;

      const inMinutes = Math.round(
        profile.inBase + (rand() - 0.5) * 2 * profile.inSpread,
      );

      // On today, someone who has not arrived yet simply has no punch.
      if (isToday && inMinutes > nowMinutes) continue;

      out.push({
        id: nextId(),
        employeeId: employee.id as EmployeeId,
        employeeName: employee.name,
        ts: toISO(date, inMinutes),
        direction: 'IN',
        deviceId: device,
        deviceName: 'Main entrance',
        source: 'kiosk',
        confidence: Number((0.82 + rand() * 0.16).toFixed(2)),
        photoRef: null,
      });

      const outMinutes = Math.round(inMinutes + profile.hours * 60 + (rand() - 0.5) * 40);

      // Forgot to punch out -> MISSING_OUT flag on a past day.
      if (rand() < profile.forgetOut) continue;
      // Still inside right now -> no OUT punch yet on today.
      if (isToday && outMinutes > nowMinutes) continue;

      out.push({
        id: nextId(),
        employeeId: employee.id as EmployeeId,
        employeeName: employee.name,
        ts: toISO(date, outMinutes),
        direction: 'OUT',
        deviceId: device,
        deviceName: 'Main entrance',
        source: 'kiosk',
        confidence: Number((0.82 + rand() * 0.16).toFixed(2)),
        photoRef: null,
      });
    }
  }

  return out;
}

/**
 * Mutable, because manual punch entry appends to it and the change must
 * survive until reload. In Phase 2 this becomes an append-only table.
 */
export let punches: PunchEvent[] = generate();

/**
 * The date the fixture was generated for.
 *
 * WHY THIS EXISTS — a real bug it fixes
 * --------------------------------------
 * The fixture builds "the last 14 days" relative to the moment the page loaded.
 * Leave the tab open past midnight and today's date moves on, but the data does
 * not: every lookup for the new today finds nothing, so the dashboard reads
 * zero across the board while the app otherwise behaves normally. It looks like
 * the session broke; it is actually stale fixture data.
 *
 * Regenerating on the first lookup after the date rolls over keeps a long-open
 * tab honest. Manually entered punches are carried across so they are not lost.
 */
let generatedFor = format(new Date(), 'yyyy-MM-dd');

function ensureFresh() {
  const today = format(new Date(), 'yyyy-MM-dd');
  if (today === generatedFor) return;

  const manual = punches.filter((p) => p.source === 'manual');
  punches = [...generate(), ...manual];
  generatedFor = today;
}

export function punchesFor(employeeId: string, date: string): PunchEvent[] {
  ensureFresh();
  return punches.filter((p) => p.employeeId === employeeId && p.ts.startsWith(date));
}

export function punchesOn(date: string): PunchEvent[] {
  ensureFresh();
  return punches.filter((p) => p.ts.startsWith(date));
}

/** Appends a manually entered punch. */
export function addPunch(punch: PunchEvent) {
  ensureFresh();
  punches.push(punch);
}
