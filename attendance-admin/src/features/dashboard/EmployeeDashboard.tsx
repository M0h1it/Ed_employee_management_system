/**
 * src/features/dashboard/EmployeeDashboard.tsx
 *
 * What an employee sees on the same route as the owner: their own status, their
 * own work, their own month.
 *
 * SAME URL, DIFFERENT CONTENT — NOT A SECOND PAGE
 * ------------------------------------------------
 * Two routes would drift apart within a month and every shared change would
 * have to be made twice. One route that branches on capability stays in step by
 * construction.
 */

import { lazy, Suspense, useState } from 'react';
import { format, subDays, parseISO } from 'date-fns';
import clsx from 'clsx';
import StatusPill from '@/components/common/StatusPill';
import PriorityBadge from '@/components/common/PriorityBadge';
import Button from '@/components/common/Button';
import EmptyState from '@/components/common/EmptyState';
/**
 * recharts is ~180 kB. Lazy-loading it keeps that weight out of the main
 * bundle and out of the owner's dashboard, which does not use a chart.
 */
const MonthChart = lazy(() => import('./MonthChart'));
import TaskForm from '@/features/tasks/TaskForm';
import { useAttendanceDays } from '@/features/attendance/api';
import { useTasks, useCompleteTask } from '@/features/tasks/api';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';

import type { Task } from '@/contracts/types';

