/**
 * src/features/dashboard/StatCard.tsx
 *
 * One number with its label and context line.
 *
 * The context line is not decoration. "36" alone is meaningless; "36 of 40"
 * answers the question the number was asked for. A figure without its
 * denominator invites the wrong conclusion.
 */

import clsx from 'clsx';

interface Props {
  label: string;
  value: number | string;
  context?: string;
  icon?: string;
  /** A subtle accent for the one card that is genuinely live. */
  live?: boolean;
  loading?: boolean;
}

export default function StatCard({ label, value, context, icon, live, loading }: Props) {
  return (
    <div className="flex flex-col gap-space-sm rounded-2xl bg-card px-space-base py-space-md">
      <div className="flex items-center justify-between">
        <span className="font-label-sm text-label-sm uppercase tracking-wider text-zinc-400">
          {label}
        </span>
        {live ? (
          <span className="flex items-center gap-space-xxs font-label-sm text-label-sm text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-[50%] bg-current" />
            Live
          </span>
        ) : (
          icon && <span className="icon text-[18px] text-zinc-400">{icon}</span>
        )}
      </div>

      {loading ? (
        <div className="h-8 w-16 animate-pulse rounded-xl bg-zinc-100" />
      ) : (
        <div className="flex items-baseline gap-space-sm">
          <span className={clsx('font-headline-lg text-[22px] leading-none text-zinc-900 sm:text-[28px]')}>
            {value}
          </span>
          {context && (
            <span className="font-body-sm text-body-sm text-zinc-500">{context}</span>
          )}
        </div>
      )}
    </div>
  );
}
