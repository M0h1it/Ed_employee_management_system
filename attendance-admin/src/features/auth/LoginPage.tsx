/**
 * src/features/auth/LoginPage.tsx
 *
 * The sign-in screen.
 *
 * Note what this component does NOT do: it does not call fetch, it does not
 * know the login URL, it does not decide where to navigate on success. All of
 * that lives in features/auth/api.ts. The component's only job is to collect
 * two fields and render three states — idle, pending, error.
 */

import { useEffect, useState } from 'react';
import { useLogin } from './api';
import { ApiException } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { LOGOUT_MESSAGES } from '@/lib/session';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const login = useLogin();

  /**
   * Why the previous session ended. Without this, somebody who was working and
   * came back to a login screen has no idea whether the app crashed, they were
   * kicked out, or they misclicked — and the first thing they do is ask you.
   */
  const logoutReason = useAuthStore((s) => s.logoutReason);
  const acknowledgeLogout = useAuthStore((s) => s.acknowledgeLogout);
  const [notice] = useState(
    logoutReason && logoutReason !== 'manual' ? LOGOUT_MESSAGES[logoutReason] : null,
  );

  // Read once, then clear, so it does not reappear after a later manual
  // sign-out.
  useEffect(() => {
    if (logoutReason) acknowledgeLogout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errorMessage =
    login.error instanceof ApiException
      ? login.error.message
      : login.error
        ? 'Something went wrong. Please try again.'
        : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    login.mutate({ username, password });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-space-base">
      <div className="w-full max-w-[400px]">
        {/* Brand */}
        <div className="mb-space-lg flex items-center gap-space-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 font-label-md text-label-md text-white">
            N
          </div>
          <div className="flex flex-col">
            <span className="font-headline-md text-headline-md text-zinc-900">
              Nexus Operations
            </span>
            <span className="font-label-sm text-label-sm text-zinc-500">
              Attendance &amp; workforce
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-black/[0.06] bg-card p-space-base shadow-xs sm:p-space-lg">
          <h1 className="font-headline-lg text-headline-lg text-zinc-900">
            Sign in
          </h1>
          <p className="mt-space-xxs font-body-sm text-body-sm text-zinc-500">
            Use the credentials issued by your administrator.
          </p>

          {notice && !errorMessage && (
            <div
              role="status"
              className="mt-space-base flex items-start gap-space-sm rounded-xl border border-amber-200 bg-amber-50 px-space-md py-space-sm font-body-sm text-body-sm text-amber-700"
            >
              <span className="icon mt-0.5 shrink-0 text-[16px]">timer_off</span>
              <span>{notice}</span>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="mt-space-base rounded-xl bg-red-50 px-space-md py-space-sm font-body-sm text-body-sm text-red-600"
            >
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-space-lg flex flex-col gap-space-base">
            <label className="flex flex-col gap-space-xs">
              <span className="font-label-md text-label-md text-zinc-500">
                Username
              </span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 rounded-xl bg-zinc-50 px-space-md font-body-md text-body-md text-zinc-900 outline-none ring-indigo-200 focus:ring-2"
              />
            </label>

            <label className="flex flex-col gap-space-xs">
              <span className="font-label-md text-label-md text-zinc-500">
                Password
              </span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 w-full rounded-xl bg-zinc-50 pl-space-md pr-10 font-body-md text-body-md text-zinc-900 outline-none ring-indigo-200 focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-space-sm top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-900"
                >
                  <span className="icon text-[18px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={login.isPending || !username || !password}
              className="mt-space-sm h-10 rounded-xl bg-indigo-600 font-label-md text-label-md text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Demo accounts. Delete this block before the system goes live. */}
        <div className="mt-space-base rounded-2xl bg-zinc-50 p-space-md">
          <p className="font-label-sm text-label-sm uppercase tracking-wider text-zinc-400">
            Demo accounts
          </p>
          <ul className="mt-space-xs flex flex-col gap-space-xxs font-mono-data text-mono-data text-zinc-500">
            <li>owner / owner123 — full access</li>
            <li>marcus / demo123 — manager</li>
            <li>karan / demo123 — employee</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
