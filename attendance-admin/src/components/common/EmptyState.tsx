/**
 * src/components/common/EmptyState.tsx
 *
 * Shown when a list has no rows.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: an empty table with just headers and
 * nothing under them reads as "broken", not as "no results". Two extra lines
 * of text is the difference between a user filing a bug and a user clearing
 * their filter.
 */

import type { ReactNode } from 'react';

interface Props {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
}: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-space-sm px-space-base py-space-xl text-center">
      <span className="icon text-[28px] text-zinc-400">{icon}</span>
      <div className="flex flex-col gap-space-xxs">
        <p className="font-headline-sm text-headline-sm text-zinc-900">{title}</p>
        {description && (
          <p className="font-body-sm text-body-sm text-zinc-500">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
