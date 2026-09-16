/**
 * src/features/tasks/TaskScheduleTable.tsx
 *
 * The list under the chart: every dated task with its start, end and who has it.
 *
 * WHY A TABLE AS WELL AS THE CHART
 * ---------------------------------
 * They answer different questions. The chart answers "who is loaded and when" —
 * shape and overlap, read at a glance. The table answers "what is due next and
 * exactly when" — precise dates, sortable, scannable, and readable on a phone
 * where a horizontally scrolling chart is not.
 *
 * Neither replaces the other, which is why both are here rather than one being
 * a toggle of the other.
 */

import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import clsx from 'clsx';
import Avatar from '@/components/common/Avatar';
import PriorityBadge from '@/components/common/PriorityBadge';
import StatusPill from '@/components/common/StatusPill';
import EmptyState from '@/components/common/EmptyState';
import type { TimelineRow } from '@/contracts/types';

interface Flat {
  taskId: string;
  title: string;
  employeeName: string;
  employeePhotoUrl: string | null;
  departmentName: string;
  startDate: string;
  endDate: string;
  status: string;
  priority: 'low' | 'medium' | 'high';
  isOverdue: boolean;
}

function flatten(rows: TimelineRow[]): Flat[] {
  const out: Flat[] = [];
  for (const row of rows) {
    for (const bar of row.bars) {
      out.push({
        taskId: bar.taskId,
        title: bar.title,
        employeeName: row.employeeName,
        employeePhotoUrl: row.employeePhotoUrl,
        departmentName: row.departmentName,
        startDate: bar.startDate,
        endDate: bar.endDate,
        status: bar.status,
        priority: bar.priority,
        isOverdue: bar.isOverdue,
      });
    }
  }

  // Overdue first, then by the end date. The deadline is what people scan for,
  // so it drives the order rather than the start.
  return out.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    return a.endDate.localeCompare(b.endDate);
  });
}

/** "in 3 days", "today", "4 days ago" — relative to now. */
function relative(endDate: string): { text: string; late: boolean } {
  const days = differenceInCalendarDays(parseISO(endDate), new Date());
  if (days === 0) return { text: 'today', late: false };
  if (days === 1) return { text: 'tomorrow', late: false };
  if (days > 1) return { text: `in ${days} days`, late: false };
  if (days === -1) return { text: 'yesterday', late: true };
  return { text: `${Math.abs(days)} days ago`, late: true };
}

const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

export default function TaskScheduleTable({
  rows,
  isLoading,
  showAssignee = true,
}: {
  rows: TimelineRow[];
  isLoading: boolean;
  showAssignee?: boolean;
}) {
  const tasks = flatten(rows);

  return (
    <section className="mt-space-base overflow-hidden rounded-2xl border border-black/[0.06] bg-card shadow-xs">
      <div className="flex items-center justify-between px-space-base py-space-md">
        <h2 className="font-headline-md text-headline-md text-zinc-900">Schedule</h2>
        <span className="font-mono-data text-mono-data text-zinc-400">
          {tasks.length} dated {tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-space-xs px-space-base pb-space-base">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon="event_note"
          title="No dated tasks"
          description="Give a task a start date and a due date and it appears here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="bg-zinc-50">
                {['Task', ...(showAssignee ? ['Assignee'] : []), 'Start', 'End', 'Due', 'Status']
                  .map((header) => (
                    <th
                      key={header}
                      className="whitespace-nowrap px-space-base py-space-sm text-left font-label-sm text-label-sm uppercase tracking-wider text-zinc-400"
                    >
                      {header}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const due = relative(task.endDate);
                return (
                  <tr key={task.taskId} className="border-t border-black/[0.06]">
                    <td className="h-row-height-compact px-space-base">
                      <div className="flex items-center gap-space-sm">
                        {task.isOverdue && (
                          <span className="icon shrink-0 text-[14px] text-red-600">warning</span>
                        )}
                        <span
                          className={clsx(
                            'font-body-sm text-body-sm text-zinc-800',
                            task.status === 'done' && 'text-zinc-400 line-through',
                          )}
                        >
                          {task.title}
                        </span>
                        <PriorityBadge priority={task.priority} compact />
                      </div>
                    </td>

                    {showAssignee && (
                      <td className="px-space-base">
                        <div className="flex items-center gap-space-xs">
                          <Avatar
                            name={task.employeeName}
                            photoUrl={task.employeePhotoUrl}
                            size="sm"
                          />
                          <span className="font-body-sm text-[12px] text-zinc-600">
                            {task.employeeName}
                          </span>
                        </div>
                      </td>
                    )}

                    <td className="px-space-base font-mono-data text-mono-data text-zinc-500">
                      {format(parseISO(task.startDate), 'dd MMM')}
                    </td>

                    <td className="px-space-base font-mono-data text-mono-data text-zinc-900">
                      {format(parseISO(task.endDate), 'dd MMM yyyy')}
                    </td>

                    {/* The relative column is the one people actually read.
                        "12 Sep" needs arithmetic; "4 days ago" does not. */}
                    <td className="px-space-base">
                      <span
                        className={clsx(
                          'font-mono-data text-mono-data',
                          task.status === 'done'
                            ? 'text-zinc-300'
                            : due.late
                              ? 'font-semibold text-red-600'
                              : 'text-zinc-500',
                        )}
                      >
                        {task.status === 'done' ? '—' : due.text}
                      </span>
                    </td>

                    <td className="px-space-base">
                      {task.status === 'done' ? (
                        <StatusPill tone="emerald" dot>
                          Done
                        </StatusPill>
                      ) : task.isOverdue ? (
                        <StatusPill tone="red">Overdue</StatusPill>
                      ) : task.status === 'in_progress' ? (
                        <StatusPill tone="indigo" dot>
                          In progress
                        </StatusPill>
                      ) : (
                        <StatusPill tone="slate">{STATUS_LABEL[task.status]}</StatusPill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
