/**
 * src/layouts/Sidebar.tsx
 *
 * Navigation — permission-filtered, collapsible on desktop, an overlay drawer
 * on narrow screens.
 *
 * Each item declares which permission reveals it. An employee simply never sees
 * the Administration section — not a greyed-out item, not a "no access" page.
 * Absence asks no questions.
 *
 * This is UX, not security. Routes are guarded separately, and the API is
 * guarded on the server.
 */

import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { apiClient } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useLogout } from '@/features/auth/api';
import { initials } from '@/lib/format';
import { useConfirm } from '@/components/common/ConfirmDialog';
import type { Permission } from '@/contracts/permissions';

interface NavItem {
  label: string;
  to: string;
  icon: string;
  /** Any one of these permissions reveals the item. Empty means everyone. */
  need: Permission[];
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', to: '/dashboard', icon: 'grid_view', need: [] }],
  },
  {
    title: 'People',
    items: [
      { label: 'Employees', to: '/employees', icon: 'badge', need: ['employees.view_all'] },
      {
        label: 'Attendance',
        to: '/attendance',
        icon: 'schedule',
        need: ['attendance.view_all', 'attendance.view_own'],
      },
      {
        label: 'Tasks',
        to: '/tasks',
        icon: 'check_circle',
        need: ['tasks.view_all', 'tasks.view_own'],
      },
      {
        label: 'Leave',
        to: '/leave',
        icon: 'event_busy',
        need: ['leave.view_all', 'leave.view_own'],
      },
      {
        label: 'Corrections',
        to: '/corrections',
        icon: 'edit_calendar',
        need: ['corrections.request', 'corrections.view_all'],
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Roles & Permissions', to: '/roles', icon: 'verified_user', need: ['roles.manage'] },
      { label: 'Access Control', to: '/users', icon: 'security', need: ['users.manage'] },
      { label: 'Audit Log', to: '/audit', icon: 'history', need: ['audit.view'] },
    ],
  },
  {
    title: 'Preferences',
    items: [{ label: 'Settings & Profile', to: '/settings', icon: 'tune', need: [] }],
  },
];

