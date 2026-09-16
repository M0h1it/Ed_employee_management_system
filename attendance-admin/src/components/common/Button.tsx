/**
 * src/components/common/Button.tsx
 *
 * One button, three variants. Built once so every screen's primary action
 * looks identical — the moment two screens style their own buttons, they drift.
 */

import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: string;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white shadow-xs hover:bg-indigo-700 active:scale-[0.98]',
  secondary:
    'border border-black/[0.08] bg-card text-zinc-600 shadow-xs hover:border-black/[0.14] hover:text-zinc-900 active:scale-[0.98]',
  ghost: 'bg-transparent text-zinc-500 hover:bg-indigo-50 hover:text-indigo-600',
  danger: 'bg-red-600 text-white shadow-xs hover:bg-red-700 active:scale-[0.98]',
};

export default function Button({
  variant = 'primary',
  icon,
  children,
  className,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-space-base text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        VARIANTS[variant],
        className,
      )}
    >
      {icon && <span className="icon text-[16px]">{icon}</span>}
      {children}
    </button>
  );
}
