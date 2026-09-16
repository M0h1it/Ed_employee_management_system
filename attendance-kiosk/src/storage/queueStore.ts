/**
 * src/storage/queueStore.ts
 *
 * The offline queue, decided explicitly in this project's own chat history:
 * a queued punch stays in local storage FOREVER if it cannot be sent — it
 * is never dropped, never expires — until the device has a working code
 * again, at which point everything queued retries automatically. This file
 * is the persistence layer for that; QueueRunner (queueRunner.ts) is what
 * actually drives the retry loop.
 *
 * ONLY PIN PUNCHES ARE QUEUABLE, NOT FACE PUNCHES
 * ----------------------------------------------------
 * A face punch needs live frames matched against the server's templates at
 * the moment of capture — there is nothing meaningful to "replay" later
 * from a stored photo, and storing raw face frames locally on a tablet
 * that might be lost or stolen is exactly the biometric-data-at-rest risk
 * PHASE-3-BRIEF.md's consent section is built around avoiding server-side
 * (encode-then-delete). So when the kiosk is offline, the flow the state
 * machine takes the person to is the PIN screen, not "try face offline" —
 * see kioskMachine.ts's OFFLINE state.
 *
 * IDEMPOTENCY IS THE SERVER'S JOB, NOT THIS QUEUE'S
 * -------------------------------------------------------
 * This queue does not need to detect or prevent duplicate submissions of
 * the same punch — app/api/v1/face.py's idempotency_key (built from
 * employee + date + direction + minute) already makes a replayed punch a
 * no-op on the server, returning the original result rather than erroring.
 * That is precisely why it is safe for this queue to be dumb and just keep
 * retrying: a punch that already succeeded but whose response was lost to
 * a dropped connection will not become a duplicate punch when retried.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'kiosk:pinPunchQueue';

export interface QueuedPinPunch {
  /** Client-generated, for React list keys and de-duplication in the UI
   * only — NOT sent to the server and NOT what makes a retry idempotent
   * (the server's idempotency_key, built server-side from the punch's own
   * identity, is what does that). */
  localId: string;
  employeeCode: string;
  pin: string;
  queuedAt: string; // ISO — shown to the admin/employee as "queued since", advisory only
}

export async function getQueue(): Promise<QueuedPinPunch[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupted storage is treated as an empty queue rather than thrown —
    // there is no recovery action a kiosk screen could offer for
    // unparseable local JSON, and surfacing an error here would block
    // the one thing this screen needs to keep doing, which is taking new
    // punches.
    return [];
  }
}

export async function enqueuePinPunch(employeeCode: string, pin: string): Promise<QueuedPinPunch> {
  const queue = await getQueue();
  const entry: QueuedPinPunch = {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    employeeCode,
    pin,
    queuedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...queue, entry]));
  return entry;
}

/** Removes exactly one entry by localId — used after that specific entry's
 * retry has succeeded. Never call this to "clear on failure"; a failed
 * retry means the entry stays, per the forever-until-it-works decision. */
export async function removeFromQueue(localId: string): Promise<void> {
  const queue = await getQueue();
  await AsyncStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(queue.filter((e) => e.localId !== localId)),
  );
}

export async function queueLength(): Promise<number> {
  return (await getQueue()).length;
}