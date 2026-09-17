/**
 * src/features/corrections/CorrectionsPage.tsx
 *
 * Correction requests, and deciding them.
 */

import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import Button from '@/components/common/Button';
import Select from '@/components/common/Select';
import Avatar from '@/components/common/Avatar';
import StatusPill from '@/components/common/StatusPill';
import EmptyState from '@/components/common/EmptyState';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import { useCan } from '@/lib/rbac';
import { useAuthStore } from '@/stores/authStore';
import { useCorrections, useDecideCorrection } from './api';
import CorrectionDetailModal from './CorrectionDetailModal';
import { ApiException } from '@/lib/apiClient';
import type { Correction, CorrectionStatus } from '@/contracts/types';

function tone(status: CorrectionStatus) {
  if (status === 'approved') return 'emerald';
  if (status === 'rejected') return 'red';
  if (status === 'cancelled') return 'slate';
  return 'amber';
}

function time(iso: string | null) {
  return iso ? format(parseISO(iso), 'HH:mm') : '—';
}

export default function CorrectionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const canViewAll = useCan('corrections.view_all');
  const canApprove = useCan('corrections.approve');

  const confirm = useConfirm();
  const toast = useToast();
  const decide = useDecideCorrection();
  const [viewing, setViewing] = useState<Correction | null>(null);

  const status = (searchParams.get('status') ?? '') as CorrectionStatus | '';
  const { data, isLoading } = useCorrections({
    status: status || undefined,
    pageSize: 100,
  });

  const rows = data?.data ?? [];
  const pending = rows.filter((r) => r.status === 'pending').length;

  async function act(row: Correction, next: CorrectionStatus) {
    const verb = next === 'approved' ? 'Approve' : next === 'rejected' ? 'Reject' : 'Withdraw';

    const ok = await confirm({
      title: `${verb} this correction?`,
      description:
        next === 'approved'
          ? `${row.employeeName}'s hours for ${format(parseISO(row.date), 'd MMMM')} will be ` +
            `recalculated from the corrected times. The original punches are not changed, ` +
            `and the day will be marked as manually adjusted.`
          : `The request will be ${next}. Nothing about the attendance record changes.`,
      confirmLabel: verb,
      tone: next === 'approved' ? 'default' : 'danger',
    });
    if (!ok) return;

    try {
      await decide.mutateAsync({ id: row.id, status: next });
      toast(`Correction ${next}`, 'success');
    } catch (error) {
      toast(error instanceof ApiException ? error.message : 'Could not update it', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Corrections"
        description={
          canViewAll
            ? 'Requests to fix a mistaken or missing punch'
            : 'Your correction requests and their status'
        }
      />

      <div className="mb-space-base flex flex-wrap items-center gap-space-sm">
        <div className="w-full sm:w-[200px]">
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(v) => {
              const next = new URLSearchParams(searchParams);
              if (v) next.set('status', v);
              else next.delete('status');
              setSearchParams(next, { replace: true });
            }}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'cancelled', label: 'Withdrawn' },
            ]}
            placeholder="All statuses"
          />
        </div>
        {canApprove && pending > 0 && (
          <span className="font-label-sm text-label-sm text-amber-700">
            {pending} waiting for a decision
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-card shadow-xs">
        {isLoading ? (
          <div className="space-y-space-xs p-space-base">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="edit_calendar"
            title="No corrections"
            description="Open a day on the attendance register and ask for a fix if a punch was missed."
          />
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {rows.map((row) => {
              const isMine = row.employeeId === user?.employeeId;
              const canDecide = canApprove && !isMine && row.status === 'pending';
              const canWithdraw = isMine && row.status === 'pending';

              return (
                <li key={row.id} className="flex flex-wrap items-start gap-space-md px-space-base py-space-md">
                  {canViewAll && (
                    <Avatar name={row.employeeName} photoUrl={row.employeePhotoUrl} size="sm" />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-space-xxs">
                    <div className="flex flex-wrap items-center gap-space-xs">
                      {canViewAll && (
                        <span className="font-body-sm text-body-sm font-semibold text-zinc-800">
                          {row.employeeName}
                        </span>
                      )}
                      <span className="font-mono-data text-mono-data text-zinc-500">
                        {format(parseISO(row.date), 'EEE d MMM yyyy')}
                      </span>
                      <StatusPill tone={tone(row.status) as never}>{row.status}</StatusPill>
                    </div>

                    {/* The change, not just the proposal. Two numbers. */}
                    <div className="flex flex-wrap items-center gap-space-xs font-mono-data text-mono-data">
                      <span className="text-zinc-400 line-through">
                        {time(row.currentIn)} – {time(row.currentOut)}
                      </span>
                      <span className="text-zinc-300">→</span>
                      <span className="font-semibold text-zinc-900">
                        {time(row.proposedIn ?? row.currentIn)} –{' '}
                        {time(row.proposedOut ?? row.currentOut)}
                      </span>
                    </div>

                    <p className="font-body-sm text-[12px] text-zinc-500">{row.reason}</p>

                    <span className="font-label-sm text-label-sm text-zinc-400">
                      Requested by {row.requestedByName}
                      {row.approvedByName
                        ? ` · ${row.status} by ${row.approvedByName}`
                        : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-space-xs">
                    <Button variant="ghost" onClick={() => setViewing(row)}>
                      View
                    </Button>
                    {canDecide && (
                      <>
                        <Button variant="secondary" onClick={() => act(row, 'rejected')}>
                          Reject
                        </Button>
                        <Button onClick={() => act(row, 'approved')}>Approve</Button>
                      </>
                    )}
                    {canWithdraw && (
                      <Button variant="ghost" onClick={() => act(row, 'cancelled')}>
                        Withdraw
                      </Button>
                    )}
                    {isMine && canApprove && row.status === 'pending' && (
                      <span className="font-label-sm text-label-sm text-zinc-400">
                        Needs someone else
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CorrectionDetailModal correction={viewing} onClose={() => setViewing(null)} />
    </>
  );
}