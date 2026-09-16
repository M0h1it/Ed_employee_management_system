/**
 * src/features/users/ChangeRoleModal.tsx
 *
 * Moves one person to a different role.
 *
 * The dropdown only lists roles the signed-in person is ALLOWED to assign, and
 * that list comes from the server rather than being filtered here. The same
 * rule is then re-checked when the request lands — the list is a convenience,
 * the check is the control.
 */

import { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Avatar from '@/components/common/Avatar';
import Chip from '@/components/common/Chip';
import FormField, { inputCls } from '@/components/common/FormField';
import { useAssignableRoles, useChangeRole } from './api';
import { useToast } from '@/components/common/Toast';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { ApiException } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import type { RoleId, User } from '@/contracts/types';

interface Props {
  user: User | null;
  onClose: () => void;
}

export default function ChangeRoleModal({ user, onClose }: Props) {
  const [roleId, setRoleId] = useState('');
  const currentUser = useAuthStore((s) => s.user);
  const { data: roleData, isLoading } = useAssignableRoles(Boolean(user));
  const changeRole = useChangeRole();
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    if (!user) return;
    changeRole.reset();
    setRoleId(user.roleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) return null;

  const isSelf = currentUser?.id === user.id;
  const roles = roleData?.data ?? [];
  const selected = roles.find((r) => r.id === roleId);
  const unchanged = roleId === user.roleId;

  const errorMessage =
    changeRole.error instanceof ApiException ? changeRole.error.message : null;

  async function submit() {
    if (!user || !selected) return;

    const ok = await confirm({
      title: `Move ${user.employeeName} to ${selected.name}?`,
      description:
        'Their access changes at their next sign-in. If they are signed in right now, they keep their current access until then.',
      confirmLabel: 'Change role',
    });
    if (!ok) return;

    changeRole.mutate(
      { id: user.id, body: { roleId: roleId as RoleId } },
      {
        onSuccess: () => {
          toast(`${user.employeeName} is now ${selected.name}`);
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open={Boolean(user)}
      onOpenChange={(open) => !open && onClose()}
      title="Change role"
      description="Roles decide what this person can see and do."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={unchanged || isSelf || changeRole.isPending}>
            {changeRole.isPending ? 'Saving…' : 'Change role'}
          </Button>
        </>
      }
    >
      {isSelf && (
        <div className="mb-space-base rounded-xl border border-amber-200 bg-amber-50 px-space-md py-space-sm font-body-sm text-body-sm text-amber-700">
          You cannot change your own role. Ask someone with higher access to do it.
        </div>
      )}

      {errorMessage && (
        <div className="mb-space-base rounded-xl border border-red-200 bg-red-50 px-space-md py-space-sm font-body-sm text-body-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <div className="flex flex-col gap-space-base">
        <div className="flex items-center gap-space-sm rounded-xl bg-zinc-50 px-space-md py-space-sm">
          <Avatar name={user.employeeName} photoUrl={user.employeePhotoUrl} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-body-sm text-body-sm font-semibold text-zinc-900">
              {user.employeeName}
            </span>
            <span className="font-mono-data text-mono-data text-zinc-400">
              {user.username}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-space-xs">
            <Chip>{user.roleName}</Chip>
          </div>
        </div>

        <FormField label="New role" required>
          <select
            value={roleId}
            disabled={isSelf || isLoading}
            onChange={(e) => setRoleId(e.target.value)}
            className={inputCls()}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <span className="font-label-sm text-label-sm text-zinc-400">
            Only roles you can grant are listed — you cannot hand out access you do not
            have yourself.
          </span>
        </FormField>

        {selected && selected.id !== user.roleId && (
          <div className="rounded-xl border border-black/[0.06] bg-card p-space-md">
            <p className="mb-space-xs font-label-sm text-label-sm uppercase tracking-[0.09em] text-zinc-400">
              {selected.name} can
            </p>
            <p className="font-body-sm text-[12px] leading-snug text-zinc-500">
              {selected.description || 'No description set for this role.'}
            </p>
            <p className="mt-space-sm font-mono-data text-mono-data text-zinc-400">
              {selected.permissions.length} permissions
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
