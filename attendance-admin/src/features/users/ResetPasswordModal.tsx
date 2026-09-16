/**
 * src/features/users/ResetPasswordModal.tsx
 *
 * Admin resets somebody else's password.
 *
 * NOTE WHAT IS MISSING: there is no "current password" field. An admin reset
 * does not require knowing the old password — that is the entire point, because
 * the person has forgotten it. The person's OWN password change, under
 * Settings, does require the current one. Two different operations with two
 * different rules; conflating them is how accounts get taken over.
 */

import { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import FormField, { inputCls } from '@/components/common/FormField';
import { useResetPassword } from './api';
import { ApiException } from '@/lib/apiClient';
import type { User } from '@/contracts/types';

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () =>
    chars[Math.floor(Math.random() * chars.length)],
  ).join('');
}

interface Props {
  user: User | null;
  onClose: () => void;
}

export default function ResetPasswordModal({ user, onClose }: Props) {
  const [password, setPassword] = useState(generatePassword());
  const [mustChange, setMustChange] = useState(true);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  const reset = useResetPassword();

  useEffect(() => {
    if (!user) return;
    reset.reset();
    setPassword(generatePassword());
    setMustChange(true);
    setCopied(false);
    setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fieldError =
    reset.error instanceof ApiException ? reset.error.fields?.newPassword : undefined;

  if (!user) return null;

  return (
    <Modal
      open={Boolean(user)}
      onOpenChange={(open) => !open && onClose()}
      title="Reset password"
      description={`For ${user.employeeName} (${user.username})`}
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                reset.mutate(
                  { id: user.id, body: { newPassword: password, mustChangePassword: mustChange } },
                  { onSuccess: () => setDone(true) },
                )
              }
              disabled={reset.isPending}
            >
              {reset.isPending ? 'Resetting…' : 'Reset password'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col gap-space-base">
          <div className="rounded-xl bg-emerald-50 px-space-md py-space-sm font-body-sm text-body-sm text-emerald-600">
            Password reset. Share it with {user.employeeName.split(' ')[0]} now — it cannot be
            retrieved again.
          </div>
          <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-space-md py-space-sm">
            <span className="font-mono-data text-mono-data text-zinc-900">{password}</span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(password);
                setCopied(true);
              }}
              className="text-zinc-500 hover:text-zinc-900"
              aria-label="Copy password"
            >
              <span className="icon text-[18px]">{copied ? 'check' : 'content_copy'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-space-base">
          <FormField label="New temporary password" error={fieldError} required>
            <div className="flex gap-space-xs">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls(!!fieldError)} font-mono-data`}
              />
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                aria-label="Generate a new password"
                className="h-9 shrink-0 rounded-xl bg-zinc-50 px-space-sm text-zinc-500 hover:bg-zinc-100"
              >
                <span className="icon text-[16px]">refresh</span>
              </button>
            </div>
          </FormField>

          <label className="flex cursor-pointer items-center gap-space-sm">
            <input
              type="checkbox"
              checked={mustChange}
              onChange={(e) => setMustChange(e.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            <span className="font-body-sm text-body-sm text-zinc-900">
              Require a password change at next sign-in
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}
