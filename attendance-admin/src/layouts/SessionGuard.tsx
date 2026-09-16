/**
 * src/layouts/SessionGuard.tsx
 *
 * Runs the idle timer for the whole signed-in app and shows the warning.
 *
 * It sits inside AppShell rather than at the root of the tree so the timer only
 * runs while somebody is actually signed in — no listeners, no interval, and no
 * countdown on the login screen.
 */

import { useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useIdleTimer } from '@/lib/useIdleTimer';
import { queryClient } from '@/lib/queryClient';

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SessionGuard() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  const endSession = useCallback(
    (reason: 'idle' | 'expired') => {
      clearSession(reason);
      // Every cached query is dropped, so the next person to sign in on this
      // machine cannot see a flash of the previous user's data before the
      // refetch lands.
      queryClient.clear();
      navigate('/login', { replace: true });
    },
    [clearSession, navigate],
  );

  const { warningMsLeft, resetIdle } = useIdleTimer({
    enabled: isAuthenticated,
    onIdle: () => endSession('idle'),
    onExpired: () => endSession('expired'),
  });

  const showWarning = warningMsLeft !== null;

  return (
    <Dialog.Root open={showWarning}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[400] animate-fade-in bg-zinc-900/40 backdrop-blur-[2px]" />
        <Dialog.Content
          /* Closing on Escape or a backdrop click would be ambiguous — does
             pressing Escape mean "keep me signed in" or "sign me out"? Both are
             blocked so the choice is explicit. Moving the mouse over the dialog
             does NOT silently extend the session either; the button does. */
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[401] w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 animate-scale-in rounded-2xl border border-black/[0.06] bg-card p-space-lg shadow-modal focus:outline-none"
        >
          <div className="flex gap-space-base">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <span className="icon text-[20px]">timer</span>
            </div>
            <div className="flex min-w-0 flex-col gap-space-xs">
              <Dialog.Title className="font-headline-md text-headline-md text-zinc-900">
                Still there?
              </Dialog.Title>
              <Dialog.Description className="font-body-sm text-body-sm text-zinc-500">
                You will be signed out in{' '}
                <span className="font-mono-data font-semibold text-zinc-900">
                  {formatCountdown(warningMsLeft ?? 0)}
                </span>{' '}
                because of inactivity. Anything you have typed but not saved will be lost.
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-space-lg flex justify-end gap-space-sm">
            <button
              onClick={() => endSession('idle')}
              className="h-9 rounded-xl border border-black/[0.08] bg-card px-space-base text-[12px] font-semibold text-zinc-600 shadow-xs hover:border-black/[0.14] hover:text-zinc-900"
            >
              Sign out now
            </button>
            <button
              autoFocus
              onClick={resetIdle}
              className="h-9 rounded-xl bg-indigo-600 px-space-base text-[12px] font-semibold text-white shadow-xs hover:bg-indigo-700"
            >
              Stay signed in
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
