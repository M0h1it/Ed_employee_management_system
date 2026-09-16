/**
 * src/features/dashboard/OwnerDashboard.tsx
 *
 * What the owner sees: the four counters, who is inside right now, and what
 * needs attention today.
 *
 * THE FOUR COUNTERS ARE NOT INTERCHANGEABLE
 * ------------------------------------------
 * "Checked in today" counts arrivals and only goes up. "Currently present"
 * counts who is inside and moves both ways. They answer different questions and
 * collapsing them into one number would destroy the arrival record by evening —
 * which is exactly the number a late-arrival report or a payroll export needs.
 */

import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, subDays } from 'date-fns';
import Avatar from '@/components/common/Avatar';
import Chip from '@/components/common/Chip';
import EmptyState from '@/components/common/EmptyState';
import StatCard from './StatCard';
import { useDashboardStats, useExceptions, useAttendanceTrend } from './api';
import { useAttendanceDays } from '@/features/attendance/api';
import { useAuthStore } from '@/stores/authStore';
import type { TrendGranularity } from '@/contracts/types';

/* recharts is heavy; both charts share the one lazily-loaded chunk. */
const TeamTrendChart = lazy(() => import('./TeamTrendChart'));
const MonthChart = lazy(() => import('./MonthChart'));

const ChartSkeleton = () => (
  <div className="h-[260px] animate-pulse rounded-xl bg-zinc-100" />
);
import { usePresentEmployees } from '@/features/attendance/api';
import { useTasks, useCompleteTask } from '@/features/tasks/api';
import { formatTime, formatDuration } from '@/lib/format';

