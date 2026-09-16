/**
 * src/features/dashboard/TeamTrendChart.tsx
 *
 * Present / late / absent per day, week or month — the owner's "is this getting
 * worse?" chart.
 *
 * WHY STACKED, AND WHY IN THIS ORDER
 * -----------------------------------
 * Each bar is one period, and its full height is every attendance slot in that
 * period. Stacking means the bars are all the same height, so the eye compares
 * the PROPORTION of red rather than trying to judge three separate lines.
 *
 * Absent sits at the top of the stack, not the bottom. A segment floating in
 * the middle of a stack is famously hard to compare across bars, because
 * neither of its edges lines up. Putting the thing that matters most at the top
 * gives it a common baseline — the flat top of every bar — so a bad week is
 * visible without reading a single number.
 *
 * The percentage in the tooltip does the rest: eight absences out of a hundred
 * slots is a very different story from eight out of twenty, and a raw count
 * cannot tell you which one you are looking at.
 */

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import clsx from 'clsx';
import type { AttendanceTrendPoint, TrendGranularity } from '@/contracts/types';

const COLOURS = {
  present: '#4F46E5', // indigo-600
  late: '#F59E0B', // amber-500
  absent: '#EF4444', // red-500
};

const RANGES: { value: TrendGranularity; label: string; hint: string }[] = [
  { value: 'day', label: 'Daily', hint: 'Last 14 working days' },
  { value: 'week', label: 'Weekly', hint: 'Last 12 weeks' },
  { value: 'month', label: 'Monthly', hint: 'Last 6 months' },
];

function TooltipBox({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row: AttendanceTrendPoint = payload[0].payload;
  const total = row.present + row.late + row.absent;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  return (
    <div className="min-w-[190px] rounded-xl border border-black/[0.08] bg-card px-space-md py-space-sm shadow-dropdown">
      <p className="font-headline-sm text-headline-sm text-zinc-900">{row.label}</p>
      <p className="mt-0.5 font-mono-data text-mono-data text-zinc-400">
        {row.workingDays} working {row.workingDays === 1 ? 'day' : 'days'} ·{' '}
        {row.trackedEmployees} people
      </p>
      <ul className="mt-space-sm flex flex-col gap-0.5">
        {[
          { label: 'On time', value: row.present, colour: COLOURS.present },
          { label: 'Late', value: row.late, colour: COLOURS.late },
          { label: 'Absent', value: row.absent, colour: COLOURS.absent },
        ].map((r) => (
          <li key={r.label} className="flex items-center gap-space-sm">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: r.colour }}
            />
            <span className="flex-1 font-body-sm text-[12px] text-zinc-500">{r.label}</span>
            <span className="font-mono-data text-mono-data text-zinc-900">
              {r.value}
            </span>
            <span className="w-9 text-right font-mono-data text-mono-data text-zinc-400">
              {pct(r.value)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props {
  data: AttendanceTrendPoint[];
  isLoading: boolean;
  granularity: TrendGranularity;
  onGranularityChange: (g: TrendGranularity) => void;
}

export default function TeamTrendChart({
  data,
  isLoading,
  granularity,
  onGranularityChange,
}: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const totals = data.reduce(
    (acc, d) => ({
      present: acc.present + d.present,
      late: acc.late + d.late,
      absent: acc.absent + d.absent,
    }),
    { present: 0, late: 0, absent: 0 },
  );
  const grandTotal = totals.present + totals.late + totals.absent;
  const problemRate =
    grandTotal === 0 ? 0 : Math.round(((totals.late + totals.absent) / grandTotal) * 100);

  const hint = RANGES.find((r) => r.value === granularity)?.hint ?? '';

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-card p-space-base shadow-xs">
      <div className="mb-space-base flex flex-col justify-between gap-space-sm sm:flex-row sm:items-start">
        <div className="flex flex-col">
          <h2 className="font-headline-md text-headline-md text-zinc-900">
            Attendance trend
          </h2>
          <p className="mt-0.5 font-mono-data text-mono-data text-zinc-400">
            {hint} · {problemRate}% late or absent overall
          </p>
        </div>

        {/* Segmented control — three options, always visible, one click each.
            A dropdown would hide two thirds of the answer behind a menu. */}
        <div className="inline-flex items-center gap-0.5 rounded-xl border border-black/[0.08] bg-card p-0.5 shadow-xs">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => onGranularityChange(r.value)}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-[12px] font-semibold',
                granularity === r.value
                  ? 'bg-zinc-900 text-white shadow-xs'
                  : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && data.length === 0 ? (
        <div className="h-[200px] animate-pulse rounded-xl bg-zinc-100 sm:h-[260px]" />
      ) : data.length === 0 ? (
        <p className="py-space-xl text-center font-body-sm text-body-sm text-zinc-400">
          No attendance recorded in this period.
        </p>
      ) : (
        <div className="h-[200px] w-full sm:h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#A1A1AA' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={12}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#A1A1AA' }}
                axisLine={false}
                tickLine={false}
                width={40}
                allowDecimals={false}
              />
              <Tooltip content={<TooltipBox />} cursor={{ fill: 'rgba(79,70,229,0.06)' }} />
              <Legend
                verticalAlign="bottom"
                height={28}
                iconType="square"
                iconSize={9}
                onClick={(e: any) => toggle(e.dataKey)}
                wrapperStyle={{ fontSize: 11, color: '#71717A', cursor: 'pointer' }}
              />
              {/* Stack order is bottom-up, so absent is declared last and lands
                  on top with a flat baseline to compare against. */}
              <Bar
                dataKey="present"
                name="On time"
                stackId="a"
                fill={COLOURS.present}
                hide={hidden.has('present')}
                maxBarSize={34}
              />
              <Bar
                dataKey="late"
                name="Late"
                stackId="a"
                fill={COLOURS.late}
                hide={hidden.has('late')}
                maxBarSize={34}
              />
              <Bar
                dataKey="absent"
                name="Absent"
                stackId="a"
                fill={COLOURS.absent}
                radius={[4, 4, 0, 0]}
                hide={hidden.has('absent')}
                maxBarSize={34}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
