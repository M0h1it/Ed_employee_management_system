/**
 * src/features/auth/useSessionBootstrap.ts
 *
 * Restores a session on a cold page load.
 *
 * WHY THIS IS NEEDED AT ALL
 * --------------------------
 * The access token lives in a module variable, not localStorage — so an XSS bug
 * cannot read it, and a page refresh discards it. That is the right trade-off,
 * but on its own it means every reload lands on the login screen even though
 * the httpOnly refresh cookie is sitting right there.
 *
 * So the app asks once, at startup: exchange the cookie for an access token. If
 * it works the session continues; if not, the login screen appears as before.
 *
 * The result is that a reload keeps you signed in for up to seven days, without
 * any long-lived credential ever being readable by JavaScript.
 */

import { useEffect, useState } from 'react';
import { API_BASE } from '@/contracts/endpoints';
import { useAuthStore } from '@/stores/authStore';
import type { CurrentUser } from '@/contracts/types';

export type BootstrapState = 'checking' | 'done';

/**
 * A hint that a session once existed on this browser.
 *
 * NOT a credential — it holds nothing, and forging it achieves nothing beyond
 * one refused request. Its only job is to stop a first-time visitor's page load
 * firing a refresh that is certain to 401, which fills the console with an
 * error that looks like a bug and is not.
 *
 * The refresh token itself stays in an httpOnly cookie that this code cannot
 * read — which is exactly why a separate hint is needed at all.
 */
const SESSION_HINT = 'attendance.session';

export function markSessionStarted() {
  try {
    localStorage.setItem(SESSION_HINT, '1');
  } catch {
    // Private browsing, or storage disabled. The cost is one wasted request on
    // reload, which is not worth failing a sign-in over.
  }
}

export function clearSessionHint() {
  try {
    localStorage.removeItem(SESSION_HINT);
  } catch {
    /* as above */
  }
}

/**
 * StrictMode runs effects twice in development, so without a guard the
 * refresh fires twice on every cold load — and because refresh tokens
 * ROTATE, the second call presents a token the first already spent. The
 * server reads that as replay and revokes every session.
 *
 * The guard is the in-flight PROMISE itself, not just a boolean. A boolean
 * stops the second effect run from starting its own fetch, but StrictMode's
 * mount -> cleanup -> remount also tears down the first run's closure before
 * the fetch resolves, marking IT cancelled — so if only the first run's
 * promise held the result, nothing still listening would ever be told it
 * finished, and the "checking" splash in App.tsx's Boot component would
 * never clear. Sharing the promise lets the second (surviving) effect run
 * await the very same request and act on its result itself.
 */
let bootstrapPromise: Promise<{ accessToken: string; user: CurrentUser } | null> | null = null;

async function runBootstrap(): Promise<{ accessToken: string; user: CurrentUser } | null> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        // The cookie is gone or expired. Drop the hint so the next load does
        // not try again.
        clearSessionHint();
        return null;
      }

      return (await response.json()) as { accessToken: string; user: CurrentUser };
    } catch {
      // No cookie, expired, or the backend is down. All three mean the same
      // thing here: show the login screen. The specific reason is not useful
      // to somebody who simply needs to sign in.
      return null;
    }
  })();

  return bootstrapPromise;
}

export function useSessionBootstrap(): BootstrapState {
  const setSession = useAuthStore((s) => s.setSession);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hadSession = (() => {
    try {
      return localStorage.getItem(SESSION_HINT) === '1';
    } catch {
      return true; // cannot tell, so try
    }
  })();

  const [state, setState] = useState<BootstrapState>(
    // Already signed in (a hot reload), or never signed in on this browser.
    // Either way there is nothing to check and no splash to show.
    isAuthenticated || !hadSession ? 'done' : 'checking',
  );

  useEffect(() => {
    if (state === 'done') return;

    // Every mounted instance — including a StrictMode remount — awaits the
    // SAME shared promise (runBootstrap only ever sends one fetch), but each
    // instance still applies the result to itself. Whichever instance is
    // actually mounted when it resolves is the one that clears the splash.
    let cancelled = false;

    runBootstrap().then((result) => {
      if (cancelled) return;
      if (result) setSession(result.user, result.accessToken);
      setState('done');
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}