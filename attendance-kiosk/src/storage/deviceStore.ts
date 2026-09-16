/**
 * src/storage/deviceStore.ts
 *
 * Holds the ONE thing this tablet needs to remember across restarts: its
 * own device code, entered once during setup (see DevicesPanel.tsx's
 * "Register a kiosk device" flow on the admin side). Deliberately separate
 * from the offline punch queue (queueStore.ts) — different lifetime, this
 * survives until someone explicitly re-runs setup; the queue drains and
 * empties in normal operation.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_CODE_KEY = 'kiosk:deviceCode';

export async function getDeviceCode(): Promise<string | null> {
  return AsyncStorage.getItem(DEVICE_CODE_KEY);
}

export async function setDeviceCode(code: string): Promise<void> {
  await AsyncStorage.setItem(DEVICE_CODE_KEY, code);
}

/** Used only by the setup screen's "this isn't my tablet" / re-setup path —
 * never called as a side effect of a failed request. A 401 from the server
 * means the code is no longer valid, not that it should be erased; erasing
 * it here would throw away the one piece of evidence an admin might need
 * when diagnosing why a tablet went offline. */
export async function clearDeviceCode(): Promise<void> {
  await AsyncStorage.removeItem(DEVICE_CODE_KEY);
}