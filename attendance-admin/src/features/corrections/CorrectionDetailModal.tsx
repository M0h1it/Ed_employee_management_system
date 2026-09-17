/**
 * src/features/corrections/CorrectionDetailModal.tsx
 *
 * Full detail for one correction — everything the compact list row has to
 * leave out: the full reason text, the exact register state at request
 * time (currentIn/currentOut — now a real snapshot, not a live
 * recomputation, see the backend's own correction snapshot migration),
 * when the request was made, and when it was decided.
 */

import { format, parseISO } from 'date-fns';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Avatar from '@/components/common/Avatar';
import StatusPill, { type PillTone } from '@/components/common/StatusPill';
import type { Correction, CorrectionStatus } from '@/contracts/types';

interface Props {
  correction: Correction | null;
  onClose: () => void;
}

function fmtTime(iso: string | null): string {
  return iso ? format(parseISO(iso), 'HH:mm') : '—';
}

function fmtDateTime(iso: string | null): string {
  return iso ? format(parseISO(iso), 'dd MMM yyyy, hh:mm a') : '—';
}

function statusTone(status: CorrectionStatus): PillTone {
  if (status === 'approved') return 'emerald';
  if (status === 'rejected') return 'red';
  if (status === 'cancelled') return 'slate';
  return 'amber';
}

export default function CorrectionDetailModal({ correction, onClose }: Props) {
  return (
    <Modal
      open={correction !== null}
      onOpenChange={(open) => !open && onClose()}
      title={correction ? `Correction — ${correction.employeeName}` : 'Correction'}
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {correction && (
        <div className="flex flex-col gap-space-base">
          <div className="flex items-center gap-space-sm">
            <Avatar name={correction.employeeName} photoUrl={correction.employeePhotoUrl} size="sm" />
            <span className="font-body-sm text-body-sm font-semibold text-zinc-800">
              {correction.employeeName}
            </span>
            <StatusPill tone={statusTone(correction.status)}>{correction.status}</StatusPill>
          </div>

          <div>
            <p className="font-label-sm text-label-sm text-zinc-400">Date</p>
            <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
              {format(parseISO(correction.date), 'EEEE d MMMM yyyy')}
            </p>
          </div>

          <div>
            <p className="mb-space-xs font-label-sm text-label-sm text-zinc-400">
              Register at the time this was requested → proposed
            </p>
            <div className="flex flex-wrap items-center gap-space-xs rounded-xl bg-zinc-50 px-space-md py-space-sm font-mono-data text-mono-data">
              <span className="text-zinc-400 line-through">
                {fmtTime(correction.currentIn)} – {fmtTime(correction.currentOut)}
              </span>
              <span className="text-zinc-300">→</span>
              <span className="font-semibold text-zinc-900">
                {fmtTime(correction.proposedIn ?? correction.currentIn)} –{' '}
                {fmtTime(correction.proposedOut ?? correction.currentOut)}
              </span>
            </div>
          </div>

          <div>
            <p className="font-label-sm text-label-sm text-zinc-400">Reason given</p>
            <p className="mt-space-xxs whitespace-pre-wrap font-body-sm text-body-sm text-zinc-700">
              {correction.reason}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-space-base gap-y-space-sm rounded-xl bg-zinc-50 p-space-md">
            <div>
              <p className="font-label-sm text-label-sm text-zinc-400">Requested by</p>
              <p className="mt-space-xxs font-body-sm text-body-sm text-zinc-800">
                {correction.requestedByName}
              </p>
            </div>
            <div>
              <p className="font-label-sm text-label-sm text-zinc-400">Requested at</p>
              <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                {fmtDateTime(correction.createdAt)}
              </p>
            </div>
            {correction.approvedByName && (
              <>
                <div>
                  <p className="font-label-sm text-label-sm text-zinc-400">
                    {correction.status === 'rejected' ? 'Rejected by' : 'Approved by'}
                  </p>
                  <p className="mt-space-xxs font-body-sm text-body-sm text-zinc-800">
                    {correction.approvedByName}
                  </p>
                </div>
                <div>
                  <p className="font-label-sm text-label-sm text-zinc-400">Decided at</p>
                  <p className="mt-space-xxs font-mono-data text-mono-data text-zinc-800">
                    {fmtDateTime(correction.approvedAt)}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}