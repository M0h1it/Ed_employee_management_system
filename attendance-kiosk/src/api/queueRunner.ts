/**
 * src/api/queueRunner.ts
 *
 * The retry loop for queueStore.ts. Polls on an interval rather than only
 * reacting to a "back online" network event, because a flaky connection can
 * report itself as online before it can actually complete a request —
 * polling means a single bad moment does not need to be caught perfectly,
 * the next tick tries again regardless.
 *
 * Processes the queue ONE entry at a time, oldest first, and stops at the
 * first failure in a given pass rather than trying every entry regardless —
 * if the server or network is down, every other entry would fail for the
 * identical reason, so there is nothing to learn from attempting all of
 * them, only more requests to a server that is already not responding.
 */

import { getQueue, removeFromQueue, type QueuedPinPunch } from '../storage/queueStore';
import { submitPinPunch, NetworkUnavailableError, DeviceUnauthorizedError } from './kioskApi';
import { config } from '../config';

export type QueueRunnerListener = (remaining: number) => void;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false; // reentrancy guard — a slow flush must not overlap the next tick

/** Attempts to send the queue's oldest entry. Returns what happened, so the
 * caller (runOnce, or a manual "retry now" action) can decide whether to
 * keep going. Exported on its own for that manual case — the settings/debug
 * screen may want "try now" without waiting for the interval. */
export async function flushOne(): Promise<'sent' | 'empty' | 'failed' | 'device-invalid'> {
  const queue = await getQueue();
  if (queue.length === 0) return 'empty';

  const next: QueuedPinPunch = queue[0];
  try {
    await submitPinPunch(next.employeeCode, next.pin);
    await removeFromQueue(next.localId);
    return 'sent';
  } catch (error) {
    if (error instanceof DeviceUnauthorizedError) {
      // The code that queued this punch is no longer valid. Per this
      // project's own decision, the entry stays queued regardless — it
      // will start flushing again the moment a new code is entered and
      // this same runner's next tick fires. Nothing to clean up here.
      return 'device-invalid';
    }
    if (error instanceof NetworkUnavailableError) {
      return 'failed';
    }
    // A validation-style rejection from the server (e.g. the PIN was
    // changed after this punch was queued) is still a "failed" outcome
    // from the runner's point of view: it does not remove the entry,
    // because deciding "this will never succeed" from inside a background
    // retry loop is not this runner's job — a person looking at the
    // kiosk's queue screen should be the one to decide to discard it.
    return 'failed';
  }
}

async function runOnce(onProgress?: QueueRunnerListener): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Keep sending while entries succeed; stop at the first non-'sent'
    // outcome in this pass (see the file header for why).
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await flushOne();
      if (result === 'sent') {
        onProgress?.((await getQueue()).length);
        continue;
      }
      break;
    }
  } finally {
    running = false;
  }
}

/** Starts the background interval. Call once, from the app's root — see
 * App.tsx. Safe to call again after stop(); calling it while already
 * running replaces the previous interval rather than stacking a second
 * one. */
export function startQueueRunner(onProgress?: QueueRunnerListener): void {
  if (intervalHandle) clearInterval(intervalHandle);
  // Try once immediately on start (e.g. app just launched with a queue left
  // over from before it was closed), then on the regular interval.
  void runOnce(onProgress);
  intervalHandle = setInterval(() => void runOnce(onProgress), config.queueRetryIntervalMs);
}

export function stopQueueRunner(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}