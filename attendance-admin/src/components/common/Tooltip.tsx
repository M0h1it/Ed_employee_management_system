/**
 * src/components/common/Tooltip.tsx
 *
 * A proper hover preview, not the browser's native `title` attribute.
 *
 * WHY NOT title="..."
 * ------------------------
 * The native tooltip is unstyled, takes about a second to appear, cannot
 * wrap or format multi-line content predictably across browsers, and is
 * the exact thing that made a task's full title/dates unreadable on hover
 * in TaskTimeline.tsx's narrow bars — the OS tooltip showed the raw title
 * text with an embedded newline, rendered however that platform's tooltip
 * happens to render newlines, if at all. This component renders real HTML,
 * so the same task-detail layout used elsewhere (dates, status, assignee)
 * can appear consistently in the hover preview too.
 */

import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

interface Props {
  content: ReactNode;
  children: ReactNode;
  /** Delay before showing, in ms — short but not instant, so moving the
   * mouse across several bars in a row does not flash a tooltip per bar. */
  delayMs?: number;
}

export default function Tooltip({ content, children, delayMs = 200 }: Props) {
  return (
    <RadixTooltip.Provider delayDuration={delayMs}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="top"
            align="start"
            sideOffset={6}
            className="z-[200] max-w-[280px] rounded-xl bg-zinc-900 px-space-sm py-space-xs text-[12px] text-white shadow-card"
          >
            {content}
            <RadixTooltip.Arrow className="fill-zinc-900" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}