/**
 * src/lib/apiClient.ts
 *
 * The ONLY place in the app that knows about fetch, base URLs and auth tokens.
 *
 * WHY CENTRALISE THIS: components calling fetch directly would each need to
 * remember to attach the token, parse the envelope, and turn a non-2xx status
 * into a thrown error. Forty components means forty chances to forget one.
 * Here it happens once.
 *
 * In Phase 2, when MSW is switched off and a real FastAPI server answers these
 * same URLs, this file does not change at all. That is the whole point of
 * routing every request through it.
 */

import { API_BASE } from '@/contracts/endpoints';
import type { ApiError } from '@/contracts/types';

/**
 * Thrown for any non-2xx response. Carries the parsed error body so a form can
 * show per-field messages.
 */
export class ApiException extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, body: ApiError | null) {
    super(body?.error?.message ?? `Request failed with status ${status}`);
    this.name = 'ApiException';
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.fields = body?.error?.fields;
  }
}

/**
 * The access token lives in a module variable, not localStorage.
 *
 * WHY NOT localStorage: any script running on the page can read it, which
 * makes an XSS bug into a full account takeover. Keeping it in memory means it
 * dies on refresh — in Phase 2 a refresh token in an httpOnly cookie restores
 * the session silently. For Phase 1 you simply log in again after a refresh.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

type QueryValue = string | number | boolean | undefined | null;

/** Turns { page: 1, search: 'ana', status: undefined } into '?page=1&search=ana'. */
function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // undefined and null are skipped so optional filters do not become the
    // literal string "undefined" in the URL.
    if (value === undefined || value === null || value === '') continue;
    qs.append(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * Called when a refresh succeeds or fails, so the auth store can update without
 * this module importing it — which would be a cycle, because the store imports
 * setAccessToken from here.
 */
type RefreshHandlers = {
  onRefreshed: (accessToken: string, user: unknown) => void;
  onFailed: () => void;
};

let refreshHandlers: RefreshHandlers | null = null;

export function setRefreshHandlers(handlers: RefreshHandlers) {
  refreshHandlers = handlers;
}

/**
 * The in-flight refresh, if there is one.
 *
 * SINGLE FLIGHT, ON PURPOSE
 * -------------------------
 * A dashboard fires five queries at once. When the access token expires, all
 * five come back 401 at roughly the same moment. Without this, each would start
 * its own refresh — five requests, and because refresh tokens ROTATE, four of
 * them would present a token the first one had already spent. The server reads
 * that as replay, revokes everything, and signs the user out.
 *
 * So the first 401 starts the refresh and the rest await the same promise.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        // The refresh token is an httpOnly cookie, so it is not read or sent by
        // this code — the browser attaches it. credentials: 'include' is what
        // permits that.
        credentials: 'include',
      });

      if (!response.ok) {
        refreshHandlers?.onFailed();
        return false;
      }

      const data = (await response.json()) as { accessToken: string; user: unknown };
      accessToken = data.accessToken;
      refreshHandlers?.onRefreshed(data.accessToken, data.user);
      return true;
    } catch {
      refreshHandlers?.onFailed();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: { body?: unknown; params?: Record<string, QueryValue> } = {},
  isRetry = false,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(url + buildQuery(options.params), {
    method,
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  /**
   * A 401 on a normal call means the 15-minute access token expired. Refresh
   * once and replay the request; the user sees nothing.
   *
   * `isRetry` stops this recursing: if the replayed request also 401s, the
   * session really is over. The auth endpoints are excluded because a failed
   * login must surface as a failed login, not trigger a refresh loop.
   */
  const isAuthCall = url.startsWith(`${API_BASE}/auth/`);
  if (response.status === 401 && !isRetry && !isAuthCall) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request<T>(method, url, options, true);
    }
  }

  // 204 No Content has no body to parse.
  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Body was empty or not JSON. Leave payload null and let the status decide.
  }

  if (!response.ok) {
    throw new ApiException(response.status, payload as ApiError | null);
  }

  return payload as T;
}

export const apiClient = {
  get: <T>(url: string, params?: Record<string, QueryValue>) =>
    request<T>('GET', url, { params }),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, { body }),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, { body }),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, { body }),
  delete: <T>(url: string) => request<T>('DELETE', url),
};
