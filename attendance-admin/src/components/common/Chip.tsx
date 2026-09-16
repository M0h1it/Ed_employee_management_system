/**
 * src/components/common/Chip.tsx
 *
 * Small labelled pill. `tone` carries meaning, never decoration.
 *
 * The rule from the design system: colour is reserved for status. A department
 * name is neutral because a department is not good or bad. Only states that a
 * person should react to get a colour.
 */

import clsx from 'clsx';
import type { ReactNode } from 'react';

export type ChipTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'muted';

const TONES: Record<ChipTone, string> = {
  neutral: 'bg-zinc-500/15 text-zinc-600 border-zinc-500/20',
  positive: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/20',
  warning: 'bg-amber-500/15 text-amber-600 border-amber-500/20',
  danger: 'bg-red-500/15 text-red-600 border-red-500/20',
  muted: 'bg-slate-500/15 text-slate-500 border-slate-500/20',
};

interface Props {
  children: ReactNode;
  tone?: ChipTone;
  /** Small leading dot, used for present/absent style states. */
  dot?: boolean;
}

export default function Chip({ children, tone = 'neutral', dot = false }: Props) {
  return (
    <span
      className={clsx(
        /* 15% tint, 600-weight text, 20% border — the shared pill recipe, so
           a chip here matches a status pill in the other Blysk projects. */
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] font-semibold',
        TONES[tone],
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
