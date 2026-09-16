/**
 * src/features/dashboard/DashboardPage.tsx
 *
 * Picks which dashboard to render, based on capability rather than role name.
 *
 * Asking `can('attendance.view_all')` rather than `role === 'owner'` means a
 * custom role created later gets the right view automatically, with no code
 * change here.
 */

import PageHeader from '@/components/common/PageHeader';
import MyDayStrip from './MyDayStrip';
import OwnerDashboard from './OwnerDashboard';
import EmployeeDashboard from './EmployeeDashboard';
import { useCan } from '@/lib/rbac';
import { useAuthStore } from '@/stores/authStore';
import { formatDate } from '@/lib/format';
import { format } from 'date-fns';

export default function DashboardPage() {
  const seesEveryone = useCan('attendance.view_all');
  const user = useAuthStore((s) => s.user);
  const today = format(new Date(), 'yyyy-MM-dd');

  return (
    <>
      <PageHeader
        title={seesEveryone ? 'Dashboard' : `Hello, ${user?.name.split(' ')[0] ?? ''}`}
        description={
          seesEveryone
            ? `Attendance and tasks for ${formatDate(today)}`
            : `Your day at a glance · ${formatDate(today)}`
        }
      />
      {/*
        The personal check-in strip is shown to anyone whose hours are actually
        recorded. The owner sets their own schedule and is not tracked, so for
        them the strip would be a permanently empty card asking why they had not
        checked in. A manager IS tracked, and previously had nowhere at all to
        see their own hours.
      */}
      {user?.attendanceTracked && <MyDayStrip />}

      {seesEveryone ? <OwnerDashboard /> : <EmployeeDashboard />}
    </>
  );
}
