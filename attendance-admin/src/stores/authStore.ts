/**
 * src/stores/authStore.ts
 *
 * The only global client state in the application: who is signed in.
 *
 * WHY ZUSTAND AND NOT REDUX: this is one object with three fields. Redux would
 * be two hundred lines of boilerplate for it. WHY NOT CONTEXT: a Context value
 * change re-renders the entire tree beneath it; Zustand lets each component
 * subscribe to just the slice it reads.
 *
 * WHY permissions IS A Set: `can()` runs on nearly every render of every page.
 * Array.includes is a linear scan; Set.has is constant time. With fifteen
 * permissions the difference is academic, but the Set also makes the intent
 * obvious — this is a membership test, not a list.
 */

import { create } from 'zustand';
import type { CurrentUser } from '@/contracts/types';
import type { Permission } from '@/contracts/permissions';
import { setAccessToken, setRefreshHandlers } from '@/lib/apiClient';
import {
  clearSessionHint,
  markSessionStarted,
} from '@/features/auth/useSessionBootstrap';
import type { LogoutReason } from '@/lib/session';

interface AuthState {
  user: CurrentUser | null;
  permissions: Set<Permission>;
  isAuthenticated: boolean;

  /**
   * Why the last session ended. The login screen reads this to explain what
   * happened, instead of leaving someone staring at a login form wondering
   * whether the app crashed.
   */
  logoutReason: LogoutReason;

  setSession: (user: CurrentUser, accessToken: string) => void;
  clearSession: (reason?: LogoutReason) => void;
  acknowledgeLogout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  permissions: new Set<Permission>(),
  isAuthenticated: false,
  logoutReason: null,

  setSession: (user, accessToken) => {
    // The token goes to the api client, not into this store. Keeping it out of
    // component-reachable state means no component can accidentally render it.
    setAccessToken(accessToken);
    markSessionStarted();
    set({
      user,
      permissions: new Set(user.permissions),
      isAuthenticated: true,
      logoutReason: null,
    });
  },

  /**
   * Clearing isAuthenticated is what actually locks the app: ProtectedRoute
   * reads it, so every guarded route bounces to /login the moment this runs.
   * The sidebar disappears with the shell. Nothing else has to be disabled by
   * hand, and nothing can be reached by typing a URL.
   */
  clearSession: (reason = 'manual') => {
    setAccessToken(null);
    clearSessionHint();
    set({
      user: null,
      permissions: new Set(),
      isAuthenticated: false,
      logoutReason: reason,
    });
  },

  /** Called once the login screen has shown the message. */
  acknowledgeLogout: () => set({ logoutReason: null }),
}));

/**
 * Wires the api client's silent refresh back into the store.
 *
 * Registered here rather than imported the other way round, because apiClient
 * must not import the store — the store already imports setAccessToken from it,
 * and the cycle would leave one of them undefined at module-evaluation time
 * depending on which loaded first.
 */
setRefreshHandlers({
  onRefreshed: (accessToken, user) => {
    // The refresh response carries the user, so a role change made while the
    // session was open takes effect here without a separate /me call.
    useAuthStore.getState().setSession(user as CurrentUser, accessToken);
  },
  onFailed: () => {
    useAuthStore.getState().clearSession('expired');
  },
});
