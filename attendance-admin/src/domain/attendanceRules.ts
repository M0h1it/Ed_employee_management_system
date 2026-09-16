/**
 * src/domain/attendanceRules.ts
 *
 * PURE FUNCTIONS. No React, no fetch, no database, no imports from features.
 *
 * WHY THIS FOLDER EXISTS SEPARATELY
 * ----------------------------------
 * This is the actual business logic of the system: how a pile of raw punches
 * becomes "Karan was present, 22 minutes late, and worked 7h 40m".
 *
 * Keeping it pure buys three things:
 *   1. It is testable without a browser or a database — pass an array in,
 *      assert on what comes out.
 *   2. The mock handler and the real backend can produce identical results,
 *      because this file is the single definition of the rules.
 *   3. In Phase 2 this is the one file that gets ported to Python. Everything
 *      else on the frontend stays exactly as it is.
 *
 * If you find yourself writing an `if` about lateness inside a component, it
 * belongs here instead.
 */

import {
  parseISO,
  differenceInMinutes,
  isWeekend,
  format,
} from 'date-fns';
import type {
  PunchEvent,
  AttendanceDay,
  AttendanceFlag,
  AttendanceStatus,
  Shift,
  Employee,
} from '@/contracts/types';

/** Combines a date string and a shift time into a comparable Date. */
function atTime(date: string, time: string): Date {
  return parseISO(`${date}T${time}:00`);
}

/**
 * Collapses one employee's punches for one date into a single day record.
 *
 * RULE: the FIRST punch of the day is the arrival and the LAST is the
 * departure, regardless of what happened in between. Someone who steps out for
 * lunch and punches four times still has one arrival and one departure.
 *
 * The alternative — pairing punches strictly IN/OUT/IN/OUT — sounds more
 * correct and is far more fragile: one missed punch in the middle cascades and
 * corrupts the rest of the day. First-and-last degrades gracefully.
 */
export function buildDay(args: {
  employee: Employee;
  date: string;
  punches: PunchEvent[];
  shift: Shift;
}): AttendanceDay {
  const { employee, date, punches, shift } = args;

  const base = {
    employeeId: employee.id,
    employeeName: employee.name,
    employeePhotoUrl: employee.photoUrl,
    departmentName: employee.departmentName,
    date,
  };

  const sorted = [...punches].sort((a, b) => a.ts.localeCompare(b.ts));
  const ins = sorted.filter((p) => p.direction === 'IN');
  const outs = sorted.filter((p) => p.direction === 'OUT');

  const firstIn = ins[0]?.ts ?? null;
  const lastOut = outs[outs.length - 1]?.ts ?? null;

  const weekend = isWeekend(parseISO(date));
  const flags: AttendanceFlag[] = [];

  // --- No punches at all --------------------------------------------------
  if (sorted.length === 0) {
    const status: AttendanceStatus = weekend ? 'WEEKEND' : 'ABSENT';
    return {
      ...base,
      firstIn: null,
      lastOut: null,
      workedMinutes: 0,
      status,
      flags: [],
      punchCount: 0,
    };
  }

  // --- Worked minutes -----------------------------------------------------
  // With no OUT punch, count up to now if the day is today, otherwise leave it
  // at zero rather than inventing a departure time. An invented time would
  // silently become somebody's payable hours later.
  let workedMinutes = 0;
  const isToday = date === format(new Date(), 'yyyy-MM-dd');

  if (firstIn && lastOut) {
    workedMinutes = Math.max(0, differenceInMinutes(parseISO(lastOut), parseISO(firstIn)));
  } else if (firstIn && isToday) {
    workedMinutes = Math.max(0, differenceInMinutes(new Date(), parseISO(firstIn)));
  }

  // --- Flags --------------------------------------------------------------
  if (firstIn) {
    const cutoff = atTime(date, shift.startTime);
    const lateBy = differenceInMinutes(parseISO(firstIn), cutoff);
    // graceMinutes: arriving at 09:14 with a 15-minute grace is NOT late.
    if (lateBy > shift.graceMinutes) flags.push('LATE_IN');
  }

  if (firstIn && !lastOut && !isToday) flags.push('MISSING_OUT');
  if (!firstIn && lastOut) flags.push('MISSING_IN');

  if (lastOut) {
    const shiftEnd = atTime(date, shift.endTime);
    if (differenceInMinutes(shiftEnd, parseISO(lastOut)) > 15) flags.push('EARLY_OUT');
    if (workedMinutes > 0 && workedMinutes < shift.minHours * 60) {
      flags.push('SHORT_HOURS');
    }
  }

  if (sorted.some((p) => p.source === 'manual')) flags.push('MANUAL_ENTRY');

  // --- Status -------------------------------------------------------------
  let status: AttendanceStatus;
  if (weekend) status = 'WEEKEND';
  else if (firstIn) status = 'PRESENT';
  else status = 'ABSENT';

  return {
    ...base,
    firstIn,
    lastOut,
    workedMinutes,
    status,
    flags,
    punchCount: sorted.length,
  };
}

/** Is this person currently inside — last punch of today was an IN. */
export function isCurrentlyIn(punches: PunchEvent[]): boolean {
  if (punches.length === 0) return false;
  const sorted = [...punches].sort((a, b) => a.ts.localeCompare(b.ts));
  return sorted[sorted.length - 1].direction === 'IN';
}

/** Human label for a flag, used in the UI. */
export const FLAG_LABELS: Record<AttendanceFlag, string> = {
  LATE_IN: 'Late',
  EARLY_OUT: 'Left early',
  MISSING_OUT: 'Missing out',
  MISSING_IN: 'Missing in',
  SHORT_HOURS: 'Short hours',
  MANUAL_ENTRY: 'Manual',
};

/**
 * Builds the idempotency key the server uses to reject duplicate punches.
 * Minute-level granularity: two punches in the same minute are the same punch.
 */
export function buildIdempotencyKey(
  employeeId: string,
  ts: string,
  direction: string,
): string {
  const d = parseISO(ts);
  return `${employeeId}:${format(d, 'yyyy-MM-dd')}:${direction}:${format(d, 'HHmm')}`;
}
