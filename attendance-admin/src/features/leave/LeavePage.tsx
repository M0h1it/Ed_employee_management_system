/**
 * src/features/leave/LeavePage.tsx
 *
 * Leave requests: applying, and deciding.
 *
 * ONE ROUTE, THREE AUDIENCES
 * ---------------------------
 * An employee sees their own requests and an Apply button. Somebody with
 * leave.approve sees everyone's, with Approve and Reject. The difference comes
 * from permissions, not from a second page — two pages would drift apart and
 * every change would have to be made twice.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
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
import { useLeaves, useDecideLeave } from './api';
import LeaveForm from './LeaveForm';
import { ApiException } from '@/lib/apiClient';
import type { Leave, LeaveStatus } from '@/contracts/types';

const TYPE_LABELS: Record<string, string> = {
  casual: 'Casual',
  sick: 'Sick',
  earned: 'Earned',
  unpaid: 'Unpaid',
  comp_off: 'Comp off',
  planned: 'Planned leave',
  unplanned: 'Unplanned leave',
  emergency: 'Emergency',
};

function statusTone(status: LeaveStatus) {
  if (status === 'approved') return 'emerald';
  if (status === 'rejected') return 'red';
  if (status === 'cancelled') return 'slate';
  return 'amber';
}

export default function LeavePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);

  const user = useAuthStore((s) => s.user);
  const canViewAll = useCan('leave.view_all');
  const canApprove = useCan('leave.approve');
  const canApply = useCan('leave.apply');

  const confirm = useConfirm();
  const toast = useToast();
  const decide = useDecideLeave();

  const status = (searchParams.get('status') ?? '') as LeaveStatus | '';

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading } = useLeaves({
    status: status || undefined,
    employeeId: canViewAll ? undefined : 'me',
    pageSize: 100,
  });

  const rows = data?.data ?? [];
  const pending = rows.filter((r) => r.status === 'pending').length;

  async function act(leave: Leave, next: LeaveStatus) {
    const verb = next === 'approved' ? 'Approve' : next === 'rejected' ? 'Reject' : 'Cancel';

    const ok = await confirm({
      title: `${verb} this request?`,
      description:
        next === 'approved'
          ? `${leave.employeeName} will be marked as on leave for ${leave.days} working ` +
            `day${leave.days === 1 ? '' : 's'}, and those days will stop counting as absences.`
          : `${leave.employeeName}'s request from ${leave.fromDate} to ${leave.toDate} ` +
            `will be ${next}.`,
      confirmLabel: verb,
      tone: next === 'approved' ? 'default' : 'danger',
    });
    if (!ok) return;

    try {
      await decide.mutateAsync({ id: leave.id, status: next });
      toast(`Request ${next}`, 'success');
    } catch (error) {
      toast(error instanceof ApiException ? error.message : 'Could not update the request', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Leave"
        description={
          canViewAll
            ? 'Requests from across the company'
            : 'Your leave requests and their status'
        }
        actions={
          canApply ? <Button onClick={() => setFormOpen(true)}>Apply for leave</Button> : undefined
        }
      />

      <div className="mb-space-base flex flex-wrap items-center gap-space-sm">
        <div className="w-full sm:w-[200px]">
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(v) => setFilter('status', v)}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'cancelled', label: 'Cancelled' },
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
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-zinc-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="event_busy"
            title={status ? `No ${status} requests` : 'No leave requests'}
            description={
              canApply
                ? 'Apply for leave and it appears here for approval.'
                : 'Requests appear here once somebody applies.'
            }
          />
        ) : (
          <ul className="divide-y divide-black/[0.06]">
            {rows.map((leave) => {
              const isMine = leave.employeeId === user?.employeeId;
              // Nobody approves their own, whatever they hold — the check is
              // enforced on the server, and the buttons match it so people are
              // not offered an action that will be refused.
              const canDecide = canApprove && !isMine && leave.status === 'pending';
              const canCancel =
                isMine && (leave.status === 'pending' || leave.status === 'approved');

              return (
                <li
                  key={leave.id}
                  className="flex flex-wrap items-center gap-space-md px-space-base py-space-md"
                >
                  {canViewAll && (
                    <Avatar
                      name={leave.employeeName}
                      photoUrl={leave.employeePhotoUrl}
                      size="sm"
                    />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-space-xs">
                      {canViewAll && (
                        <span className="font-body-sm text-body-sm font-semibold text-zinc-800">
                          {leave.employeeName}
                        </span>
                      )}
                      <StatusPill tone={statusTone(leave.status) as never}>
                        {leave.status}
                      </StatusPill>
                      <span className="font-label-sm text-label-sm text-zinc-500">
                        {TYPE_LABELS[leave.type] ?? leave.type}
                      </span>
                    </div>

                    <span className="font-mono-data text-mono-data text-zinc-500">
                      {format(parseISO(leave.fromDate), 'dd MMM')} –{' '}
                      {format(parseISO(leave.toDate), 'dd MMM yyyy')} · {leave.days} working
                      day{leave.days === 1 ? '' : 's'}
                    </span>

                    {leave.reason && (
                      <span className="mt-0.5 truncate font-body-sm text-[12px] text-zinc-500">
                        {leave.reason}
                      </span>
                    )}

                    {leave.approvedByName && (
                      <span className="mt-0.5 font-label-sm text-label-sm text-zinc-400">
                        {leave.status} by {leave.approvedByName}
                        {leave.approvedAt
                          ? ` on ${format(parseISO(leave.approvedAt), 'dd MMM')}`
                          : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-space-xs">
                    {canDecide && (
                      <>
                        <Button variant="secondary" onClick={() => act(leave, 'rejected')}>
                          Reject
                        </Button>
                        <Button onClick={() => act(leave, 'approved')}>Approve</Button>
                      </>
                    )}
                    {canCancel && (
                      <Button variant="ghost" onClick={() => act(leave, 'cancelled')}>
                        Cancel
                      </Button>
                    )}
                    {isMine && canApprove && leave.status === 'pending' && (
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

      <LeaveForm open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  );
}