/**
 * src/features/tasks/TaskCard.tsx
 *
 * One task on the board.
 */

import clsx from 'clsx';
import { format, parseISO } from 'date-fns';
import Avatar from '@/components/common/Avatar';
import PriorityBadge from '@/components/common/PriorityBadge';
import type { Task } from '@/contracts/types';

interface Props {
  task: Task;
  onComplete?: (task: Task) => void;
  onMove?: (task: Task, status: Task['status']) => void;
  onEdit?: (task: Task) => void;
  onReopen?: (task: Task) => void;
  onView?: (task: Task) => void;
  canComplete: boolean;
  canEdit: boolean;
  /** Hide the assignee row when every card on screen is the same person's. */
  hideAssignee?: boolean;
}

export default function TaskCard({
  task,
  onComplete,
  onMove,
  onEdit,
  onReopen,
  onView,
  canComplete,
  canEdit,
  hideAssignee,
}: Props) {
  const done = task.status === 'done';

  return (
    <div
      className={clsx(
        'group flex flex-col gap-space-sm rounded-2xl border border-black/[0.06] bg-card p-space-md shadow-xs transition-shadow hover:shadow-card',
        done && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-space-sm">
        <p
          className={clsx(
            'font-body-sm text-body-sm font-semibold leading-snug text-zinc-800',
            done && 'line-through',
          )}
        >
          {task.title}
        </p>
        <div className="flex shrink-0 items-center gap-space-xs">
          <PriorityBadge priority={task.priority} />
          {onView && (
            <button
              onClick={() => onView(task)}
              aria-label={`View "${task.title}"`}
              /* Always visible, unlike Edit below — viewing a task's full
                 detail is available to everyone who can see the card at
                 all, not gated the way editing is, so it does not need the
                 same hover-to-reveal treatment. */
              className="rounded-lg p-1 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600"
            >
              <span className="icon text-[15px]">visibility</span>
            </button>
          )}
          {canEdit && onEdit && (
            <button
              onClick={() => onEdit(task)}
              aria-label={`Edit "${task.title}"`}
              /* Revealed on hover so nine cards do not show nine icon buttons at
                 rest — but focus-visible keeps it reachable by keyboard. */
              className="rounded-lg p-1 text-zinc-300 opacity-0 hover:bg-indigo-50 hover:text-indigo-600 focus-visible:opacity-100 group-hover:opacity-100"
            >
              <span className="icon text-[15px]">edit</span>
            </button>
          )}
        </div>
      </div>

      {task.description && (
        <p className="line-clamp-2 font-body-sm text-[12px] leading-snug text-zinc-500">
          {task.description}
        </p>
      )}

      <div className="flex items-center justify-between gap-space-sm">
        {hideAssignee ? (
          <span className="font-label-sm text-label-sm text-zinc-400">
            {task.selfAssigned ? 'Added by you' : `From ${task.assignedByName}`}
          </span>
        ) : (
          <div className="flex min-w-0 items-center gap-space-xs">
            <Avatar name={task.employeeName} photoUrl={task.employeePhotoUrl} size="sm" />
            <span className="truncate font-label-sm text-label-sm text-zinc-500">
              {task.employeeName}
            </span>
          </div>
        )}

        {task.dueDate ? (
          <span
            className={clsx(
              'flex shrink-0 items-center gap-space-xxs font-mono-data text-mono-data',
              task.isOverdue ? 'text-red-600' : 'text-zinc-400',
            )}
          >
            <span className="icon text-[13px]">schedule</span>
            {format(parseISO(task.dueDate), 'dd MMM')}
          </span>
        ) : (
          <span className="shrink-0 font-label-sm text-label-sm text-zinc-300">No date</span>
        )}
      </div>

      {(canComplete || canEdit) && (
        <div className="flex gap-space-xs border-t border-black/[0.06] pt-space-sm">
          {!done && task.status === 'todo' && onMove && (
            <button
              onClick={() => onMove(task, 'in_progress')}
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-200"
            >
              <span className="icon text-[13px]">play_arrow</span>
              Start
            </button>
          )}

          {/* Moving back out of In progress. Starting something by mistake is
              easy; without this the only way back was to finish it. */}
          {!done && task.status === 'in_progress' && onMove && (
            <button
              onClick={() => onMove(task, 'todo')}
              title="Move back to To do"
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-200"
            >
              <span className="icon text-[13px]">arrow_back</span>
              To do
            </button>
          )}
          {!done && onComplete && (
            <button
              onClick={() => onComplete(task)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-xs hover:bg-indigo-700"
            >
              <span className="icon text-[13px]">check</span>
              Mark done
            </button>
          )}
          {done && onReopen && (
            <button
              onClick={() => onReopen(task)}
              className="rounded-lg bg-card px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 ring-1 ring-black/[0.08] hover:text-indigo-600 hover:ring-indigo-300"
            >
              Reopen
            </button>
          )}
          {done && task.completedAt && (
            <span className="ml-auto self-center font-mono-data text-mono-data text-zinc-400">
              {format(parseISO(task.completedAt), 'dd MMM, hh:mm a')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}