/**
 * src/features/users/UsersPage.tsx
 *
 * Access control: who can sign in, as what, and whether they still can.
 *
 * Disabling is a toggle, not a delete. Deleting the account would orphan the
 * audit trail — the attendance history has to keep pointing at someone. This is
 * the same reason the employee record has a status instead of being removed.
 */

import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { ColumnDef } from '@tanstack/react-table';
import PageHeader from '@/components/common/PageHeader';
import DataTable from '@/components/common/DataTable';
import SearchInput from '@/components/common/SearchInput';
import Select from '@/components/common/Select';
import Avatar from '@/components/common/Avatar';
import Chip from '@/components/common/Chip';
import Button from '@/components/common/Button';
import UserForm from './UserForm';
import ResetPasswordModal from './ResetPasswordModal';
import ChangeRoleModal from './ChangeRoleModal';
import { useUsers, useSetUserStatus } from './api';
import { useRoles } from '@/features/roles/api';
import { ApiException } from '@/lib/apiClient';
import { useCan } from '@/lib/rbac';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import type { User } from '@/contracts/types';

const PAGE_SIZE = 20;

export default function UsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [changingRole, setChangingRole] = useState<User | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const search = searchParams.get('search') ?? '';
  const roleId = searchParams.get('roleId') ?? '';
  const page = Number(searchParams.get('page') ?? 1);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading } = useUsers({
    search: search || undefined,
    roleId: (roleId || undefined) as any,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: roleData } = useRoles();
  const setStatus = useSetUserStatus();
  const canChangeRole = useCan('users.change_role');

  const columns = useMemo<ColumnDef<User, any>[]>(
    () => [
      {
        id: 'user',
        header: 'Account',
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex items-center gap-space-sm">
              <Avatar name={u.employeeName} photoUrl={u.employeePhotoUrl} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-zinc-900">{u.employeeName}</span>
                <span className="font-mono-data text-mono-data text-zinc-400">
                  {u.username}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: 'role',
        header: 'Role',
        cell: ({ row }) => (
          <div className="flex items-center gap-space-xs">
            <Chip>{row.original.roleName}</Chip>
            {canChangeRole && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setChangingRole(row.original);
                }}
                aria-label={`Change ${row.original.employeeName}'s role`}
                title="Change role"
                className="rounded-lg p-1 text-zinc-300 hover:bg-indigo-50 hover:text-indigo-600"
              >
                <span className="icon text-[15px]">swap_horiz</span>
              </button>
            )}
          </div>
        ),
      },
      {
        id: 'lastLogin',
        header: 'Last sign-in',
        cell: ({ row }) =>
          row.original.lastLoginAt ? (
            <span className="text-zinc-500">
              {formatDistanceToNow(parseISO(row.original.lastLoginAt), { addSuffix: true })}
            </span>
          ) : (
            <span className="text-zinc-400">Never</span>
          ),
      },
      {
        id: 'flags',
        header: '',
        cell: ({ row }) =>
          row.original.mustChangePassword ? (
            <Chip tone="warning">Must change password</Chip>
          ) : null,
      },
      {
        id: 'status',
        header: 'Active',
        cell: ({ row }) => {
          const u = row.original;
          return (
            <button
              role="switch"
              aria-checked={u.isActive}
              aria-label={`${u.isActive ? 'Disable' : 'Enable'} ${u.employeeName}'s account`}
              onClick={async (e) => {
                e.stopPropagation();
                setErrorMessage(null);

                // Only disabling asks. Re-enabling is harmless and reversible,
                // so making people confirm it just trains them to click through.
                if (u.isActive) {
                  const ok = await confirm({
                    title: `Disable ${u.employeeName}'s login?`,
                    description:
                      'They will not be able to sign in. Their attendance history and tasks are kept.',
                    confirmLabel: 'Disable access',
                    tone: 'danger',
                  });
                  if (!ok) return;
                }

                setStatus.mutate(
                  { id: u.id, isActive: !u.isActive },
                  {
                    onSuccess: () =>
                      toast(
                        u.isActive
                          ? `${u.employeeName}'s access disabled`
                          : `${u.employeeName}'s access restored`,
                        u.isActive ? 'info' : 'success',
                      ),
                    onError: (err) =>
                      setErrorMessage(
                        err instanceof ApiException ? err.message : 'Could not update the account.',
                      ),
                  },
                );
              }}
              className={
                u.isActive
                  ? 'h-5 w-9 rounded-full bg-indigo-600 p-0.5 transition-colors'
                  : 'h-5 w-9 rounded-full bg-zinc-100 p-0.5 transition-colors'
              }
            >
              <span
                className={
                  u.isActive
                    ? 'block h-4 w-4 translate-x-4 rounded-[50%] bg-white transition-transform'
                    : 'block h-4 w-4 rounded-[50%] bg-zinc-400 transition-transform'
                }
              />
            </button>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setResetting(row.original);
            }}
            className="rounded-xl bg-zinc-50 px-space-sm py-space-xxs font-label-sm text-label-sm text-zinc-500 hover:bg-zinc-100"
          >
            Reset password
          </button>
        ),
      },
    ],
    [setStatus, confirm, toast, canChangeRole],
  );

  return (
    <>
      <PageHeader
        title="Access Control"
        description="Login accounts, roles and passwords"
        actions={
          <Button icon="person_add" onClick={() => setCreateOpen(true)}>
            Create login
          </Button>
        }
      />

      {errorMessage && (
        <div className="mb-space-base rounded-2xl bg-red-50 px-space-base py-space-md font-body-sm text-body-sm text-red-600">
          {errorMessage}
        </div>
      )}

      <div className="mb-space-base flex flex-wrap items-center gap-space-sm">
        <div className="w-full min-w-[200px] sm:flex-1">
          <SearchInput
            value={search}
            onChange={(v) => setFilter('search', v)}
            placeholder="Search by name or username…"
          />
        </div>
        <div className="w-full sm:w-[180px]">
          <Select
            aria-label="Filter by role"
            value={roleId}
            onChange={(v) => setFilter('roleId', v)}
            options={roleData?.data.map((r) => ({ value: r.id, label: r.name })) ?? []}
            placeholder="All roles"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        total={data?.meta.total ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => setFilter('page', String(p))}
        emptyTitle="No login accounts match"
        emptyDescription="Employees without a login can still be recorded at the kiosk."
      />

      <UserForm open={createOpen} onOpenChange={setCreateOpen} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
      <ChangeRoleModal user={changingRole} onClose={() => setChangingRole(null)} />
    </>
  );
}
