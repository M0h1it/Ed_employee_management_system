/**
 * src/features/employees/PinGenerator.tsx
 *
 * Generates a kiosk PIN for someone's login account and shows it exactly
 * once, in a modal, the same "shown once, never again" pattern as a device
 * registration code. There is nothing to poll or re-fetch afterward — the
 * server never returns the plain PIN again, only whether one exists
 * (mustChangePin, on the user record) and that is not surfaced here at all,
 * because this component's only job is generating a fresh one.
 *
 * WHY THIS NEEDS A LOGIN ACCOUNT, NOT JUST AN EMPLOYEE
 * -------------------------------------------------------
 * pin_hash lives on User, not Employee (see migration
 * 20260915_1100_kiosk_pin_and_device_ts.py) — the same place password_hash
 * lives. Someone with no login account has nothing for a PIN to attach to,
 * so the caller only renders this when employee.hasLogin is true and passes
 * the resolved User's id, not the employee's.
 */

import { useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';
import { apiClient, ApiException } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import type { Single } from '@/contracts/types';

interface PinGenerated {
  userId: string;
  pin: string;
  mustChangePin: boolean;
}

interface Props {
  userId: string;
  employeeName: string;
  /** Whether a PIN has ever been generated for this account already — drives
   * the green/checked indicator, the same pattern FaceEnrolment.tsx uses for
   * its own enrolled state. */
  hasPinSet: boolean;
  /** False when the viewer may not generate a PIN — pin.generate, not
   * users.manage, matching the backend's separate permission gate. */
  editable?: boolean;
}

export default function PinGenerator({ userId, employeeName, hasPinSet, editable = true }: Props) {
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Tracks "has a PIN now" for THIS session, seeded from the prop but
  // flipped locally the instant generate() succeeds — there is no
  // lightweight re-fetch that would tell us this sooner than the
  // response we already have in hand.
  const [justGenerated, setJustGenerated] = useState(false);
  const toast = useToast();
  const isSet = hasPinSet || justGenerated;

  async function generate() {
    setBusy(true);
    try {
      const response = await apiClient.post<Single<PinGenerated>>(EP.users.pin(userId));
      setReveal(response.data.pin);
      setJustGenerated(true);
      setConfirmOpen(false);
    } catch (error) {
      toast(
        error instanceof ApiException ? error.message : 'Could not generate a PIN.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!editable) return null;

  return (
    <>
      <div className="flex items-center justify-between gap-space-sm rounded-2xl border border-black/[0.06] bg-zinc-50 px-space-md py-space-sm">
        <div className="flex items-center gap-space-xs">
          <span className={isSet ? 'icon text-[18px] text-emerald-600' : 'icon text-[18px] text-zinc-400'}>
            {isSet ? 'verified_user' : 'password'}
          </span>
          <div className="flex flex-col">
            <span className="font-label-md text-label-md text-zinc-900">Kiosk PIN</span>
            <span className="font-label-sm text-label-sm text-zinc-400">
              {isSet
                ? 'A PIN is set for kiosk check-in.'
                : 'For offline check-in, or when face matching fails.'}
            </span>
          </div>
        </div>

        <Button variant="secondary" onClick={() => setConfirmOpen(true)} disabled={busy}>
          Generate PIN
        </Button>
      </div>

      {/* Confirm before overwriting — generating a new PIN immediately
          invalidates any PIN the person is currently using, same as an
          admin password reset. */}
      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Generate a new kiosk PIN?"
        description={`${employeeName}'s current PIN, if any, will stop working the moment a new one is generated.`}
        footer={
          <div className="flex justify-end gap-space-sm">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate PIN'}
            </Button>
          </div>
        }
      >
        <p className="font-body-sm text-body-sm text-zinc-500">
          The PIN is shown once, on the next screen. Write it down or share it with{' '}
          {employeeName} directly — it cannot be retrieved again after this.
        </p>
      </Modal>

      {/* The reveal — separate from the confirm dialog so closing THIS one
          cannot be mistaken for "cancel", after the PIN already exists. */}
      <Modal
        open={reveal !== null}
        onOpenChange={(open) => !open && setReveal(null)}
        title="New PIN generated"
        description={`Share this with ${employeeName} now. It will not be shown again.`}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setReveal(null)}>Done</Button>
          </div>
        }
      >
        <div className="flex items-center justify-center rounded-2xl bg-zinc-900 py-space-lg">
          <span className="font-mono-data text-[32px] tracking-[0.3em] text-white">
            {reveal}
          </span>
        </div>
        <p className="mt-space-sm font-label-sm text-label-sm text-zinc-400">
          {employeeName} will be asked to choose their own PIN the first time they use this one.
        </p>
      </Modal>
    </>
  );
}