/**
 * src/lib/useIdleTimer.ts
 *
 * Watches for activity and reports when the session is about to end.
 *
 * WHY THE TIMESTAMP LIVES IN A REF, NOT STATE
 * --------------------------------------------
 * mousemove fires dozens of times a second. Storing the last-activity time in
 * React state would re-render the whole tree on every pixel of movement. A ref
 * updates without rendering; a separate one-second interval reads it and only
 * then decides whether anything visible needs to change.
 *
 * The listeners are also passive, so scrolling stays smooth.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ACTIVITY_EVENTS,
  IDLE_LIMIT_MS,
  IDLE_WARNING_MS,
  ABSOLUTE_LIMIT_MS,
} from './session';

interface Options {
  enabled: boolean;
  onIdle: () => void;
  onExpired: () => void;
}

export function useIdleTimer({ enabled, onIdle, onExpired }: Options) {
  const lastActivity = useRef(Date.now());
  const sessionStart = useRef(Date.now());

  /** Milliseconds left before sign-out, or null while the session is healthy. */
  const [warningMsLeft, setWarningMsLeft] = useState<number | null>(null);

  // Callbacks land in refs so the effect below never needs them as
  // dependencies — otherwise it would tear down and rebuild every listener on
  // each render of the parent.
  const onIdleRef = useRef(onIdle);
  const onExpiredRef = useRef(onExpired);
  onIdleRef.current = onIdle;
  onExpiredRef.current = onExpired;

  useEffect(() => {
    if (!enabled) {
      setWarningMsLeft(null);
      return;
    }

    lastActivity.current = Date.now();
    sessionStart.current = Date.now();

    function markActive() {
      lastActivity.current = Date.now();
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }

    // Returning to the tab counts as presence.
    function onVisible() {
      if (document.visibilityState === 'visible') markActive();
    }
    document.addEventListener('visibilitychange', onVisible);

    const interval = window.setInterval(() => {
      const now = Date.now();

      if (now - sessionStart.current >= ABSOLUTE_LIMIT_MS) {
        onExpiredRef.current();
        return;
      }

      const idleFor = now - lastActivity.current;

      if (idleFor >= IDLE_LIMIT_MS) {
        onIdleRef.current();
        return;
      }

      const msLeft = IDLE_LIMIT_MS - idleFor;
      // Only touch state when the answer actually changes category, so a
      // healthy session re-renders nothing.
      setWarningMsLeft((prev) => {
        if (msLeft > IDLE_WARNING_MS) return prev === null ? prev : null;
        return Math.max(0, msLeft);
      });
    }, 1000);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [enabled]);

  /** Called by the warning dialog's "Stay signed in" button. */
  function resetIdle() {
    lastActivity.current = Date.now();
    setWarningMsLeft(null);
  }

  return { warningMsLeft, resetIdle };
}
