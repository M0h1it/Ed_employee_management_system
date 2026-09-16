/**
 * src/features/employees/EmployeeForm.tsx
 *
 * Create and edit, in one modal.
 *
 * WHY ONE COMPONENT FOR BOTH: the fields are identical and the only difference
 * is which mutation runs and what the button says. Two components would mean
 * every future field gets added twice, and eventually they drift.
 *
 * VALIDATION HAPPENS TWICE, ON PURPOSE
 * -------------------------------------
 * Zod validates in the browser so the user gets instant feedback without a
 * round trip. The server validates again because a browser form can be
 * bypassed entirely. Client validation is a convenience; server validation is
 * the actual rule. Notice how field errors returned by the server (422) are
 * pushed back into the form below — same display, different source.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import FormField, { inputCls } from '@/components/common/FormField';
import { ApiException } from '@/lib/apiClient';
import { useToast } from '@/components/common/Toast';
import { useCreateEmployee, useUpdateEmployee, useDepartments, useShifts } from './api';
import type { Employee } from '@/contracts/types';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Enter a valid email address'),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  departmentId: z.string().min(1, 'Choose a department'),
  position: z.string().min(2, 'Position is required'),
  shiftId: z.string().min(1, 'Choose a shift'),
  joinDate: z.string().min(1, 'Joining date is required'),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Passing an employee switches the form into edit mode. */
  employee?: Employee | null;
}

export default function EmployeeForm({ open, onOpenChange, employee }: Props) {
  const isEdit = Boolean(employee);

  const { data: deptData } = useDepartments();
  const { data: shiftData } = useShifts();

  const create = useCreateEmployee();
  const update = useUpdateEmployee(employee?.id ?? '');
  const mutation = isEdit ? update : create;
  const toast = useToast();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      departmentId: '',
      position: '',
      shiftId: 'shift-general',
      joinDate: new Date().toISOString().slice(0, 10),
    },
  });

  // Refill the form whenever the modal opens, so editing a second person does
  // not show the first person's values.
  useEffect(() => {
    if (!open) return;
    reset(
      employee
        ? {
            name: employee.name,
            email: employee.email,
            phone: employee.phone,
            departmentId: employee.departmentId,
            position: employee.position,
            shiftId: employee.shiftId,
            joinDate: employee.joinDate,
          }
        : {
            name: '',
            email: '',
            phone: '',
            departmentId: deptData?.data[0]?.id ?? '',
            position: '',
            shiftId: 'shift-general',
            joinDate: new Date().toISOString().slice(0, 10),
          },
    );
  }, [open, employee, deptData, reset]);

  function onSubmit(values: FormValues) {
    mutation.mutate(values, {
      onSuccess: () => {
        toast(isEdit ? `${values.name} updated` : `${values.name} added to the directory`);
        onOpenChange(false);
      },
      onError: (err) => {
        // Server-side field errors land in the same place as client ones.
        if (err instanceof ApiException && err.fields) {
          for (const [field, message] of Object.entries(err.fields)) {
            setError(field as keyof FormValues, { message });
          }
        }
      },
    });
  }

  const generalError =
    mutation.error instanceof ApiException && !mutation.error.fields
      ? mutation.error.message
      : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit employee' : 'Add employee'}
      description={
        isEdit
          ? `Updating ${employee?.name}`
          : 'A login account is created separately, under Access Control.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit(onSubmit)}
            disabled={mutation.isPending}
            icon={mutation.isPending ? undefined : 'check'}
          >
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create employee'}
          </Button>
        </>
      }
    >
      {generalError && (
        <div className="mb-space-base rounded-xl bg-red-50 px-space-md py-space-sm font-body-sm text-body-sm text-red-600">
          {generalError}
        </div>
      )}

      {/* No <form> tag: the submit button lives in the modal footer, outside
          this subtree, so handleSubmit is wired to its onClick instead. */}
      <div className="flex flex-col gap-space-base">
        <FormField label="Full name" error={errors.name?.message} required>
          <input {...register('name')} className={inputCls(!!errors.name)} placeholder="Karan Patel" />
        </FormField>

        <div className="grid grid-cols-2 gap-space-base">
          <FormField label="Email" error={errors.email?.message} required>
            <input
              {...register('email')}
              className={inputCls(!!errors.email)}
              placeholder="karan@company.com"
            />
          </FormField>
          <FormField label="Phone" error={errors.phone?.message} required>
            <input
              {...register('phone')}
              className={inputCls(!!errors.phone)}
              placeholder="9810012345"
              maxLength={10}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-space-base">
          <FormField label="Department" error={errors.departmentId?.message} required>
            <select {...register('departmentId')} className={inputCls(!!errors.departmentId)}>
              <option value="">Choose…</option>
              {deptData?.data.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Position" error={errors.position?.message} required>
            <input
              {...register('position')}
              className={inputCls(!!errors.position)}
              placeholder="Operations Executive"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-space-base">
          <FormField label="Shift" error={errors.shiftId?.message} required>
            <select {...register('shiftId')} className={inputCls(!!errors.shiftId)}>
              {shiftData?.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.startTime}–{s.endTime})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Joining date" error={errors.joinDate?.message} required>
            <input type="date" {...register('joinDate')} className={inputCls(!!errors.joinDate)} />
          </FormField>
        </div>
      </div>
    </Modal>
  );
}
