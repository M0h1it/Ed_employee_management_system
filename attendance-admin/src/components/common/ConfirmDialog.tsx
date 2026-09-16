/**
 * src/components/common/ConfirmDialog.tsx
 *
 * The confirmation dialog, replacing window.confirm and any alert library.
 *
 * WHY NOT SweetAlert OR window.confirm
 * -------------------------------------
 * window.confirm renders the browser's own box — it cannot be styled at all, it
 * blocks the JavaScript thread, and it looks like a different application.
 * SweetAlert is styleable only up to a point: its internals fight your tokens,
 * its animations are its own, and you end up shipping a second design system.
 *
 * This is built on the same Radix Dialog as every other modal here, so focus
 * trapping, Escape, scroll lock and portalling behave identically everywhere,
 * and it inherits the project's colours and radii for free.
 *
 * USAGE — a hook, so a component never manages open/close state itself:
 *
 *   const confirm = useConfirm();
 *   ...
 *   const ok = await confirm({
 *     title: 'Disable this account?',
 *     description: 'They will be signed out and cannot sign back in.',
 *     confirmLabel: 'Disable',
 *     tone: 'danger',
 *   });
 *   if (!ok) return;
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import clsx from 'clsx';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for destructive actions — red button, warning icon. */
  tone?: 'default' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return fn;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  /**
   * The promise's resolve function is parked in a ref, so the buttons can settle
   * it later. A ref rather than state because changing it must not re-render.
   */
  const resolver = useRef<(value: boolean) => void>(() => {});

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function settle(result: boolean) {
    resolver.current(result);
    setOptions(null);
  }

  const danger = options?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <Dialog.Root
        open={Boolean(options)}
        onOpenChange={(open) => {
          // Escape, backdrop click and the X all mean "no". Treating a dismissal
          // as anything else is how people delete things by accident.
          if (!open) settle(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] animate-fade-in bg-zinc-900/40 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[201] w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 animate-scale-in rounded-2xl border border-black/[0.06] bg-card p-space-lg shadow-modal focus:outline-none">
            <div className="flex gap-space-base">
              <div
                className={clsx(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                  danger ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600',
                )}
              >
                <span className="icon text-[20px]">
                  {danger ? 'warning' : 'help'}
                </span>
              </div>

              <div className="flex min-w-0 flex-col gap-space-xs">
                <Dialog.Title className="font-headline-md text-headline-md text-zinc-900">
                  {options?.title}
                </Dialog.Title>
                {options?.description && (
                  <Dialog.Description className="font-body-sm text-body-sm text-zinc-500">
                    {options.description}
                  </Dialog.Description>
                )}
              </div>
            </div>

            <div className="mt-space-lg flex justify-end gap-space-sm">
              <button
                onClick={() => settle(false)}
                className="h-9 rounded-xl border border-black/[0.08] bg-card px-space-base font-label-md text-label-md text-zinc-600 shadow-xs hover:border-black/[0.14] hover:text-zinc-900"
              >
                {options?.cancelLabel ?? 'Cancel'}
              </button>
              <button
                /* autoFocus on the SAFE action, not the destructive one — so a
                   reflexive Enter keypress cancels rather than confirms. */
                autoFocus={!danger}
                onClick={() => settle(true)}
                className={clsx(
                  'h-9 rounded-xl px-space-base font-label-md text-label-md text-white shadow-xs',
                  danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-indigo-600 hover:bg-indigo-700',
                )}
              >
                {options?.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
}
