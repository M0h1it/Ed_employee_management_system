/**
 * src/features/tasks/TasksPage.tsx
 *
 * The task board.
 *
 * ONE ROUTE, TWO AUDIENCES
 * -------------------------
 * The owner sees everyone's work and can assign. An employee sees only their
 * own and can only complete. Same component, same URL — the difference comes
 * from permissions, not from a second page.
 *
 * That is worth doing properly: two separate pages would drift apart within a
 * month, and every future change would have to be made twice.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '@/components/common/PageHeader';
import SearchInput from '@/components/common/SearchInput';
import Select from '@/components/common/Select';
import Button from '@/components/common/Button';
import EmptyState from '@/components/common/EmptyState';
import PermissionGate from '@/components/common/PermissionGate';
import TaskCard from './TaskCard';
import TaskForm from './TaskForm';
import TaskDetailModal from './TaskDetailModal';
import TaskTimeline from './TaskTimeline';
import TaskScheduleTable from './TaskScheduleTable';
import { useTasks, useCompleteTask, useUpdateTask, useTaskTimeline } from './api';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { useEmployees } from '@/features/employees/api';
import { useAuthStore } from '@/stores/authStore';
import type { Task, TaskStatus, TimelineRange } from '@/contracts/types';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
];

export default function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [viewing, setViewing] = useState<Task | null>(null);
  const [selfMode, setSelfMode] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  const user = useAuthStore((s) => s.user);
  const canViewAll = useAuthStore((s) => s.permissions.has('tasks.view_all'));
  const canAssign = useAuthStore((s) => s.permissions.has('tasks.assign'));
  const canComplete = useAuthStore((s) => s.permissions.has('tasks.complete_own'));
  const canCreateOwn = useAuthStore((s) => s.permissions.has('tasks.create_own'));
  const canEdit = useAuthStore((s) => s.permissions.has('tasks.edit'));

  /**
   * The view lives in the URL, so a link to the timeline opens the timeline.
   * Board is the default because it is what people do work in; the timeline is
   * what they check.
   */
  const view = (searchParams.get('view') ?? 'board') as 'board' | 'timeline';
  const range = (searchParams.get('range') ?? '2w') as TimelineRange;

  const search = searchParams.get('search') ?? '';
  const employeeId = searchParams.get('employeeId') ?? '';
  const priority = searchParams.get('priority') ?? '';
  const taskStatusFilter = searchParams.get('tstatus') ?? '';

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading } = useTasks({
    employeeId: canViewAll ? (employeeId as any) || undefined : (user?.employeeId as any),
    priority: (priority || undefined) as Task['priority'] | undefined,
    search: search || undefined,
    pageSize: 100,
  });

  // The assignee filter is only rendered for canViewAll, so the list is only
  // fetched for them.
  const { data: employeeData } = useEmployees(
    { pageSize: 100, status: 'active' },
    canViewAll,
  );

  // An employee only ever sees their own row, so the filter is forced rather
  // than offered — the same shape as every other scoped query in the app.
  const { data: timelineData, isLoading: timelineLoading } = useTaskTimeline({
    range,
    employeeId: canViewAll ? ((employeeId as any) || undefined) : 'me',
    status: (taskStatusFilter || undefined) as TaskStatus | undefined,
  });

  const complete = useCompleteTask();
  const update = useUpdateTask();

  const tasks = data?.data ?? [];
  const openCount = tasks.filter((t) => t.status !== 'done').length;
  const overdueCount = tasks.filter((t) => t.isOverdue).length;

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          isLoading
            ? 'Loading…'
            : `${openCount} open${overdueCount > 0 ? `, ${overdueCount} overdue` : ''}`
        }
        actions={
          <>
            <div className="inline-flex items-center gap-0.5 rounded-xl border border-black/[0.08] bg-card p-0.5 shadow-xs">
              {(['board', 'timeline'] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setFilter('view', key === 'board' ? '' : key)}
                  className={
                    view === key
                      ? 'inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] font-semibold text-white shadow-xs'
                      : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
                  }
                >
                  <span className="icon text-[14px]">
                    {key === 'board' ? 'view_kanban' : 'calendar_view_week'}
                  </span>
                  {key === 'board' ? 'Board' : 'Timeline'}
                </button>
              ))}
            </div>

            {canCreateOwn && (
              <Button
                variant="secondary"
                icon="add_task"
                onClick={() => {
                  setEditing(null);
                  setSelfMode(true);
                  setFormOpen(true);
                }}
              >
                Add my task
              </Button>
            )}
            <PermissionGate need="tasks.assign">
              <Button
                icon="add"
                onClick={() => {
                  setEditing(null);
                  setSelfMode(false);
                  setFormOpen(true);
                }}
              >
                Assign task
              </Button>
            </PermissionGate>
          </>
        }
      />

      <div className="mb-space-base flex flex-wrap items-center gap-space-sm">
        <div className="w-full min-w-[180px] sm:flex-1">
          <SearchInput
            value={search}
            onChange={(v) => setFilter('search', v)}
            placeholder="Search tasks…"
          />
        </div>
        {canViewAll && (
          <div className="w-[calc(50%-0.25rem)] sm:w-[200px]">
            <Select
              aria-label="Assignee"
              value={employeeId}
              onChange={(v) => setFilter('employeeId', v)}
              options={employeeData?.data.map((e) => ({ value: e.id, label: e.name })) ?? []}
              placeholder="Everyone"
            />
          </div>
        )}
        <div className="w-[calc(50%-0.25rem)] sm:w-[150px]">
          <Select
            aria-label="Priority"
            value={priority}
            onChange={(v) => setFilter('priority', v)}
            options={[
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
            placeholder="All priorities"
          />
        </div>
      </div>

      {view === 'timeline' ? (
        <>
          <TaskTimeline
            rows={timelineData?.data ?? []}
            range={range}
            onRangeChange={(r) => setFilter('range', r)}
            isLoading={timelineLoading}
            singlePerson={!canViewAll}
          />
          <TaskScheduleTable
            rows={timelineData?.data ?? []}
            isLoading={timelineLoading}
            showAssignee={canViewAll}
          />
        </>
      ) : (
      <div className="grid gap-space-base lg:grid-cols-3">
        {COLUMNS.map((column) => {
          const columnTasks = tasks.filter((t) => t.status === column.status);
          return (
            <section key={column.status} className="flex flex-col gap-space-sm">
              <div className="flex items-center gap-space-sm px-space-xxs">
                <h2 className="font-label-md text-label-md uppercase tracking-wider text-zinc-500">
                  {column.label}
                </h2>
                <span className="rounded-xl bg-zinc-100 px-space-xs font-mono-data text-mono-data text-zinc-500">
                  {columnTasks.length}
                </span>
              </div>

              <div className="flex min-h-[120px] flex-col gap-space-sm rounded-2xl bg-zinc-50 p-space-sm">
                {isLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-24 animate-pulse rounded-2xl bg-zinc-100" />
                  ))
                ) : columnTasks.length === 0 ? (
                  <EmptyState
                    icon={column.status === 'done' ? 'task_alt' : 'inbox'}
                    title="Nothing here"
                  />
                ) : (
                  columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      canComplete={canComplete || canAssign}
                      canEdit={canEdit}
                      hideAssignee={!canViewAll}
                      onView={(t) => setViewing(t)}
                      onEdit={(t) => {
                        setEditing(t);
                        setSelfMode(false);
                        setFormOpen(true);
                      }}
                      onComplete={async (t) => {
                        // A confirm on completion, because undoing it means
                        // finding the card again in a column people stop
                        // looking at.
                        const ok = await confirm({
                          title: 'Mark this task done?',
                          description: t.title,
                          confirmLabel: 'Mark done',
                        });
                        if (!ok) return;
                        complete.mutate(t.id, { onSuccess: () => toast('Task completed') });
                      }}
                      onReopen={(t) =>
                        update.mutate(
                          { id: t.id, body: { status: 'todo' } },
                          { onSuccess: () => toast('Task reopened', 'info') },
                        )
                      }
                      onMove={(t, status) => update.mutate({ id: t.id, body: { status } })}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      )}

      <TaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        task={editing}
        selfMode={selfMode}
      />

      <TaskDetailModal task={viewing} onClose={() => setViewing(null)} />
    </>
  );
}