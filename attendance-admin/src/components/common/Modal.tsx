/**
 * src/components/common/Modal.tsx
 *
 * Centred dialog, built on Radix.
 *
 * WHY RADIX AND NOT A PLAIN DIV: a correct modal traps focus inside itself,
 * returns focus to the trigger on close, closes on Escape, locks background
 * scrolling, marks the rest of the page aria-hidden, and renders in a portal so
 * it escapes any parent overflow. That is a week of work to get right and a
 * screen-reader user notices immediately when it is wrong. Radix gives all of
 * it with no styling opinions, so the design stays ours.
 */

import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export default function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'max-w-[520px]',
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-zinc-900/40 backdrop-blur-[1px]" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-[101] w-[calc(100vw-2rem)] ${width} -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card shadow-lg focus:outline-none`}
        >
          <div className="flex items-start justify-between gap-space-base border-b border-black/[0.06] px-space-base py-space-base sm:px-space-lg">
            <div className="flex flex-col">
              <Dialog.Title className="font-headline-md text-headline-md text-zinc-900">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-space-xxs font-body-sm text-body-sm text-zinc-500">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="shrink-0 text-zinc-400 hover:text-zinc-900"
            >
              <span className="icon text-[20px]">close</span>
            </Dialog.Close>
          </div>

          <div className="max-h-[65vh] overflow-y-auto px-space-base py-space-base sm:max-h-[70vh] sm:px-space-lg">
            {children}
          </div>

          {footer && (
            <div className="flex items-center justify-end gap-space-sm border-t border-black/[0.06] px-space-base py-space-base sm:px-space-lg">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
