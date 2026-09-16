/**
 * src/config/index.ts
 *
 * Every value here is something the person setting up this specific tablet
 * might reasonably need to change — nothing else belongs in this file.
 */

import { localConfig } from './local.config.example';

export const config = {
  /**
   * HTTPS is mandatory, not a preference — PHASE-3-BRIEF.md is explicit
   * that the browser/WebView camera API refuses to run without it, and the
   * device code would otherwise travel in plain text. There is deliberately
   * no http:// fallback anywhere in this app for that reason.
   *
   * THE REAL VALUE LIVES IN local.config.ts, NOT HERE
   * -------------------------------------------------------
   * This file is committed to a PUBLIC repository — see src/config/local.config.ts's
   * own header comment for why the real server domain must never be typed
   * in here directly. If you're reading this because the app can't reach
   * your server, you almost certainly haven't done the one-time setup step:
   * copy local.config.example.ts to local.config.ts and fill in the real
   * domain there.
   */
  apiBaseUrl: localConfig.apiBaseUrl,

  /** 3 frames over ~1 second, per the brief's liveness check. With 3 frames,
   * 2 gaps between them — 500ms each puts the whole sequence at ~1000ms,
   * matching the brief's own wording rather than finishing in well under a
   * second the way a shorter interval does. Also gives capturePhotoToFile
   * itself (which is not instantaneous) more breathing room between shots,
   * so the person has a visible moment to actually hold still for each dot. */
  captureFrameCount: 3,
  captureIntervalMs: 500,

  /** Server-side thresholds are the source of truth (app/api/v1/face.py);
   * these are ONLY used client-side to pick which screen to show for a
   * given outcome string the server already decided on — never to
   * re-derive a match decision on-device. */
  matchThreshold: 0.85,
  unsureThreshold: 0.7,

  /** How long the greeting screen holds before returning to IDLE. */
  greetingHoldMs: 4000,

  /** Retry attempts before falling back to PIN, per the brief's kiosk
   * state machine: "Attempt 2 → PIN screen → see your manager". */
  maxFaceAttempts: 2,

  /** How often the offline queue tries to flush when the device is online.
   * Deliberately not instant-on-reconnect only — a flaky connection can
   * report "online" before it can actually complete a request. */
  queueRetryIntervalMs: 15_000,
} as const;

/**
 * The backend returns photoUrl as a path relative to its own origin (e.g.
 * "/uploads/photos/abc.jpg" — see employee.photo_url in
 * app/api/v1/photos.py), never a full URL. That works unmodified in a web
 * browser, where a relative src resolves against the current page's own
 * origin automatically — the admin app's Avatar.tsx relies on exactly that.
 * React Native has no "current page origin" to resolve against, so
 * <Image source={{ uri: '/uploads/...' }}> silently shows nothing, no
 * error, no crash — this function is what every screen that renders a
 * photoUrl from the API (GreetingScreen, UnsureScreen) must pass it
 * through first.
 */
export function resolveMediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path; // already absolute
  const origin = config.apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}