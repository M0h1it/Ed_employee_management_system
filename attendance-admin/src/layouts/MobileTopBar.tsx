/**
 * src/layouts/MobileTopBar.tsx
 *
 * The narrow-screen header: a hamburger, the company name, and the user's
 * initials.
 *
 * It only exists below `lg`, because above that the sidebar is permanently on
 * screen and a second bar carrying the same information would be wasted
 * vertical space — which is exactly what a laptop has least of.
 */

import { useUiStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import { initials } from '@/lib/format';

export default function MobileTopBar() {
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const user = useAuthStore((s) => s.user);

  return (
    <header className="sticky top-0 z-30 flex h-header-height items-center gap-space-sm border-b border-black/[0.06] bg-base/95 px-space-base backdrop-blur-xl lg:hidden">
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="-ml-1 rounded-xl p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      >
        <span className="icon text-[22px]">menu</span>
      </button>

      <div className="flex min-w-0 items-center gap-space-sm">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-[11px] font-bold text-white">
          N
        </div>
        <span className="truncate font-headline-sm text-headline-sm text-zinc-900">
          Nexus Operations
        </span>
      </div>

      <div
        title={user?.name}
        className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-semibold text-white"
      >
        {user ? initials(user.name) : '??'}
      </div>
    </header>
  );
}
