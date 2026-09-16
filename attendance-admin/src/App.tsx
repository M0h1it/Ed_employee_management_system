/**
 * src/App.tsx
 *
 * Providers wrap the router. Order matters: QueryClientProvider must sit above
 * anything using a query hook, and the router sits inside it because the login
 * mutation calls useNavigate.
 *
 * ConfirmProvider and ToastProvider sit at the top so any component, at any
 * depth, can call useConfirm() or useToast() without threading props down.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { router } from '@/routes';
import { ConfirmProvider } from '@/components/common/ConfirmDialog';
import { ToastProvider } from '@/components/common/Toast';
import { useSessionBootstrap } from '@/features/auth/useSessionBootstrap';

/**
 * Held back until the session check finishes.
 *
 * Without this the router mounts with isAuthenticated still false, ProtectedRoute
 * redirects to /login, and the refresh lands a moment later — so a reload
 * flashes the sign-in screen and then jumps away. One brief splash is better
 * than a redirect the user can see happen.
 */
function Boot() {
  const state = useSessionBootstrap();

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <div className="flex flex-col items-center gap-space-md">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-[15px] font-bold text-white">
            N
          </div>
          <div className="h-1 w-24 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full w-1/3 animate-[slide-in-right_1s_ease-in-out_infinite] rounded-full bg-indigo-600" />
          </div>
        </div>
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <Boot />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
