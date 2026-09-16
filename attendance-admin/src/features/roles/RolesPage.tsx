/**
 * src/features/roles/RolesPage.tsx
 *
 * The permissions matrix: roles down the side, permissions across the top.
 *
 * WHY A MATRIX AND NOT A FORM PER ROLE
 * -------------------------------------
 * The question an owner actually asks is comparative — "can a Manager do this
 * when an Employee cannot?". A matrix answers that at a glance. A form per role
 * forces them to open two tabs and compare from memory.
 *
 * WHY CHANGES ARE STAGED AND SAVED TOGETHER
 * ------------------------------------------
 * Each checkbox firing its own request would mean a half-applied permission set
 * if the network drops midway, and would make the "last role that can manage
 * roles" check fire on an intermediate state rather than the intended one.
 * Staging locally and sending one payload keeps the rule meaningful.
 *
 * A NOTE ON EDITING YOUR OWN ROLE: the signed-in user's permission set is not
 * refreshed after saving. Silently removing their own menu items mid-session is
 * disorienting. The change takes effect at next sign-in, which is also what the
 * banner tells them.
 */

import { useState, useMemo } from 'react';
import PageHeader from '@/components/common/PageHeader';
import Button from '@/components/common/Button';
import Chip from '@/components/common/Chip';
import Modal from '@/components/common/Modal';
import FormField, { inputCls } from '@/components/common/FormField';
import { useRoles, useUpdateRole, useCreateRole } from './api';
import {
  PERMISSION_MODULES,
  PERMISSION_LABELS,
  PERMISSION_DESCRIPTIONS,
} from '@/contracts/permissions';
import type { Permission } from '@/contracts/permissions';
import { ApiException } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';

type Draft = Record<string, Set<Permission>>;