export default function OwnerDashboard() {
  const [granularity, setGranularity] = useState<TrendGranularity>('day');
  const user = useAuthStore((s) => s.user);

  const { data: statsData, isLoading: statsLoading } = useDashboardStats();
  const { data: trendData, isLoading: trendLoading } = useAttendanceTrend(granularity);

  /**
   * A manager is an employee too, so they get their own hours chart under the
   * company view. The owner is not attendance-tracked, so they do not — there
   * would be nothing in it.
   */
  const showsOwnChart = Boolean(user?.attendanceTracked);
  const myFrom = format(subDays(new Date(), 29), 'yyyy-MM-dd');
  const myTo = format(new Date(), 'yyyy-MM-dd');
  const { data: myMonth, isLoading: myMonthLoading } = useAttendanceDays(
    {
      dateFrom: myFrom,
      dateTo: myTo,
      employeeId: (user?.employeeId ?? undefined) as any,
      pageSize: 40,
    },
  );
  const { data: presentData, isLoading: presentLoading } = usePresentEmployees();
  const { data: exceptionData, isLoading: exceptionsLoading } = useExceptions();
  const { data: taskData } = useTasks({ status: 'todo', pageSize: 6 });
  const complete = useCompleteTask();

  const stats = statsData?.data;
  const present = presentData?.data ?? [];
  const exceptions = exceptionData?.data ?? [];
  const openTasks = taskData?.data ?? [];

  return (
    <>
      <div className="mb-space-base grid grid-cols-2 gap-space-sm sm:gap-space-base xl:grid-cols-4">
        {/* "Tracked" is deliberate wording. The company has more people than
            this — the owner is not on a shift and is excluded from every
            attendance figure. Labelling it "headcount" here would make
            "checked in 10 of 10" look wrong against a sidebar that says 11. */}
        <StatCard
          label="Tracked employees"
          value={stats?.totalEmployees ?? 0}
          context="on a shift"
          icon="group"
          loading={statsLoading}
        />
        <StatCard
          label="Checked in today"
          value={stats?.checkedInToday ?? 0}
          context={`of ${stats?.totalEmployees ?? 0} tracked`}
          icon="login"
          loading={statsLoading}
        />
        <StatCard
          label="Currently present"
          value={stats?.currentlyPresent ?? 0}
          context="inside now"
          live
          loading={statsLoading}
        />
        <StatCard
          label="Checked out"
          value={stats?.checkedOut ?? 0}
          context="left for the day"
          icon="logout"
          loading={statsLoading}
        />
      </div>

      <div className="mb-space-base">
        <Suspense fallback={<ChartSkeleton />}>
          <TeamTrendChart
            data={trendData?.data ?? []}
            isLoading={trendLoading}
            granularity={granularity}
            onGranularityChange={setGranularity}
          />
        </Suspense>
      </div>

      <div className="grid gap-space-base xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* --- Currently present ------------------------------------------ */}
        <section className="overflow-hidden rounded-2xl bg-card">
          <div className="flex items-center justify-between px-space-base py-space-md">
            <div className="flex items-center gap-space-sm">
              <span className="h-1.5 w-1.5 rounded-[50%] bg-emerald-500" />
              <h2 className="font-headline-md text-headline-md text-zinc-900">
                Currently present
              </h2>
              <Chip>{present.length} inside</Chip>
            </div>
            <Link
              to="/attendance"
              className="font-label-md text-label-md text-zinc-500 hover:text-zinc-900"
            >
              Full register →
            </Link>
          </div>

          {presentLoading ? (
            <div className="flex flex-col gap-space-xs px-space-base pb-space-base">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-xl bg-zinc-100" />
              ))}
            </div>
          ) : present.length === 0 ? (
            <EmptyState
              icon="meeting_room"
              title="Nobody is inside"
              description="Either the day has not started or everyone has left."
            />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="bg-zinc-50">
                  {['Employee', 'Department', 'Checked in', 'Elapsed', ''].map((h) => (
                    <th
                      key={h}
                      className="px-space-base py-space-sm text-left font-label-sm text-label-sm uppercase tracking-wider text-zinc-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {present.map((p) => (
                  <tr key={p.employeeId} className="border-t border-black/[0.06]">
                    <td className="h-row-height-compact px-space-base">
                      <div className="flex items-center gap-space-sm">
                        <Avatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                        <span className="font-body-sm text-body-sm font-medium text-zinc-900">
                          {p.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-space-base">
                      <Chip>{p.departmentName}</Chip>
                    </td>
                    <td className="px-space-base font-mono-data text-mono-data text-zinc-900">
                      {formatTime(p.checkInAt)}
                    </td>
                    <td className="px-space-base font-mono-data text-mono-data text-zinc-500">
                      {formatDuration(p.minutesSinceCheckIn)}
                    </td>
                    <td className="px-space-base text-right">
                      {p.isLate ? (
                        <Chip tone="warning">Late</Chip>
                      ) : (
                        <Chip tone="positive" dot>
                          On time
                        </Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>

        {/* --- Right column ------------------------------------------------ */}
        <div className="flex flex-col gap-space-base">
          <section className="rounded-2xl bg-card p-space-base">
            <div className="mb-space-md flex items-center gap-space-sm">
              <h2 className="font-headline-md text-headline-md text-zinc-900">
                Needs attention
              </h2>
              {exceptions.length > 0 && <Chip tone="warning">{exceptions.length}</Chip>}
            </div>

            {exceptionsLoading ? (
              <div className="flex flex-col gap-space-xs">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-100" />
                ))}
              </div>
            ) : exceptions.length === 0 ? (
              <p className="py-space-md text-center font-body-sm text-body-sm text-zinc-400">
                Everyone is accounted for.
              </p>
            ) : (
              <ol className="divide-y divide-black/[0.06]">
                {exceptions.map((e) => (
                  <li
                    key={`${e.employeeId}-${e.flag}`}
                    className="flex items-center gap-space-sm py-space-sm"
                  >
                    <Avatar name={e.employeeName} photoUrl={e.photoUrl} size="sm" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-body-sm text-body-sm text-zinc-900">
                        {e.employeeName}
                      </span>
                      <span className="font-mono-data text-mono-data text-zinc-400">
                        {e.actualAt
                          ? `${formatTime(e.expectedAt)} → ${formatTime(e.actualAt)}`
                          : `Expected ${formatTime(e.expectedAt)}`}
                      </span>
                    </div>
                    {e.flag === 'ABSENT' ? (
                      <Chip tone="danger">Absent</Chip>
                    ) : (
                      <Chip tone="warning">+{e.delayMinutes}m</Chip>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-2xl bg-card p-space-base">
            <div className="mb-space-md flex items-center justify-between">
              <h2 className="font-headline-md text-headline-md text-zinc-900">Open tasks</h2>
              <Link
                to="/tasks"
                className="font-label-md text-label-md text-zinc-500 hover:text-zinc-900"
              >
                All {stats?.tasksOpen ?? 0} →
              </Link>
            </div>

            {openTasks.length === 0 ? (
              <p className="py-space-md text-center font-body-sm text-body-sm text-zinc-400">
                Nothing outstanding.
              </p>
            ) : (
              <ul className="flex flex-col gap-space-sm">
                {openTasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-space-sm">
                    <button
                      onClick={() => complete.mutate(t.id)}
                      aria-label={`Mark "${t.title}" done`}
                      className="mt-0.5 shrink-0 text-zinc-400 hover:text-emerald-600"
                    >
                      <span className="icon text-[18px]">radio_button_unchecked</span>
                    </button>
                    <div className="flex min-w-0 flex-col">
                      <span className="font-body-sm text-body-sm text-zinc-900">{t.title}</span>
                      <span
                        className={
                          t.isOverdue
                            ? 'font-label-sm text-label-sm text-red-600'
                            : 'font-label-sm text-label-sm text-zinc-400'
                        }
                      >
                        {t.employeeName}
                        {t.dueDate && ` · due ${t.dueDate.slice(8, 10)}/${t.dueDate.slice(5, 7)}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {showsOwnChart && (
        <section className="mt-space-base rounded-2xl border border-black/[0.06] bg-card p-space-base shadow-xs">
          <div className="mb-space-base flex flex-wrap items-center justify-between gap-space-sm">
            <h2 className="font-headline-md text-headline-md text-zinc-900">
              My hours · last 30 days
            </h2>
            <span className="font-mono-data text-mono-data text-zinc-400">
              {myMonthLoading
                ? 'Loading…'
                : `${(myMonth?.data ?? []).filter((d) => d.status === 'PRESENT').length} days present`}
            </span>
          </div>

          {myMonthLoading ? (
            <ChartSkeleton />
          ) : (
            <Suspense fallback={<ChartSkeleton />}>
              <MonthChart days={myMonth?.data ?? []} targetHours={8} />
            </Suspense>
          )}
        </section>
      )}
    </>
  );
}