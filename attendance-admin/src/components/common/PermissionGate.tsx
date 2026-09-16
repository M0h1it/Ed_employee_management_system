/**
 * src/components/common/PermissionGate.tsx
 *
 * Renders children only if the user holds the permission.
 *
 * REMINDER: this is UX, not security. It stops people seeing a button they
 * cannot use. It does not stop anyone calling the API directly. The server
 * checks the same permission again in Phase 2.
 */

import type { ReactNode } from 'react';
import { useCan } from '@/lib/rbac';
import type { Permission } from '@/contracts/permissions';

interface Props {
  need: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

export default function PermissionGate({ need, children, fallback = null }: Props) {
  const allowed = useCan(need);
  return <>{allowed ? children : fallback}</>;
}