export default function EmployeeDashboard() {
  const user = useAuthStore((s) => s.user);
  const canCreateOwn = useAuthStore((s) => s.permissions.has('tasks.create_own'));
  const canEdit = useAuthStore((s) => s.permissions.has('tasks.edit'));

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const confirm = useConfirm();
  const toast = useToast();
  const complete = useCompleteTask();

  const { data: taskData, isLoading: tasksLoading } = useTasks({
    employeeId: 'me',
    pageSize: 50,
  });

  const dateTo = format(new Date(), 'yyyy-MM-dd');
  const dateFrom = format(subDays(new Date(), 29), 'yyyy-MM-dd');
  const { data: monthData, isLoading: monthLoading } = useAttendanceDays({
    dateFrom,
    dateTo,
    employeeId: (user?.employeeId ?? undefined) as any,
    pageSize: 40,
  });

  const tasks = taskData?.data ?? [];
  const todayISO = format(new Date(), 'yyyy-MM-dd');

  const openTasks = tasks.filter((t) => t.status !== 'done');
  const doneToday = tasks.filter(
    (t) => t.status === 'done' && t.completedAt?.startsWith(todayISO),
  );

  const days = (monthData?.data ?? []).filter((d) => d.status !== 'WEEKEND');
  const presentCount = days.filter((d) => d.status === 'PRESENT').length;
  const lateCount = days.filter((d) => d.flags.includes('LATE_IN')).length;
  const absentCount = days.filter((d) => d.status === 'ABSENT').length;
  const totalMinutes = days.reduce((sum, d) => sum + d.workedMinutes, 0);
  const avgHours = days.length > 0 ? totalMinutes / 60 / days.length : 0;

  async function markDone(task: Task) {
    const ok = await confirm({
      title: 'Mark this task done?',
      description: task.title,
      confirmLabel: 'Mark done',
    });
    if (!ok) return;
    complete.mutate(task.id, { onSuccess: () => toast('Nice — task completed') });
  }

  return (
    <>
      <div className="grid gap-space-base xl:grid-cols-2">
        {/* --- Tasks -------------------------------------------------------- */}
        <section className="flex flex-col rounded-2xl border border-black/[0.06] bg-card p-space-base shadow-xs">
          <div className="mb-space-md flex items-center justify-between gap-space-sm">
            <div className="flex flex-wrap items-center gap-space-sm">
              <h2 className="font-headline-md text-headline-md text-zinc-900">My tasks today</h2>
              {openTasks.length > 0 && (
                <StatusPill tone="indigo">{openTasks.length} open</StatusPill>
              )}
              {doneToday.length > 0 && (
                <StatusPill tone="emerald" dot>
                  {doneToday.length} done today
                </StatusPill>
              )}
            </div>
            {canCreateOwn && (
              <Button
                variant="secondary"
                icon="add"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Add task
              </Button>
            )}
          </div>

          {tasksLoading ? (
            <div className="flex flex-col gap-space-xs">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-100" />
              ))}
            </div>
          ) : openTasks.length === 0 && doneToday.length === 0 ? (
            <EmptyState
              icon="task_alt"
              title="Nothing on your list"
              description={
                canCreateOwn
                  ? 'Add a task to plan your own day.'
                  : 'Your manager has not assigned anything.'
              }
            />
          ) : (
            <div className="flex flex-col gap-space-base">
              {openTasks.length > 0 && (
                <ul className="flex flex-col gap-space-sm">
                  {openTasks.map((t) => (
                    <li
                      key={t.id}
                      className="group flex items-start gap-space-sm rounded-xl px-space-sm py-space-xs hover:bg-zinc-50"
                    >
                      <button
                        onClick={() => markDone(t)}
                        aria-label={`Mark "${t.title}" done`}
                        className="mt-0.5 shrink-0 text-zinc-300 hover:text-emerald-600"
                      >
                        <span className="icon text-[18px]">radio_button_unchecked</span>
                      </button>

                      <div className="flex min-w-0 flex-1 flex-col gap-space-xxs">
                        <span className="font-body-sm text-body-sm text-zinc-800">
                          {t.title}
                        </span>
                        <div className="flex flex-wrap items-center gap-space-xs">
                          <PriorityBadge priority={t.priority} />
                          {t.dueDate && (
                            <span
                              className={clsx(
                                'font-mono-data text-mono-data',
                                t.isOverdue ? 'text-red-600' : 'text-zinc-400',
                              )}
                            >
                              {t.isOverdue ? 'Overdue · ' : 'Due '}
                              {format(parseISO(t.dueDate), 'dd MMM')}
                            </span>
                          )}
                          <span className="font-label-sm text-label-sm text-zinc-400">
                            {t.selfAssigned ? 'Added by you' : `From ${t.assignedByName}`}
                          </span>
                        </div>
                      </div>

                      {canEdit && (
                        <button
                          onClick={() => {
                            setEditing(t);
                            setFormOpen(true);
                          }}
                          aria-label={`Edit "${t.title}"`}
                          className="shrink-0 rounded-lg p-1 text-zinc-300 opacity-0 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <span className="icon text-[15px]">edit</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {doneToday.length > 0 && (
                <div className="flex flex-col gap-space-xs border-t border-black/[0.06] pt-space-md">
                  <p className="font-label-sm text-label-sm uppercase tracking-[0.09em] text-zinc-400">
                    Done today · {doneToday.length}
                  </p>
                  <ul className="flex flex-col gap-space-xxs">
                    {doneToday.map((t) => (
                      <li key={t.id} className="flex items-center gap-space-sm px-space-sm">
                        <span className="icon shrink-0 text-[18px] text-emerald-600">
                          check_circle
                        </span>
                        <span className="min-w-0 flex-1 truncate font-body-sm text-body-sm text-zinc-400 line-through">
                          {t.title}
                        </span>
                        <span className="shrink-0 font-mono-data text-mono-data text-zinc-400">
                          {t.completedAt && format(parseISO(t.completedAt), 'hh:mm a')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* --- Month -------------------------------------------------------- */}
        <section className="rounded-2xl border border-black/[0.06] bg-card p-space-base shadow-xs">
          <div className="mb-space-base flex flex-wrap items-center justify-between gap-space-sm">
            <h2 className="font-headline-md text-headline-md text-zinc-900">
              Hours worked · last 30 days
            </h2>
            <span className="font-mono-data text-mono-data text-zinc-400">
              {format(parseISO(dateFrom), 'dd MMM')} – {format(parseISO(dateTo), 'dd MMM')}
            </span>
          </div>

          <div className="mb-space-base grid grid-cols-2 gap-space-sm sm:grid-cols-4">
            {[
              { label: 'Present', value: presentCount, cls: 'text-zinc-900' },
              { label: 'Late', value: lateCount, cls: 'text-amber-600' },
              { label: 'Absent', value: absentCount, cls: 'text-red-600' },
              { label: 'Avg / day', value: `${avgHours.toFixed(1)}h`, cls: 'text-zinc-900' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-zinc-50 px-space-md py-space-sm">
                <p className={clsx('font-headline-lg text-[20px] leading-none', s.cls)}>
                  {s.value}
                </p>
                <p className="mt-1 font-label-sm text-label-sm uppercase tracking-[0.09em] text-zinc-400">
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          {monthLoading ? (
            <div className="h-[220px] animate-pulse rounded-xl bg-zinc-100" />
          ) : (
            <Suspense
              fallback={<div className="h-[220px] animate-pulse rounded-xl bg-zinc-100" />}
            >
              <MonthChart days={monthData?.data ?? []} targetHours={8} />
            </Suspense>
          )}

          <div className="mt-space-md flex flex-wrap gap-space-base font-label-sm text-label-sm text-zinc-500">
            {[
              { colour: 'bg-indigo-600', label: 'Full day' },
              { colour: 'bg-amber-500', label: 'Late arrival' },
              { colour: 'bg-slate-400', label: 'Short / missing punch' },
              { colour: 'bg-red-300', label: 'Absent' },
            ].map((l) => (
              <span key={l.label} className="flex items-center gap-space-xs">
                <span className={clsx('h-2.5 w-2.5 rounded-sm', l.colour)} />
                {l.label}
              </span>
            ))}
          </div>
        </section>
      </div>

      <TaskForm open={formOpen} onOpenChange={setFormOpen} task={editing} selfMode />
    </>
  );
}