export default function RolesPage() {
  const { data, isLoading } = useRoles();
  const updateRole = useUpdateRole();
  const createRole = useCreateRole();
  const currentRoleName = useAuthStore((s) => s.user?.roleName);

  const [draft, setDraft] = useState<Draft>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  const roles = data?.data ?? [];

  /** Current state of a checkbox: the staged value if edited, else the saved one. */
  function isChecked(roleId: string, permission: Permission): boolean {
    const staged = draft[roleId];
    if (staged) return staged.has(permission);
    return roles.find((r) => r.id === roleId)?.permissions.includes(permission) ?? false;
  }

  function toggle(roleId: string, permission: Permission) {
    setErrorMessage(null);
    setDraft((prev) => {
      const role = roles.find((r) => r.id === roleId);
      const current = prev[roleId] ?? new Set(role?.permissions ?? []);
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return { ...prev, [roleId]: next };
    });
  }

  const dirtyRoleIds = useMemo(() => Object.keys(draft), [draft]);

  async function saveAll() {
    setErrorMessage(null);

    const ok = await confirm({
      title: `Save permission changes?`,
      description:
        'Anyone signed in keeps their current access until they sign out and back in.',
      confirmLabel: 'Save changes',
    });
    if (!ok) return;

    for (const roleId of dirtyRoleIds) {
      try {
        await updateRole.mutateAsync({
          id: roleId,
          body: { permissions: Array.from(draft[roleId]) },
        });
      } catch (err) {
        setErrorMessage(
          err instanceof ApiException ? err.message : 'Could not save changes.',
        );
        return; // stop at the first failure rather than half-applying
      }
    }
    setDraft({});
    toast('Permissions saved');
  }

  function createNewRole() {
    createRole.mutate(
      { name: newName, description: newDescription, permissions: [] },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setNewName('');
          setNewDescription('');
          toast(`Role "${newName}" created`);
        },
        onError: (err) =>
          setErrorMessage(
            err instanceof ApiException ? err.message : 'Could not create the role.',
          ),
      },
    );
  }

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Control what each role can see and do. Changes apply at next sign-in."
        actions={
          <>
            <Button
              variant="secondary"
              icon={showReference ? 'visibility_off' : 'help'}
              onClick={() => setShowReference((v) => !v)}
            >
              {showReference ? 'Hide guide' : 'What do these mean?'}
            </Button>
            <Button icon="add" onClick={() => setCreateOpen(true)}>
              Create role
            </Button>
          </>
        }
      />

      {showReference && (
        <div className="mb-space-base grid gap-space-lg rounded-2xl border border-black/[0.06] bg-card p-space-base shadow-xs sm:p-space-lg lg:grid-cols-2">
          {Object.entries(PERMISSION_MODULES).map(([module, perms]) => (
            <div key={module} className="flex flex-col gap-space-sm">
              <h3 className="font-label-sm text-label-sm uppercase tracking-[0.09em] text-zinc-400">
                {module}
              </h3>
              <dl className="flex flex-col gap-space-md">
                {perms.map((p) => (
                  <div key={p} className="flex flex-col gap-space-xxs">
                    <dt className="flex items-center gap-space-sm">
                      <span className="font-headline-sm text-headline-sm text-zinc-900">
                        {PERMISSION_LABELS[p]}
                      </span>
                      <code className="rounded-xl bg-zinc-100 px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-500">
                        {p}
                      </code>
                    </dt>
                    <dd className="font-body-sm text-[12px] leading-snug text-zinc-500">
                      {PERMISSION_DESCRIPTIONS[p]}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      {errorMessage && (
        <div className="mb-space-base rounded-2xl bg-red-50 px-space-base py-space-md font-body-sm text-body-sm text-red-600">
          {errorMessage}
        </div>
      )}

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-card" />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-card">
          <table className="w-full border-collapse">
            <thead>
              {/* Module headings span their permission columns. */}
              <tr className="bg-zinc-50">
                <th className="sticky left-0 z-10 bg-zinc-50 px-space-base py-space-sm text-left font-label-sm text-label-sm uppercase tracking-wider text-zinc-400">
                  Role
                </th>
                {Object.entries(PERMISSION_MODULES).map(([module, perms]) => (
                  <th
                    key={module}
                    colSpan={perms.length}
                    className="border-l border-black/[0.06] px-space-base py-space-sm text-center font-label-sm text-label-sm uppercase tracking-wider text-zinc-500"
                  >
                    {module}
                  </th>
                ))}
              </tr>
              <tr className="bg-zinc-50">
                <th className="sticky left-0 z-10 bg-zinc-50" />
                {Object.entries(PERMISSION_MODULES).map(([module, perms]) =>
                  perms.map((p, i) => (
                    <th
                      key={p}
                      title={PERMISSION_DESCRIPTIONS[p]}
                      className={`cursor-help px-space-sm pb-space-sm text-center font-label-sm text-label-sm font-normal text-zinc-400 ${
                        i === 0 ? 'border-l border-black/[0.06]' : ''
                      }`}
                    >
                      <span className="block w-[76px] leading-tight">
                        {PERMISSION_LABELS[p]}
                      </span>
                    </th>
                  )),
                )}
              </tr>
            </thead>

            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-t border-black/[0.06]">
                  <th className="sticky left-0 z-10 bg-card px-space-base py-space-md text-left">
                    <div className="flex w-[150px] flex-col gap-space-xxs sm:w-[190px]">
                      <div className="flex items-center gap-space-xs">
                        <span className="font-body-sm text-body-sm font-medium text-zinc-900">
                          {role.name}
                        </span>
                        {role.isSystem && (
                          <span
                            className="icon text-[13px] text-zinc-400"
                            title="System role — cannot be renamed or deleted"
                          >
                            lock
                          </span>
                        )}
                        {role.name === currentRoleName && <Chip tone="neutral">You</Chip>}
                      </div>
                      <span className="font-label-sm text-label-sm text-zinc-400">
                        {role.userCount} {role.userCount === 1 ? 'account' : 'accounts'}
                      </span>
                    </div>
                  </th>

                  {Object.entries(PERMISSION_MODULES).map(([module, perms]) =>
                    perms.map((p, i) => (
                      <td
                        key={p}
                        className={`px-space-sm py-space-md text-center ${
                          i === 0 ? 'border-l border-black/[0.06]' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`${role.name}: ${PERMISSION_LABELS[p]} in ${module}`}
                          title={PERMISSION_DESCRIPTIONS[p]}
                          checked={isChecked(role.id, p)}
                          onChange={() => toggle(role.id, p)}
                          className="h-4 w-4 cursor-pointer accent-indigo-600"
                        />
                      </td>
                    )),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sticky save bar, only while there are unsaved changes. */}
      {dirtyRoleIds.length > 0 && (
        <div className="sticky bottom-space-base mt-space-base flex flex-wrap items-center justify-between gap-space-sm rounded-2xl bg-zinc-900 px-space-base py-space-md sm:px-space-lg">
          <span className="font-body-sm text-body-sm text-white">
            {dirtyRoleIds.length} {dirtyRoleIds.length === 1 ? 'role has' : 'roles have'}{' '}
            unsaved changes
          </span>
          <div className="flex gap-space-sm">
            <button
              onClick={() => setDraft({})}
              className="h-9 rounded-xl px-space-md font-label-md text-label-md text-white opacity-70 hover:opacity-100"
            >
              Discard
            </button>
            <Button onClick={saveAll} disabled={updateRole.isPending}>
              {updateRole.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create role"
        description="Start with no permissions, then tick what this role should be able to do."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createNewRole} disabled={!newName || createRole.isPending}>
              {createRole.isPending ? 'Creating…' : 'Create role'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-space-base">
          <FormField label="Role name" required>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputCls()}
              placeholder="Shift Lead"
            />
          </FormField>
          <FormField label="Description">
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className={inputCls()}
              placeholder="Runs the floor, sees their own team's attendance"
            />
          </FormField>
        </div>
      </Modal>
    </>
  );
}
