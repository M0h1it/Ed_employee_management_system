/**
 * src/features/users/UserForm.tsx
 *
 * Create a login for an employee.
 *
 * The temporary password is generated in the browser and shown once. After the
 * request succeeds it is gone — the server stores only a hash and no endpoint
 * ever returns it. That is why the copy button matters: this is the single
 * moment the admin can capture it.
 */

import { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import FormField, { inputCls } from '@/components/common/FormField';
import { useEmployees } from '@/features/employees/api';
import { useRoles } from '@/features/roles/api';
import { useCreateUser } from './api';
import { ApiException } from '@/lib/apiClient';
import { useToast } from '@/components/common/Toast';
import type { EmployeeId, RoleId } from '@/contracts/types';

/** Avoids look-alike characters (0/O, 1/l) — these get read aloud and retyped. */
function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () =>
    chars[Math.floor(Math.random() * chars.length)],
  ).join('');
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function UserForm({ open, onOpenChange }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [roleId, setRoleId] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [copied, setCopied] = useState(false);

  const { data: employeeData } = useEmployees({ pageSize: 100, status: 'active' }, open);
  const { data: roleData } = useRoles();
  const createUser = useCreateUser();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    createUser.reset();
    setEmployeeId('');
    setUsername('');
    setPassword(generatePassword());
    setRoleId('');
    setMustChange(true);
    setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Suggest a username from the chosen name, but let it be overridden. */
  function onEmployeeChange(id: string) {
    setEmployeeId(id);
    const employee = employeeData?.data.find((e) => e.id === id);
    if (employee && !username) {
      setUsername(employee.name.split(' ')[0].toLowerCase());
    }
  }

  const fieldErrors =
    createUser.error instanceof ApiException ? (createUser.error.fields ?? {}) : {};
  const generalError =
    createUser.error instanceof ApiException && !createUser.error.fields
      ? createUser.error.message
      : null;

  // Employees who already have a login cannot get a second one.
  const available = employeeData?.data.filter((e) => !e.hasLogin) ?? [];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Create login"
      description="The person signs in with these credentials and changes the password themselves."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              createUser.mutate(
                {
                  employeeId: employeeId as EmployeeId,
                  username,
                  temporaryPassword: password,
                  roleId: roleId as RoleId,
                  mustChangePassword: mustChange,
                },
                {
                  onSuccess: () => {
                    toast(`Login created for ${username}`);
                    onOpenChange(false);
                  },
                },
              )
            }
            disabled={!employeeId || !username || !roleId || createUser.isPending}
          >
            {createUser.isPending ? 'Creating…' : 'Create login'}
          </Button>
        </>
      }
    >
      {generalError && (
        <div className="mb-space-base rounded-xl bg-red-50 px-space-md py-space-sm font-body-sm text-body-sm text-red-600">
          {generalError}
        </div>
      )}

      <div className="flex flex-col gap-space-base">
        <FormField label="Employee" error={fieldErrors.employeeId} required>
          <select
            value={employeeId}
            onChange={(e) => onEmployeeChange(e.target.value)}
            className={inputCls(!!fieldErrors.employeeId)}
          >
            <option value="">Choose…</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.empCode}
              </option>
            ))}
          </select>
          {available.length === 0 && (
            <span className="font-label-sm text-label-sm text-zinc-400">
              Everyone active already has a login.
            </span>
          )}
        </FormField>

        <FormField label="Username" error={fieldErrors.username} required>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            className={inputCls(!!fieldErrors.username)}
            placeholder="karan"
          />
        </FormField>

        <FormField label="Temporary password" error={fieldErrors.temporaryPassword} required>
          <div className="flex gap-space-xs">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputCls(!!fieldErrors.temporaryPassword)} font-mono-data`}
            />
            <button
              type="button"
              onClick={() => {
                setPassword(generatePassword());
                setCopied(false);
              }}
              aria-label="Generate a new password"
              className="h-9 shrink-0 rounded-xl bg-zinc-50 px-space-sm text-zinc-500 hover:bg-zinc-100"
            >
              <span className="icon text-[16px]">refresh</span>
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(password);
                setCopied(true);
              }}
              aria-label="Copy password"
              className="h-9 shrink-0 rounded-xl bg-zinc-50 px-space-sm text-zinc-500 hover:bg-zinc-100"
            >
              <span className="icon text-[16px]">{copied ? 'check' : 'content_copy'}</span>
            </button>
          </div>
          <span className="font-label-sm text-label-sm text-zinc-400">
            Shown only once. Copy it before creating the account.
          </span>
        </FormField>

        <FormField label="Role" error={fieldErrors.roleId} required>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className={inputCls(!!fieldErrors.roleId)}
          >
            <option value="">Choose…</option>
            {roleData?.data.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </FormField>

        <label className="flex cursor-pointer items-center gap-space-sm">
          <input
            type="checkbox"
            checked={mustChange}
            onChange={(e) => setMustChange(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          <span className="font-body-sm text-body-sm text-zinc-900">
            Require a password change at first sign-in
          </span>
        </label>
      </div>
    </Modal>
  );
}
