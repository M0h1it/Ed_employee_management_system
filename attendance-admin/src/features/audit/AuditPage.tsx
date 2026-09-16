/**
 * src/features/audit/AuditPage.tsx
 *
 * Who changed what, and what it looked like before.
 *
 * READ ONLY — AND THAT IS THE FEATURE
 * ------------------------------------
 * There is no edit, no delete, no bulk action. The other five levels of the
 * access model stop the wrong action; this one answers the question afterwards,
 * once somebody with legitimate access has done something they should not have.
 *
 * That only works if the record cannot be altered by the person being traced.
 * No endpoint exists to write or erase a row, and nothing here offers to.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import clsx from 'clsx';
import PageHeader from '@/components/common/PageHeader';
import SearchInput from '@/components/common/SearchInput';
import Select from '@/components/common/Select';
import Avatar from '@/components/common/Avatar';
import StatusPill from '@/components/common/StatusPill';
import EmptyState from '@/components/common/EmptyState';
import { useAuditLog, useAuditActions } from './api';
import type { AuditEntry } from '@/contracts/types';

const PAGE_SIZE = 25;

/**
 * Tone by consequence, not by category.
 *
 * A role change and a password reset are the two actions somebody would most
 * want to find months later; a login is background. Colouring every action
 * differently would give fifteen equally loud rows and highlight nothing.
 */
function toneFor(action: string) {
  if (action.startsWith('auth.token_reuse') || action.startsWith('auth.lockout')) return 'red';
  if (action.includes('change_role') || action.includes('reset_password')) return 'amber';
  if (action.startsWith('role.') || action.startsWith('settings.')) return 'indigo';
  if (action.startsWith('user.')) return 'indigo';
  return 'slate';
}

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.lockout': 'Account locked',
  'auth.token_reuse': 'Token reuse detected',
  'user.create': 'Login created',
  'user.disable': 'Access disabled',
  'user.enable': 'Access restored',
  'user.reset_password': 'Password reset',
  'user.change_role': 'Role changed',
  'role.create': 'Role created',
  'role.update': 'Role permissions changed',
  'role.delete': 'Role deleted',
  'employee.create': 'Employee added',
  'employee.update': 'Employee edited',
  'punch.manual': 'Punch entered by hand',
  'settings.update': 'Attendance policy changed',
};

