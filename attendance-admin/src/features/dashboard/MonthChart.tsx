/**
 * src/features/dashboard/MonthChart.tsx
 *
 * Hours worked per day over the last 30 days.
 *
 * WHY THIS REPLACED THE COLOURED-SQUARE GRID
 * -------------------------------------------
 * The grid showed thirty unlabelled squares. It told you roughly how many were
 * green, and nothing else — you could not tell which day was which, and the
 * only way to read it was against a legend below.
 *
 * A bar chart answers the questions people actually have: which day was short,
 * am I trending down, where are the gaps. The date is on the axis, the height
 * is the hours, and the colour only marks the exceptions. Colour carries no
 * information the bar does not already carry, which matters because roughly one
 * man in twelve cannot separate the red bars from the amber ones.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { AttendanceDay } from '@/contracts/types';

const COLOURS = {
  present: '#4F46E5', // indigo-600
  late: '#F59E0B', // amber-500
  short: '#94A3B8', // slate-400
  absent: '#FCA5A5', // red-300, for the stub that marks an absence
};

interface Row {
  date: string;
  label: string;
  hours: number;
  status: AttendanceDay['status'];
  flags: AttendanceDay['flags'];
  firstIn: string | null;
  lastOut: string | null;
}

function barColour(row: Row): string {
  if (row.status === 'ABSENT') return COLOURS.absent;
  if (row.flags.includes('LATE_IN')) return COLOURS.late;
  if (row.flags.includes('SHORT_HOURS') || row.flags.includes('MISSING_OUT'))
    return COLOURS.short;
  return COLOURS.present;
}

function TooltipBox({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row: Row = payload[0].payload;

  return (
    <div className="rounded-xl border border-black/[0.08] bg-card px-space-md py-space-sm shadow-dropdown">
      <p className="font-headline-sm text-headline-sm text-zinc-900">
        {format(parseISO(row.date), 'EEEE, dd MMM')}
      </p>
      {row.status === 'ABSENT' ? (
        <p className="mt-0.5 font-body-sm text-[12px] text-red-600">No record for this day</p>
      ) : (
        <>
          <p className="mt-0.5 font-mono-data text-mono-data text-zinc-500">
            {row.firstIn ? format(parseISO(row.firstIn), 'hh:mm a') : '—'}
            {' → '}
            {row.lastOut ? format(parseISO(row.lastOut), 'hh:mm a') : '—'}
          </p>
          <p className="mt-1 font-headline-sm text-headline-sm text-zinc-900">
            {row.hours.toFixed(1)} hours
          </p>
        </>
      )}
      {row.flags.length > 0 && (
        <p className="mt-1 font-label-sm text-label-sm text-amber-600">
          {row.flags.join(' · ')}
        </p>
      )}
    </div>
  );
}

export default function MonthChart({
  days,
  targetHours = 8,
}: {
  days: AttendanceDay[];
  targetHours?: number;
}) {
  const rows: Row[] = days
    .filter((d) => d.status !== 'WEEKEND')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      label: format(parseISO(d.date), 'dd MMM'),
      // Absent days get a short stub rather than nothing, so a gap is visible
      // as an absence rather than reading as missing data.
      hours: d.status === 'ABSENT' ? 0.35 : Math.round((d.workedMinutes / 60) * 10) / 10,
      status: d.status,
      flags: d.flags,
      firstIn: d.firstIn,
      lastOut: d.lastOut,
    }));

  if (rows.length === 0) {
    return (
      <p className="py-space-xl text-center font-body-sm text-body-sm text-zinc-400">
        No attendance recorded yet.
      </p>
    );
  }

  return (
    <div className="h-[180px] w-full sm:h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#A1A1AA' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#A1A1AA' }}
            axisLine={false}
            tickLine={false}
            width={44}
            unit="h"
          />
          {/* The target line is what makes a short day legible at a glance —
              without it, "6.5 hours" needs the reader to remember the policy. */}
          <ReferenceLine
            y={targetHours}
            stroke="#A1A1AA"
            strokeDasharray="4 4"
            label={{
              value: `${targetHours}h target`,
              position: 'insideTopRight',
              fontSize: 10,
              fill: '#A1A1AA',
            }}
          />
          <Tooltip content={<TooltipBox />} cursor={{ fill: 'rgba(79,70,229,0.06)' }} />
          <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={18}>
            {rows.map((row) => (
              <Cell key={row.date} fill={barColour(row)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
