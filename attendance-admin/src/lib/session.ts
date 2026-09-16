/**
 * src/lib/session.ts
 *
 * Session policy, in one place so the numbers are not scattered through
 * components.
 *
 * TWO SEPARATE LIMITS, AND THEY DO DIFFERENT JOBS
 * -----------------------------------------------
 * IDLE_LIMIT ends a session that has been left unattended — the laptop someone
 * walked away from. It resets on every real interaction, so a person working
 * continuously is never interrupted.
 *
 * ABSOLUTE_LIMIT ends a session no matter how active it has been. Without it, a
 * browser left running with a script nudging the mouse would stay signed in
 * forever, and a stolen token would never expire on its own.
 *
 * Only the idle limit gets a warning. The absolute one is rare and expected —
 * warning about it would just add a dialog people learn to dismiss.
 */

/** How long without interaction before the session ends. */
export const IDLE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes

/** How long before the warning appears — counts down inside the idle window. */
export const IDLE_WARNING_MS = 2 * 60 * 1000; // last 2 minutes

/** Hard ceiling on one session, regardless of activity. */
export const ABSOLUTE_LIMIT_MS = 10 * 60 * 60 * 1000; // 10 hours

/** Why a session ended, so the login screen can say the right thing. */
export type LogoutReason = 'idle' | 'expired' | 'manual' | null;

export const LOGOUT_MESSAGES: Record<Exclude<LogoutReason, null>, string> = {
  idle: 'You were signed out after 30 minutes of inactivity. Sign in to carry on.',
  expired: 'Your session reached its time limit. Sign in to carry on.',
  manual: 'You have been signed out.',
};

/**
 * Events that count as "the person is still here".
 *
 * `scroll` and `visibilitychange` are included deliberately: reading a long
 * attendance register without touching the keyboard is still working, and
 * returning to the tab is a clear signal of presence.
 */
export const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'wheel',
  'scroll',
  'touchstart',
  'pointerdown',
] as const;
