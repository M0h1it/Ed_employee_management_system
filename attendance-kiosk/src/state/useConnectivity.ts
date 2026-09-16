/**
 * src/state/useConnectivity.ts
 *
 * This app deliberately does NOT depend on @react-native-community/netinfo.
 * "Online" here means one specific thing: the last request this kiosk made
 * to its own backend succeeded or failed — not what the OS thinks about
 * Wi-Fi association, which can say "connected" while the server is
 * unreachable (captive portal, VPN, DNS issue, server down) and would give
 * a false "back online" that immediately fails again.
 *
 * KioskScreen calls reportSuccess()/reportFailure() after every real
 * request; this hook only turns that stream of outcomes into the
 * NETWORK_LOST / NETWORK_RESTORED events the reducer understands, debounced
 * so a single dropped request does not flip the whole kiosk into OFFLINE.
 */

import { useCallback, useRef, useState } from 'react';

const FAILURES_BEFORE_OFFLINE = 2;

export function useConnectivity() {
  const [isOnline, setIsOnline] = useState(true);
  const consecutiveFailures = useRef(0);

  const reportSuccess = useCallback(() => {
    consecutiveFailures.current = 0;
    setIsOnline((was) => (was ? was : true));
  }, []);

  const reportFailure = useCallback(() => {
    consecutiveFailures.current += 1;
    if (consecutiveFailures.current >= FAILURES_BEFORE_OFFLINE) {
      setIsOnline((was) => (was ? false : was));
    }
  }, []);

  return { isOnline, reportSuccess, reportFailure };
}