export default function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const collapsed = useUiStore((s) => s.collapsed);
  const mobileOpen = useUiStore((s) => s.mobileOpen);
  const setMobileOpen = useUiStore((s) => s.setMobileOpen);
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);

  const logout = useLogout();
  const confirm = useConfirm();
  const location = useLocation();

  /**
   * Navigating closes the drawer. On a phone the menu covers the page it just
   * navigated to, so leaving it open means every tap needs a second tap to
   * dismiss it.
   */
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  /* Escape closes it too — the same reflex as any other overlay. */
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', onKey);
    // Locking the body stops the page behind scrolling under the drawer.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [mobileOpen, setMobileOpen]);

  const canSeeHeadcount = permissions.has('employees.view_all');
  const { data: headcount } = useQuery({
    queryKey: ['employees', 'headcount'],
    queryFn: () =>
      apiClient.get<{ meta: { total: number } }>(EP.employees.list, {
        pageSize: 1,
        status: 'active',
      }),
    enabled: canSeeHeadcount,
    staleTime: 5 * 60_000,
  });

  const subtitle = canSeeHeadcount
    ? headcount
      ? `${headcount.meta.total} members`
      : ''
    : (user?.departmentName ?? '');

  const isVisible = (item: NavItem) =>
    item.need.length === 0 || item.need.some((p) => permissions.has(p));

  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(isVisible),
  })).filter((section) => section.items.length > 0);

  async function handleLogout() {
    const ok = await confirm({
      title: 'Sign out?',
      description: 'Anything you have typed but not saved will be lost.',
      confirmLabel: 'Sign out',
    });
    if (ok) logout.mutate();
  }

  return (
    <>
      {/* Backdrop, narrow screens only. */}
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden
        className={clsx(
          'fixed inset-0 z-40 bg-zinc-900/40 backdrop-blur-[1px] transition-opacity lg:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        className={clsx(
          'fixed left-0 top-0 z-50 flex h-screen select-none flex-col justify-between',
          'border-r border-black/[0.07] bg-card shadow-[1px_0_0_rgba(0,0,0,0.04)]',
          'transition-[width,transform] duration-200',
          // Narrow screens: full-width-ish drawer that slides in.
          'w-[260px] -translate-x-full',
          mobileOpen && 'translate-x-0',
          // From lg up it is always on screen, and width follows the collapse
          // preference instead.
          'lg:translate-x-0',
          collapsed ? 'lg:w-sidebar-collapsed' : 'lg:w-sidebar-width',
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Brand */}
          <div className="flex h-header-height shrink-0 items-center justify-between gap-space-sm px-space-base">
            <div className="flex min-w-0 items-center gap-space-sm">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-[13px] font-bold text-white">
                N
              </div>
              {/* On lg the label is hidden when collapsed; below lg the drawer
                  is always full width, so it always shows. */}
              <div className={clsx('flex min-w-0 flex-col', collapsed && 'lg:hidden')}>
                <span className="truncate font-headline-sm text-headline-sm leading-tight text-zinc-900">
                  Nexus Operations
                </span>
                <span className="mt-space-xxs truncate font-label-sm text-label-sm leading-none text-zinc-500">
                  {subtitle}
                </span>
              </div>
            </div>

            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 lg:hidden"
            >
              <span className="icon text-[20px]">close</span>
            </button>
          </div>

          <nav className="mt-space-xs flex min-h-0 flex-1 flex-col gap-space-md overflow-y-auto px-space-sm pb-space-sm">
            {visibleSections.map((section) => (
              <div key={section.title} className="flex flex-col gap-space-xxs">
                <div
                  className={clsx(
                    'px-space-sm py-space-xxs font-label-sm text-label-sm uppercase tracking-wider text-zinc-400',
                    // A section heading over icon-only items is noise; a thin
                    // rule keeps the grouping without the words.
                    collapsed && 'lg:mx-space-sm lg:my-space-xs lg:h-px lg:bg-black/[0.06] lg:p-0 lg:text-[0px]',
                  )}
                >
                  {section.title}
                </div>

                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    /* The title attribute is the collapsed label — without it an
                       icon-only rail is a guessing game. */
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      clsx(
                        'relative flex h-9 items-center gap-space-sm rounded-xl px-space-sm',
                        collapsed && 'lg:justify-center lg:px-0',
                        isActive
                          ? 'bg-indigo-50 font-medium text-indigo-700'
                          : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-indigo-600" />
                        )}
                        <span className="icon shrink-0 text-[18px]">{item.icon}</span>
                        <span
                          className={clsx(
                            'truncate font-body-sm text-body-sm',
                            collapsed && 'lg:hidden',
                          )}
                        >
                          {item.label}
                        </span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </div>

        <div className="shrink-0 border-t border-black/[0.06] p-space-sm">
          {/* Collapse control is desktop-only — on a phone the drawer is either
              open or gone, so a narrow rail has no purpose. */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={clsx(
              'mb-space-xs hidden h-8 w-full items-center gap-space-sm rounded-xl px-space-sm text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700 lg:flex',
              collapsed && 'lg:justify-center lg:px-0',
            )}
          >
            <span className="icon shrink-0 text-[18px]">
              {collapsed ? 'chevron_right' : 'chevron_left'}
            </span>
            <span className={clsx('font-body-sm text-body-sm', collapsed && 'lg:hidden')}>
              Collapse
            </span>
          </button>

          <div
            className={clsx(
              'flex items-center justify-between gap-space-sm rounded-xl bg-zinc-50 p-space-sm',
              collapsed && 'lg:justify-center lg:bg-transparent lg:p-0',
            )}
          >
            <div className="flex min-w-0 items-center gap-space-sm">
              <div
                title={collapsed ? `${user?.name} — ${user?.roleName}` : undefined}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-semibold text-white"
              >
                {user ? initials(user.name) : '??'}
              </div>
              <div className={clsx('flex min-w-0 flex-col', collapsed && 'lg:hidden')}>
                <span className="truncate font-headline-sm text-headline-sm leading-tight text-zinc-900">
                  {user?.name ?? 'Not signed in'}
                </span>
                <span className="mt-space-xxs truncate font-label-sm text-label-sm leading-none text-zinc-500">
                  {user?.roleName ?? ''}
                </span>
              </div>
            </div>

            <button
              onClick={handleLogout}
              aria-label="Sign out"
              title="Sign out"
              className={clsx(
                'shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600',
                collapsed && 'lg:hidden',
              )}
            >
              <span className="icon text-[18px]">logout</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
