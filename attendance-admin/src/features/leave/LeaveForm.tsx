/**
 * src/features/leave/LeaveForm.tsx
 *
 * Applying for leave.
 */

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { addDays, eachDayOfInterval, format, isWeekend, parseISO } from 'date-fns';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import FormField, { inputCls } from '@/components/common/FormField';
import Select from '@/components/common/Select';
import { useToast } from '@/components/common/Toast';
import { useAuthStore } from '@/stores/authStore';
import { useCan } from '@/lib/rbac';
import { useEmployees } from '@/features/employees/api';
import { useApplyLeave, useHolidays } from './api';
import { ApiException } from '@/lib/apiClient';

const schema = z
  .object({
    employeeId: z.string().optional(),
    fromDate: z.string().min(1, 'Choose a start date'),
    toDate: z.string().min(1, 'Choose an end date'),
    type: z.enum(['casual', 'sick', 'earned', 'unpaid', 'comp_off']),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    path: ['toDate'],
    message: 'The end date cannot be before the start date',
  });

type Values = z.infer<typeof schema>;

const TYPES = [
  { value: 'casual', label: 'Casual' },
  { value: 'sick', label: 'Sick' },
  { value: 'earned', label: 'Earned' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'comp_off', label: 'Comp off' },
];

export default function LeaveForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const canApproveOthers = useCan('leave.approve');
  const toast = useToast();
  const apply = useApplyLeave();

  // Only for somebody filing on another person's behalf. An employee applying
  // for themselves never sees a picker, so the directory is never requested —
  // which they are not permitted to read anyway.
  const { data: employeeData } = useEmployees(
    { pageSize: 100, status: 'active' },
    canApproveOthers && open,
  );

  const { data: holidayData } = useHolidays(new Date().getFullYear());

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      employeeId: '',
      fromDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      toDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      type: 'casual',
      reason: '',
    },
  });

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const fromDate = watch('fromDate');
  const toDate = watch('toDate');

  /**
   * The working-day count, shown live.
   *
   * Computed the same way the server does — weekends and holidays excluded.
   * Somebody picking Friday to Monday should see "2 days" before they submit,
   * not discover it in the approved record afterwards.
   */
  const workingDays = useMemo(() => {
    if (!fromDate || !toDate || toDate < fromDate) return 0;
    const holidays = new Set((holidayData?.data ?? []).map((h) => h.date));
    return eachDayOfInterval({ start: parseISO(fromDate), end: parseISO(toDate) }).filter(
      (d) => !isWeekend(d) && !holidays.has(format(d, 'yyyy-MM-dd')),
    ).length;
  }, [fromDate, toDate, holidayData]);

  async function onSubmit(values: Values) {
    try {
      await apply.mutateAsync({
        employeeId: values.employeeId || undefined,
        fromDate: values.fromDate,
        toDate: values.toDate,
        type: values.type,
        reason: values.reason ?? '',
      } as never);
      toast('Leave request submitted', 'success');
      onClose();
    } catch (error) {
      if (error instanceof ApiException) {
        // Server field errors land next to the same inputs the client-side
        // rules use, so there is one place a person looks for what is wrong.
        if (error.fields) {
          for (const [field, message] of Object.entries(error.fields)) {
            setError(field as keyof Values, { message });
          }
          return;
        }
        toast(error.message, 'error');
        return;
      }
      toast('Could not submit the request', 'error');
    }
  }

  return (
    <Modal
      open={open}
      // onOpenChange, not onClose. Radix calls this with `false` when the X,
      // Escape, or a backdrop click closes the dialog — passing the wrong prop
      // name left the X wired to nothing, which TypeScript did not catch
      // because the component's props are structurally satisfied either way.
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Apply for leave"
      description="Weekends and company holidays are not counted against the request."
    >
      <div className="flex flex-col gap-space-base">
        {canApproveOthers && (
          <FormField label="For" error={errors.employeeId?.message}>
            <select {...register('employeeId')} className={inputCls()}>
              <option value="">Myself ({user?.name})</option>
              {(employeeData?.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <span className="font-label-sm text-label-sm text-zinc-400">
              Filing on someone's behalf still needs a separate approval
            </span>
          </FormField>
        )}

        <div className="grid grid-cols-2 gap-space-base">
          <FormField label="From" error={errors.fromDate?.message}>
            <input type="date" {...register('fromDate')} className={inputCls(!!errors.fromDate)} />
          </FormField>
          <FormField label="To" error={errors.toDate?.message}>
            <input type="date" {...register('toDate')} className={inputCls(!!errors.toDate)} />
          </FormField>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-space-base py-space-sm">
          <span className="font-label-sm text-label-sm text-zinc-500">Working days</span>
          <span className="font-mono-data text-[15px] font-semibold text-zinc-900">
            {workingDays}
          </span>
        </div>
        <p className="-mt-space-sm font-label-sm text-label-sm text-zinc-400">
          Weekends and company holidays are not counted.
        </p>

        <FormField label="Type" error={errors.type?.message}>
          <select {...register('type')} className={inputCls()}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Reason" error={errors.reason?.message}>
          <textarea
            rows={3}
            {...register('reason')}
            placeholder="Optional, but it helps whoever approves this"
            className={inputCls()}
          />
        </FormField>

        <div className="flex justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting || workingDays === 0}
          >
            {isSubmitting ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
