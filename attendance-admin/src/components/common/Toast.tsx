/**
 * src/components/common/Toast.tsx
 *
 * Brief confirmation after an action succeeds — the other half of what an alert
 * library is usually used for.
 *
 * A toast is for outcomes the user does not need to acknowledge ("Task
 * assigned"). Anything they must decide on goes through ConfirmDialog instead.
 * Mixing the two — a toast that asks a question, a modal that just says "saved"
 * — trains people to dismiss both without reading.
 */

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type ToastFn = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const fn = useContext(ToastContext);
  if (!fn) throw new Error('useToast must be used inside <ToastProvider>');
  return fn;
}

const TONES: Record<ToastTone, { cls: string; icon: string }> = {
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: 'check_circle' },
  error: { cls: 'border-red-200 bg-red-50 text-red-700', icon: 'error' },
  info: { cls: 'border-indigo-200 bg-indigo-50 text-indigo-700', icon: 'info' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback<ToastFn>((message, tone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}

      <div
        /* aria-live so screen readers announce it — a toast nobody is told
           about is the same as no feedback at all. */
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-space-lg right-space-lg z-[300] flex flex-col gap-space-sm"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex animate-slide-in-right items-center gap-space-sm rounded-xl border px-space-base py-space-md shadow-card',
              TONES[t.tone].cls,
            )}
          >
            <span className="icon text-[18px]">{TONES[t.tone].icon}</span>
            <span className="font-body-sm text-body-sm">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
