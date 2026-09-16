/**
 * src/features/attendance/ManualPunchModal.tsx
 *
 * Records a punch by hand — for the days the kiosk misses.
 *
 * Note that this creates a NEW punch event rather than editing an existing one.
 * There is no edit path anywhere in this system, by design. The event carries
 * source: 'manual', which surfaces as a "Manual" chip on the row, so anyone
 * reading the register can see which records a human entered.
 */

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import FormField, { inputCls } from '@/components/common/FormField';
import { useEmployees } from '@/features/employees/api';
import { useCreatePunch } from './api';
import { buildIdempotencyKey } from '@/domain/attendanceRules';
import { ApiException } from '@/lib/apiClient';
import { useToast } from '@/components/common/Toast';
import type { EmployeeId } from '@/contracts/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ManualPunchModal({ open, onOpenChange }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [time, setTime] = useState(format(new Date(), 'HH:mm'));

  // The modal is mounted whether or not it is open, so without this gate the
  // request fires for every visitor to the attendance page.
  const { data } = useEmployees({ pageSize: 100, status: 'active' }, open);
  const createPunch = useCreatePunch();
  const toast = useToast();

  useEffect(() => {
    if (open) createPunch.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    const ts = `${date}T${time}:00+05:30`;
    createPunch.mutate(
      {
        employeeId: employeeId as EmployeeId,
        direction,
        ts,
        source: 'manual',
        idempotencyKey: buildIdempotencyKey(employeeId, ts, direction),
      },
      {
        onSuccess: () => {
          toast(`Punch recorded at ${time}`);
          onOpenChange(false);
        },
      },
    );
  }

  const isDuplicate =
    createPunch.error instanceof ApiException &&
    createPunch.error.code === 'DUPLICATE_PUNCH';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Record a punch"
      description="Use this when the kiosk missed someone. The entry is marked as manual."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!employeeId || createPunch.isPending}>
            {createPunch.isPending ? 'Saving…' : 'Record punch'}
          </Button>
        </>
      }
    >
      {createPunch.error && (
        <div className="mb-space-base rounded-xl bg-red-50 px-space-md py-space-sm font-body-sm text-body-sm text-red-600">
          {isDuplicate
            ? 'A punch already exists for this person at this minute.'
            : (createPunch.error as Error).message}
        </div>
      )}

      <div className="flex flex-col gap-space-base">
        <FormField label="Employee" required>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={inputCls()}
          >
            <option value="">Choose…</option>
            {data?.data.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.empCode}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Direction" required>
          <div className="flex gap-space-sm">
            {(['IN', 'OUT'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={
                  direction === d
                    ? 'h-9 flex-1 rounded-xl bg-indigo-600 font-label-md text-label-md text-white'
                    : 'h-9 flex-1 rounded-xl bg-zinc-50 font-label-md text-label-md text-zinc-500 hover:bg-zinc-100'
                }
              >
                {d === 'IN' ? 'Check in' : 'Check out'}
              </button>
            ))}
          </div>
        </FormField>

        <div className="grid grid-cols-2 gap-space-base">
          <FormField label="Date" required>
            <input
              type="date"
              value={date}
              max={format(new Date(), 'yyyy-MM-dd')}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls()}
            />
          </FormField>
          <FormField label="Time" required>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={inputCls()}
            />
          </FormField>
        </div>
      </div>
    </Modal>
  );
}
