/**
 * src/components/common/FormField.tsx
 *
 * Label, control and error message as one unit.
 *
 * WHY BUNDLE THEM: the error message must sit in a predictable place and the
 * label must be linked to the input for screen readers. Left to individual
 * forms, one of those gets forgotten every time.
 */

import type { ReactNode } from 'react';
import clsx from 'clsx';

interface Props {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export default function FormField({ label, error, required, children }: Props) {
  return (
    <label className="flex flex-col gap-space-xs">
      <span className="font-label-md text-label-md text-zinc-500">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      {children}
      {error && (
        <span className="font-label-sm text-label-sm text-red-600">{error}</span>
      )}
    </label>
  );
}

/** Shared input styling so every text field in the app matches. */
export const inputClass =
  'h-9 w-full rounded-xl bg-zinc-50 px-space-md font-body-sm text-body-sm text-zinc-900 outline-none ring-indigo-200 placeholder:text-zinc-400 focus:ring-2';

export const inputErrorClass = 'ring-2 ring-error';

export function inputCls(hasError?: boolean) {
  return clsx(inputClass, hasError && inputErrorClass);
}
