/**
 * src/components/common/PageHeader.tsx
 *
 * The title block every page starts with. Built once so all pages line up
 * exactly, instead of each screen inventing its own spacing.
 */

import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, description, actions }: Props) {
  return (
    <div className="flex flex-col justify-between gap-space-sm pb-space-base md:flex-row md:items-center md:gap-space-md md:pb-space-lg">
      <div className="flex min-w-0 flex-col">
        <h1 className="font-headline-lg text-headline-lg tracking-tight text-zinc-900">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 font-body-sm text-body-sm text-zinc-500">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-space-sm">{actions}</div>
      )}
    </div>
  );
}
