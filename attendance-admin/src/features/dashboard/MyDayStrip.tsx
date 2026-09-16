/**
 * src/features/dashboard/MyDayStrip.tsx
 *
 * The signed-in person's own check-in, check-out and hours.
 *
 * WHY EVERYONE SEES THIS, NOT JUST EMPLOYEES
 * -------------------------------------------
 * The first build showed it only on the employee dashboard, which quietly
 * assumed that anyone with company-wide visibility does not punch in. That is
 * wrong: a manager is an employee too, and so is the owner. They were the only
 * people in the building who could not see their own hours.
 *
 * So it renders above whichever dashboard follows. The shape stays the same for
 * everyone; only what sits below it changes.
 */

import clsx from 'clsx';
import StatusPill from '@/components/common/StatusPill';
import { useMyToday } from './api';
import { useAuthStore } from '@/stores/authStore';
import { formatTime, formatDuration } from '@/lib/format';

export default function MyDayStrip({ extra }: { extra?: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading } = useMyToday(user?.employeeId);
  const today = data?.data;

  if (isLoading) {
    return (
      <section className="mb-space-base h-[84px] animate-pulse rounded-2xl border border-black/[0.06] bg-card" />
    );
  }

  return (
    <section className="mb-space-base rounded-2xl border border-black/[0.06] bg-card px-space-base py-space-base shadow-xs sm:px-space-lg">
      {!today?.checkInAt ? (
        <div className="flex flex-wrap items-end justify-between gap-space-base">
          <div className="flex flex-col gap-space-xxs">
            <span className="font-headline-lg text-headline-lg text-zinc-900">
              You have not checked in yet
            </span>
            <span className="font-mono-data text-mono-data text-zinc-400">
              Shift starts {today?.shiftStart ?? '09:00'}
            </span>
          </div>
          {extra}
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-space-base">
          <div className="flex flex-col gap-space-xs">
            <div className="flex flex-wrap items-center gap-space-sm">
              <span
                className={clsx(
                  'h-2 w-2 rounded-full',
                  today.checkOutAt ? 'bg-zinc-400' : 'bg-emerald-500',
                )}
              />
              <span className="font-headline-lg text-headline-lg text-zinc-900">
                {today.checkOutAt
                  ? `Checked out at ${formatTime(today.checkOutAt)}`
                  : `Checked in at ${formatTime(today.checkInAt)}`}
              </span>
              {today.isLate ? (
                <StatusPill tone="amber">Late</StatusPill>
              ) : (
                <StatusPill tone="emerald" dot>
                  On time
                </StatusPill>
              )}
            </div>
            <span className="font-mono-data text-mono-data text-zinc-400">
              {today.checkOutAt
                ? `In ${formatTime(today.checkInAt)} · out ${formatTime(today.checkOutAt)}`
                : `Since ${formatTime(today.checkInAt)} · shift ends ${today.shiftEnd}`}
            </span>
          </div>

          <div className="flex items-end gap-space-lg">
            <div className="flex flex-col">
              <span className="font-headline-lg text-kpi text-zinc-900">
                {formatDuration(today.workedMinutes)}
              </span>
              <span className="font-label-sm text-label-sm uppercase tracking-[0.09em] text-zinc-400">
                {today.checkOutAt ? 'Hours worked' : 'Time in office'}
              </span>
            </div>
            {extra}
          </div>
        </div>
      )}
    </section>
  );
}
