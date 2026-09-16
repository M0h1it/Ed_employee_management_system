/**
 * src/features/corrections/CorrectionForm.tsx
 *
 * Asking for a mistaken or missing punch to be fixed.
 *
 * The form shows what the register currently says next to the proposed time,
 * because the request is a CHANGE and a change needs two numbers. "I was in at
 * 08:30" reads very differently from "the kiosk says 09:17, and I was in at
 * 08:30".
 */

import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import FormField, { inputCls } from '@/components/common/FormField';
import { useToast } from '@/components/common/Toast';
import { useRequestCorrection } from './api';
import { ApiException } from '@/lib/apiClient';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The day being corrected, and what the register says about it. */
  date: string;
  employeeId: string;
  employeeName: string;
  currentIn: string | null;
  currentOut: string | null;
}

function timeOnly(iso: string | null): string {
  return iso ? format(parseISO(iso), 'HH:mm') : '';
}

export default function CorrectionForm({
  open,
  onClose,
  date,
  employeeId,
  employeeName,
  currentIn,
  currentOut,
}: Props) {
  const [proposedIn, setProposedIn] = useState('');
  const [proposedOut, setProposedOut] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const request = useRequestCorrection();
  const toast = useToast();

  useEffect(() => {
    if (open) {
      // Pre-filled with what is there now, so somebody fixing only the OUT does
      // not have to retype an IN that was already right.
      setProposedIn(timeOnly(currentIn));
      setProposedOut(timeOnly(currentOut));
      setReason('');
      setError(null);
    }
  }, [open, currentIn, currentOut]);

  const inChanged = proposedIn !== timeOnly(currentIn);
  const outChanged = proposedOut !== timeOnly(currentOut);
  const nothingChanged = !inChanged && !outChanged;

  async function submit() {
    setError(null);
    try {
      await request.mutateAsync({
        employeeId: employeeId as never,
        date: date as never,
        reason: reason.trim(),
        // ONLY the times that actually changed are sent. A correction that
        // re-states an unchanged IN would overwrite a measured punch with a
        // typed one for no reason, and mark it as manual.
        proposedIn: inChanged && proposedIn ? (`${date}T${proposedIn}:00` as never) : null,
        proposedOut: outChanged && proposedOut ? (`${date}T${proposedOut}:00` as never) : null,
      });
      toast('Correction requested. Somebody else has to approve it.', 'success');
      onClose();
    } catch (err) {
      if (err instanceof ApiException) {
        setError(err.fields?.date ?? err.fields?.reason ?? err.message);
        return;
      }
      setError('Could not submit the request');
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Request a correction"
      description={`${employeeName} · ${format(parseISO(date), 'EEEE d MMMM yyyy')}`}
    >
      <div className="flex flex-col gap-space-base">
        <div className="rounded-xl bg-zinc-50 px-space-base py-space-sm">
          <p className="font-label-sm text-label-sm text-zinc-400">The register currently says</p>
          <p className="mt-0.5 font-mono-data text-[14px] text-zinc-800">
            {timeOnly(currentIn) || '—'} to {timeOnly(currentOut) || '—'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-space-base">
          <FormField label="Correct in time">
            <input
              type="time"
              value={proposedIn}
              onChange={(e) => setProposedIn(e.target.value)}
              className={inputCls()}
            />
          </FormField>
          <FormField label="Correct out time">
            <input
              type="time"
              value={proposedOut}
              onChange={(e) => setProposedOut(e.target.value)}
              className={inputCls()}
            />
          </FormField>
        </div>

        <FormField label="What happened" error={error ?? undefined}>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="The reader did not pick me up when I arrived"
            className={inputCls(!!error)}
          />
          <span className="font-label-sm text-label-sm text-zinc-400">
            Whoever approves this sees the reason, so be specific
          </span>
        </FormField>

        {/* The original punches are never touched, and saying so here is the
            point: people assume a correction rewrites the record. */}
        <p className="rounded-xl bg-indigo-50 px-space-base py-space-sm font-label-sm text-label-sm text-indigo-700">
          The original punches stay exactly as the kiosk recorded them. A correction
          is layered on top, and someone else has to approve it.
        </p>

        <div className="flex justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={nothingChanged || reason.trim().length < 5 || request.isPending}
          >
            {request.isPending ? 'Submitting…' : 'Request correction'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
