/**
 * src/layouts/AppShell.tsx
 *
 * The frame every signed-in page renders inside.
 *
 * Below `lg` the sidebar is an overlay, so the content takes the full width and
 * a top bar carries the menu button. From `lg` up the sidebar is fixed and the
 * content is offset by its width — which changes when it is collapsed.
 *
 * <Outlet /> is where React Router injects the current page. Because the shell
 * sits above the pages in the route tree, the sidebar never unmounts during
 * navigation — no flicker, no re-fetch of nav state.
 */

import { Outlet } from 'react-router-dom';
import clsx from 'clsx';
import Sidebar from './Sidebar';
import MobileTopBar from './MobileTopBar';
import SessionGuard from './SessionGuard';
import { useUiStore } from '@/stores/uiStore';

export default function AppShell() {
  const collapsed = useUiStore((s) => s.collapsed);

  return (
    <div className="min-h-screen bg-base">
      {/* Idle and absolute session limits run for the whole signed-in app. */}
      <SessionGuard />
      <Sidebar />

      <div
        className={clsx(
          'flex min-h-screen flex-col transition-[padding] duration-200',
          collapsed ? 'lg:pl-sidebar-collapsed' : 'lg:pl-sidebar-width',
        )}
      >
        <MobileTopBar />

        {/* Padding steps up with the viewport: tight on a phone where every
            pixel of width counts, generous on a desktop where it does not.
            min-w-0 lets wide tables inside shrink and scroll rather than
            pushing the whole layout sideways. */}
        <main className="min-w-0 flex-1 px-space-base py-space-base sm:px-space-lg md:px-space-xl md:py-space-lg">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
