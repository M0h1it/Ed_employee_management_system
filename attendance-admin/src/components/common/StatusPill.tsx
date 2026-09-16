/**
 * src/components/common/StatusPill.tsx
 *
 * The shared status pill: 15% tinted background, 600-weight text, 20% border.
 * Same recipe as the other Blysk projects, so a "Delivered" pill there and a
 * "Present" pill here are visibly the same component.
 */

import clsx from 'clsx';
import type { ReactNode } from 'react';

export type PillTone = 'slate' | 'indigo' | 'emerald' | 'amber' | 'red' | 'rose';

const TONES: Record<PillTone, string> = {
  slate: 'bg-slate-500/15 text-slate-600 border-slate-500/20',
  indigo: 'bg-indigo-500/15 text-indigo-600 border-indigo-500/20',
  emerald: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20',
  amber: 'bg-amber-500/15 text-amber-600 border-amber-500/20',
  red: 'bg-red-500/15 text-red-600 border-red-500/20',
  rose: 'bg-rose-500/15 text-rose-600 border-rose-500/20',
};

export default function StatusPill({
  tone = 'slate',
  dot = false,
  children,
}: {
  tone?: PillTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] font-semibold',
        TONES[tone],
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
