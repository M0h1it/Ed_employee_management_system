/**
 * src/components/common/PriorityBadge.tsx
 *
 * Priority, shown the same way everywhere.
 *
 * WHY A LABELLED BADGE AND NOT JUST A COLOURED DOT: a bare dot needs a legend,
 * and roughly one man in twelve cannot reliably tell red from amber. The word
 * carries the meaning; the colour only reinforces it.
 */

import clsx from 'clsx';
import type { TaskPriority } from '@/contracts/types';

const STYLES: Record<TaskPriority, { cls: string; label: string; icon: string }> = {
  high: {
    cls: 'bg-red-500/15 text-red-600 border-red-500/20',
    label: 'High',
    icon: 'keyboard_double_arrow_up',
  },
  medium: {
    cls: 'bg-amber-500/15 text-amber-600 border-amber-500/20',
    label: 'Medium',
    icon: 'drag_handle',
  },
  low: {
    cls: 'bg-slate-500/15 text-slate-600 border-slate-500/20',
    label: 'Low',
    icon: 'keyboard_double_arrow_down',
  },
};

export default function PriorityBadge({
  priority,
  compact = false,
}: {
  priority: TaskPriority;
  compact?: boolean;
}) {
  const s = STYLES[priority];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em]',
        s.cls,
      )}
      title={`${s.label} priority`}
    >
      <span className="icon text-[12px]">{s.icon}</span>
      {!compact && s.label}
    </span>
  );
}
