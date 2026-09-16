/**
 * src/lib/rbac.ts
 *
 * The ONLY place that decides what a user may see.
 *
 * IMPORTANT — READ THIS BEFORE USING IT
 * --------------------------------------
 * Everything in this file is USER EXPERIENCE, not security. Hiding a button in
 * the browser does not stop anyone opening developer tools and calling the API
 * directly. In Phase 2 every one of these permissions is re-checked on the
 * server, on every endpoint, including reads. This file only stops people
 * seeing controls they cannot use.
 */

import { useAuthStore } from '@/stores/authStore';
import type { Permission } from '@/contracts/permissions';

/**
 * Check a permission outside React (inside a route loader, an event handler).
 * Inside a component prefer useCan, which re-renders when the user changes.
 */
export function can(permission: Permission): boolean {
  return useAuthStore.getState().permissions.has(permission);
}

/** True if the user has at least one of the listed permissions. */
export function canAny(permissions: Permission[]): boolean {
  const set = useAuthStore.getState().permissions;
  return permissions.some((p) => set.has(p));
}

/**
 * Hook version. Subscribes to the store, so the component re-renders if the
 * signed-in user changes.
 */
export function useCan(permission: Permission): boolean {
  return useAuthStore((s) => s.permissions.has(permission));
}

export function useCanAny(permissions: Permission[]): boolean {
  return useAuthStore((s) => permissions.some((p) => s.permissions.has(p)));
}
