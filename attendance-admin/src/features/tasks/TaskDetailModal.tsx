/**
 * src/features/tasks/TaskDetailModal.tsx
 *
 * Read-only full detail for one task — everything TaskCard's own compact
 * view has to leave out (full description with no line-clamp, exact start
 * and due dates, who assigned it, when it was created/completed).
 *
 * Deliberately read-only: editing already has its own entry point
 * (TaskForm.tsx, opened via TaskCard's Edit button) with its own
 * permission gate. Folding an edit form into this "View" surface would
 * mean either duplicating that gate here or silently offering edit
 * controls to someone who only has view access — simpler and safer to
 * keep this strictly a detail view and point back to Edit for changes.
 */

import { format, parseISO } from 'date-fns';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Avatar from '@/components/common/Avatar';
import PriorityBadge from '@/components/common/PriorityBadge';
import StatusPill from '@/components/common/StatusPill';
import type { Task } from '@/contracts/types';

interface Props {
  task: Task | null;
  onClose: () => void;
}

function fmtDate(iso: string | null): string {
  return iso ? format(parseISO(iso), 'dd MMM yyyy') : '—';
}

function fmtDateTime(iso: string | null): string {
  return iso ? format(parseISO(iso), 'dd MMM yyyy, hh:mm a') : '—';
}

/** Same status -> tone/label mapping TaskScheduleTable.tsx already uses,
 * duplicated rather than imported because that file does not export it —
 * kept identical on purpose so a task's status pill looks the same
 * whether seen in the table or in this detail view. */
function statusPill(task: Task) {
  if (task.status === 'done') {
    return <StatusPill tone="emerald" dot>Done</StatusPill>;
  }
  if (task.isOverdue) {
    return <StatusPill tone="red">Overdue</StatusPill>;
  }
  if (task.status === 'in_progress') {
    return <StatusPill tone="indigo" dot>In progress</StatusPill>;
  }
  return <StatusPill tone="slate">To do</StatusPill>;
}

export default function TaskDetailModal({ task, onClose }: Props) {
  return (
    <Modal
      open={task !== null}
      onOpenChange={(open) => !open && onClose()}
      title={task?.title ?? 'Task'}
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {task && (
        <div className="flex flex-col gap-space-base">
          <div className="flex items-center gap-space-sm">
            <PriorityBadge priority={task.priority} />
            {statusPill(task)}
          </div>

          {task.description && (
            <p className="whitespace-pre-wrap font-body-sm text-body-sm text-zinc-600">
              {task.description}
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-space-base gap-y-space-sm rounded-xl bg-zinc-50 p-space-md">
            <div>
              <p className="font-label-sm text-label-sm text-zinc-400">Assigned to</p>
              <div className="mt-space-xxs flex items-center gap-space-xs">
                <Avatar name={task.employeeName} photoUrl={task.employeePhotoUrl} size="sm" />
                <span className="font-body-sm text-body-sm text-zinc-800">{task.employeeName}</span>
              </div>
            </div>
            <div>
              <p className="font-label-sm text-label-sm text-zinc-400">
                {task.selfAssigned ? 'Added by' : 'Assigned by'}
              </p>
              <p className="mt-space-xxs font-body-sm text-body-sm text-zinc-800">
                {task.selfAssigned ? task.employeeName : task.assignedByName}
              </p>
            </div>
            <div>
              <p className="font-label-sm text-label-sm text-zinc-400">Start date</p>
              <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                {fmtDate(task.startDate)}
              </p>
            </div>
            <div>
              <p className="font-label-sm text-label-sm text-zinc-400">Due date</p>
              <p
                className={`mt-space-xxs font-mono-data text-mono-data ${
                  task.isOverdue ? 'text-red-600' : 'text-zinc-800'
                }`}
              >
                {fmtDate(task.dueDate)}
                {task.isOverdue && ' (overdue)'}
              </p>
            </div>
            <div>
              <p className="font-label-sm text-label-sm text-zinc-400">Created</p>
              <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                {fmtDateTime(task.createdAt)}
              </p>
            </div>
            {task.status === 'done' && (
              <div>
                <p className="font-label-sm text-label-sm text-zinc-400">Completed</p>
                <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                  {fmtDateTime(task.completedAt)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}