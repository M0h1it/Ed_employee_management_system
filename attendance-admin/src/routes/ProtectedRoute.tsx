/**
 * src/routes/ProtectedRoute.tsx
 *
 * Blocks a route when the user is not signed in, or lacks the permission.
 *
 * `replace` on the redirect matters: without it, the browser back button would
 * bounce the user straight back to the page they were just rejected from.
 *
 * SECURITY NOTE, ONE LAST TIME: a route guard protects the rendering of a
 * page, nothing more. The data behind it is protected by the server.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import type { Permission } from '@/contracts/permissions';

interface Props {
  /** Any one of these grants access. Omit to require only authentication. */
  need?: Permission[];
}

export default function ProtectedRoute({ need }: Props) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const permissions = useAuthStore((s) => s.permissions);
  const location = useLocation();

  if (!isAuthenticated) {
    // Remember where they were headed so login can send them back there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (need && need.length > 0 && !need.some((p) => permissions.has(p))) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