/** Renders the before/after diff as one line per changed field. */
function Diff({ entry }: { entry: AuditEntry }) {
  const keys = Array.from(
    new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  );

  if (keys.length === 0) {
    return <span className="font-label-sm text-label-sm text-zinc-400">No detail recorded</span>;
  }

  return (
    <dl className="flex flex-col gap-space-xxs">
      {keys.map((key) => {
        const from = entry.before?.[key];
        const to = entry.after?.[key];
        const changed = entry.before !== null && entry.after !== null && from !== to;

        return (
          <div key={key} className="flex flex-wrap items-baseline gap-space-xs">
            <dt className="font-label-sm text-label-sm text-zinc-400">{key}</dt>
            <dd className="flex flex-wrap items-baseline gap-space-xs font-mono-data text-mono-data">
              {changed && (
                <>
                  <span className="text-zinc-400 line-through">{String(from)}</span>
                  <span className="text-zinc-300">→</span>
                </>
              )}
              <span
                className={clsx(
                  String(to ?? from) === '[redacted]' ? 'italic text-zinc-400' : 'text-zinc-800',
                )}
              >
                {String(to ?? from)}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export default function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  const action = searchParams.get('action') ?? '';
  const search = searchParams.get('search') ?? '';
  const page = Number(searchParams.get('page') ?? 1);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading } = useAuditLog({
    action: action || undefined,
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: actionData } = useAuditActions();

  const rows = data?.data ?? [];

  // Grouped by prefix, so the filter offers "user" as well as "user.disable".
  const actionOptions = [
    ...Array.from(
      new Set((actionData?.data ?? []).map((a) => a.action.split('.')[0])),
    ).map((group) => ({ value: group, label: `All ${group}` })),
    ...(actionData?.data ?? []).map((a) => ({
      value: a.action,
      label: `${ACTION_LABELS[a.action] ?? a.action} (${a.count})`,
    })),
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change, who made it, and what it looked like before"
      />

      <div className="mb-space-base flex flex-wrap items-center gap-space-sm">
        <div className="w-full min-w-[200px] sm:flex-1">
          <SearchInput
            value={search}
            onChange={(v) => setFilter('search', v)}
            placeholder="Search by action or record id…"
          />
        </div>
        <div className="w-full sm:w-[240px]">
          <Select
            aria-label="Filter by action"
            value={action}
            onChange={(v) => setFilter('action', v)}
            options={actionOptions}
            placeholder="All actions"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-card shadow-xs">
        {isLoading ? (
          <div className="space-y-space-xs p-space-base">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="history"
            title="Nothing recorded yet"
            description="Changes appear here as they happen. The log cannot be edited."
          />
        ) : (
          <ol className="divide-y divide-black/[0.06]">
            {rows.map((entry) => {
              const isOpen = expanded === entry.id;
              return (
                <li key={entry.id}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : entry.id)}
                    className="flex w-full items-center gap-space-md px-space-base py-space-md text-left hover:bg-zinc-50"
                  >
                    <Avatar name={entry.actorName} size="sm" />

                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex flex-wrap items-center gap-space-xs">
                        <span className="font-body-sm text-body-sm font-semibold text-zinc-800">
                          {entry.actorName}
                        </span>
                        <StatusPill tone={toneFor(entry.action) as any}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </StatusPill>
                      </div>
                      <span className="truncate font-mono-data text-mono-data text-zinc-400">
                        {entry.entity} · {entry.entityId.slice(0, 8)}
                        {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                      </span>
                    </div>

                    {/* Relative time is what people scan for; the exact stamp
                        is one click away in the detail below. */}
                    <span
                      title={format(parseISO(entry.createdAt), 'dd MMM yyyy, HH:mm:ss')}
                      className="shrink-0 font-mono-data text-mono-data text-zinc-400"
                    >
                      {formatDistanceToNow(parseISO(entry.createdAt), { addSuffix: true })}
                    </span>

                    <span className="icon shrink-0 text-[18px] text-zinc-300">
                      {isOpen ? 'expand_less' : 'expand_more'}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-black/[0.06] bg-zinc-50 px-space-base py-space-md">
                      <div className="grid gap-space-base sm:grid-cols-[minmax(0,1fr)_200px]">
                        <Diff entry={entry} />
                        <dl className="flex flex-col gap-space-xxs font-mono-data text-mono-data text-zinc-500">
                          <div>{format(parseISO(entry.createdAt), 'dd MMM yyyy, HH:mm:ss')}</div>
                          <div>{entry.action}</div>
                          <div className="break-all">{entry.entityId}</div>
                          {entry.ipAddress && <div>{entry.ipAddress}</div>}
                        </dl>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-black/[0.06] px-space-base py-space-sm">
            <span className="font-label-sm text-label-sm text-zinc-500">
              Showing {rows.length} of {data.meta.total}
            </span>
            <div className="flex items-center gap-space-sm">
              <button
                disabled={page <= 1}
                onClick={() => setFilter('page', String(page - 1))}
                className="h-7 rounded-xl bg-zinc-50 px-space-md font-label-sm text-label-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="font-mono-data text-mono-data text-zinc-500">
                {page} / {data.meta.totalPages}
              </span>
              <button
                disabled={page >= data.meta.totalPages}
                onClick={() => setFilter('page', String(page + 1))}
                className="h-7 rounded-xl bg-zinc-50 px-space-md font-label-sm text-label-sm text-zinc-500 hover:bg-zinc-100 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
