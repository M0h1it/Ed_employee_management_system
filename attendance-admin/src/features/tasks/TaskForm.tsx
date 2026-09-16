/**
 * src/features/tasks/TaskForm.tsx
 *
 * One modal for three jobs: assign to someone, add to my own list, and edit an
 * existing task.
 *
 * WHY ALL THREE IN ONE COMPONENT: the fields are identical. Three components
 * would mean every future field gets added three times, and within a month one
 * of them would be missing something.
 *
 * The mode changes only what the title says, whether the assignee picker is
 * shown, and which mutation runs.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import FormField, { inputCls } from '@/components/common/FormField';
import { useEmployees } from '@/features/employees/api';
import { useCreateTask, useUpdateTask } from './api';
import { useToast } from '@/components/common/Toast';
import { ApiException } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import type { EmployeeId, Task } from '@/contracts/types';

const schema = z
  .object({
    employeeId: z.string().min(1, 'Choose who this is for'),
    title: z.string().min(3, 'Give the task a clear title'),
    description: z.string().optional(),
    startDate: z.string().optional(),
    dueDate: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']),
  })
  .refine(
    (v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate,
    // Caught here rather than server-side only, because a backwards bar is a
    // typo the person can fix in the moment — and it would render as a bar of
    // negative width.
    { path: ['dueDate'], message: 'The due date cannot be before the start date' },
  );

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Passing a task switches the modal into edit mode. */
  task?: Task | null;
  /** True when the person is adding to their own list — hides the picker. */
  selfMode?: boolean;
}

const PRIORITY_HELP: Record<string, string> = {
  high: 'Needs doing today or it blocks someone',
  medium: 'Normal work with a deadline',
  low: 'Do it when there is room',
};

export default function TaskForm({ open, onOpenChange, task, selfMode }: Props) {
  const isEdit = Boolean(task);
  const user = useAuthStore((s) => s.user);
  const toast = useToast();

  const canAssign = useAuthStore((s) => s.permissions.has('tasks.assign'));
  const showPicker = canAssign && !selfMode;

  // Only when the picker is visible AND the modal is open. In self mode the
  // assignee is the signed-in person, so the directory is not needed at all —
  // and an employee cannot read it anyway.
  const { data } = useEmployees({ pageSize: 100, status: 'active' }, showPicker && open);
  const create = useCreateTask();
  const update = useUpdateTask();
  const mutation = isEdit ? update : create;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      employeeId: '',
      title: '',
      description: '',
      startDate: '',
      dueDate: '',
      priority: 'medium',
    },
  });

  const priority = watch('priority');

  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    reset(
      task
        ? {
            employeeId: task.employeeId,
            title: task.title,
            description: task.description ?? '',
            startDate: task.startDate ?? '',
            dueDate: task.dueDate ?? '',
            priority: task.priority,
          }
        : {
            employeeId: selfMode ? (user?.employeeId ?? '') : '',
            title: '',
            description: '',
            startDate: '',
            dueDate: '',
            priority: 'medium',
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, selfMode]);

  function onSubmit(values: FormValues) {
    const onError = (err: unknown) => {
      if (err instanceof ApiException && err.fields) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof FormValues, { message });
        }
      }
    };

    if (isEdit && task) {
      update.mutate(
        {
          id: task.id,
          body: {
            title: values.title,
            description: values.description ?? '',
            // An empty date input is '', which is not the same as "no date".
            // Normalising to null keeps the contract honest.
            startDate: values.startDate || null,
            dueDate: values.dueDate || null,
            priority: values.priority,
          },
        },
        {
          onSuccess: () => {
            toast('Task updated');
            onOpenChange(false);
          },
          onError,
        },
      );
      return;
    }

    create.mutate(
      {
        employeeId: (selfMode ? user?.employeeId : values.employeeId) as EmployeeId,
        title: values.title,
        description: values.description ?? '',
        startDate: values.startDate || null,
        dueDate: values.dueDate || null,
        priority: values.priority,
        selfAssigned: Boolean(selfMode),
      },
      {
        onSuccess: () => {
          toast(selfMode ? 'Task added to your list' : 'Task assigned');
          onOpenChange(false);
        },
        onError,
      },
    );
  }

  const title = isEdit ? 'Edit task' : selfMode ? 'Add a task' : 'Assign a task';
  const description = isEdit
    ? `Changing "${task?.title}"`
    : selfMode
      ? 'Plan your own work. It appears on your dashboard alongside anything assigned to you.'
      : 'The person sees it on their dashboard and marks it done themselves.';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add task'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-space-base">
        {showPicker && (
          <FormField label="Assign to" error={errors.employeeId?.message} required>
            <select
              {...register('employeeId')}
              disabled={isEdit}
              className={inputCls(!!errors.employeeId)}
            >
              <option value="">Choose…</option>
              {data?.data.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.departmentName}
                </option>
              ))}
            </select>
            {isEdit && (
              <span className="font-label-sm text-label-sm text-zinc-400">
                Reassigning is not supported — close this and create a new task instead.
              </span>
            )}
          </FormField>
        )}

        <FormField label="Title" error={errors.title?.message} required>
          <input
            {...register('title')}
            className={inputCls(!!errors.title)}
            placeholder="Reconcile October vendor invoices"
          />
        </FormField>

        <FormField label="Description" error={errors.description?.message}>
          <textarea
            {...register('description')}
            rows={3}
            className="w-full rounded-xl border border-black/[0.08] bg-card px-space-md py-space-sm font-body-sm text-body-sm text-zinc-900 outline-none ring-indigo-200 placeholder:text-zinc-400 focus:ring-2"
            placeholder="Optional detail…"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-space-base sm:grid-cols-3">
          <FormField label="Start date" error={errors.startDate?.message}>
            <input type="date" {...register('startDate')} className={inputCls(!!errors.startDate)} />
            <span className="font-label-sm text-label-sm text-zinc-400">
              Needed for the timeline
            </span>
          </FormField>
          <FormField label="Due date" error={errors.dueDate?.message}>
            <input type="date" {...register('dueDate')} className={inputCls(!!errors.dueDate)} />
            <span className="font-label-sm text-label-sm text-zinc-400">
              Blank means no deadline
            </span>
          </FormField>
          <FormField label="Priority" error={errors.priority?.message}>
            <select {...register('priority')} className={inputCls()}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <span className="font-label-sm text-label-sm text-zinc-400">
              {PRIORITY_HELP[priority]}
            </span>
          </FormField>
        </div>
      </div>
    </Modal>
  );
}
