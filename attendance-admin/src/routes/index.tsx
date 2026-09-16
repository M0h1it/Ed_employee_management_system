/**
 * src/routes/index.tsx
 *
 * The route tree.
 *
 * Shape: ProtectedRoute wraps AppShell, AppShell wraps the pages. Every
 * signed-in page automatically gets the auth check and the sidebar, so adding a
 * page means adding one line rather than remembering to wrap it.
 *
 * WHY THE PAGES ARE LAZY-LOADED
 * ------------------------------
 * Without this, every screen ships in one bundle and a user who only ever opens
 * the dashboard still downloads the roles matrix and the task board. React.lazy
 * splits each page into its own chunk, fetched the first time it is visited.
 *
 * The login page is NOT lazy — it is the first thing everyone sees, so
 * deferring it would add a spinner to the very first paint.
 */

import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppShell from '@/layouts/AppShell';
import ProtectedRoute from './ProtectedRoute';
import LoginPage from '@/features/auth/LoginPage';

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const EmployeeListPage = lazy(() => import('@/features/employees/EmployeeListPage'));
const AttendancePage = lazy(() => import('@/features/attendance/AttendancePage'));
const TasksPage = lazy(() => import('@/features/tasks/TasksPage'));
const RolesPage = lazy(() => import('@/features/roles/RolesPage'));
const UsersPage = lazy(() => import('@/features/users/UsersPage'));
const AuditPage = lazy(() => import('@/features/audit/AuditPage'));
const LeavePage = lazy(() => import('@/features/leave/LeavePage'));
const CorrectionsPage = lazy(() => import('@/features/corrections/CorrectionsPage'));

/** Shown for the moment a page chunk is downloading. */
function PageFallback() {
  return (
    <div className="flex flex-col gap-space-base">
      <div className="h-10 w-64 animate-pulse rounded-xl bg-card" />
      <div className="h-64 animate-pulse rounded-2xl bg-card" />
    </div>
  );
}

/** Wraps a lazy page in its Suspense boundary. */
function page(element: React.ReactNode) {
  return <Suspense fallback={<PageFallback />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },

  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },

          { path: '/dashboard', element: page(<DashboardPage />) },
          { path: '/attendance', element: page(<AttendancePage />) },
          { path: '/tasks', element: page(<TasksPage />) },
          { path: '/settings', element: page(<SettingsPage />) },

          // Screens that need a specific permission get their own guard.
          {
            element: <ProtectedRoute need={['employees.view_all']} />,
            children: [{ path: '/employees', element: page(<EmployeeListPage />) }],
          },
          {
            element: <ProtectedRoute need={['roles.manage']} />,
            children: [{ path: '/roles', element: page(<RolesPage />) }],
          },
          {
            element: <ProtectedRoute need={['users.manage']} />,
            children: [{ path: '/users', element: page(<UsersPage />) }],
          },
          {
            element: <ProtectedRoute need={['leave.view_all', 'leave.view_own']} />,
            children: [{ path: '/leave', element: page(<LeavePage />) }],
          },
          {
            element: <ProtectedRoute need={['corrections.request', 'corrections.view_all']} />,
            children: [{ path: '/corrections', element: page(<CorrectionsPage />) }],
          },
          {
            element: <ProtectedRoute need={['audit.view']} />,
            children: [{ path: '/audit', element: page(<AuditPage />) }],
          },
        ],
      },
    ],
  },

  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
