/**
 * src/components/common/Drawer.tsx
 *
 * Right-hand side panel. Same Radix Dialog underneath as Modal — a drawer is a
 * modal that slides from the edge, not a different mechanism. Reusing Dialog
 * means focus handling and Escape behave identically in both.
 */

import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  header?: ReactNode;
  children: ReactNode;
  width?: string;
}

export default function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  header,
  children,
  width = 'w-full sm:w-[480px]',
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-zinc-900/40" />
        <Dialog.Content
          className={`fixed right-0 top-0 z-[101] flex h-screen ${width} max-w-[calc(100vw-2rem)] flex-col bg-card focus:outline-none`}
        >
          <div className="flex items-start justify-between gap-space-base border-b border-black/[0.06] px-space-base py-space-base sm:px-space-lg">
            <div className="flex min-w-0 flex-col">
              {header}
              <Dialog.Title className="truncate font-headline-md text-headline-md text-zinc-900">
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description className="mt-space-xxs truncate font-body-sm text-body-sm text-zinc-500">
                  {subtitle}
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

          <div className="flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
