/**
 * src/state/kioskMachine.ts
 *
 * Implements the state diagram from PHASE-3-BRIEF.md's "Kiosk state
 * machine" section exactly:
 *
 *   IDLE -> (tap) -> CAPTURING -> MATCHING -> MATCH | UNSURE | NO_MATCH
 *   NO_MATCH, after maxFaceAttempts -> PIN
 *   No network at any point -> OFFLINE (PIN only, punch queued)
 *
 * This file has NO React, no navigation, no UI — it is a pure reducer, the
 * same "domain stays pure" discipline the backend's attendance_rules.py
 * follows, for the same reason: a state transition table is easy to get
 * subtly wrong, and a pure function is what makes it possible to write a
 * test that exercises every transition without a rendered screen, a
 * camera, or a network call anywhere near it.
 */

export type KioskState =
  | { kind: 'IDLE' }
  | { kind: 'CAPTURING' }
  | { kind: 'MATCHING' }
  | {
      kind: 'MATCH';
      employeeName: string;
      photoUrl: string | null;
      direction: 'IN' | 'OUT';
      punchedAt: string;
    }
  | { kind: 'UNSURE'; employeeId: string; employeeName: string; photoUrl: string | null; confidence: number }
  | { kind: 'NO_MATCH'; attemptsUsed: number }
  | { kind: 'PIN' }
  | { kind: 'PIN_SUCCESS'; employeeName: string; direction: 'IN' | 'OUT' }
  | { kind: 'OFFLINE' }
  | { kind: 'ERROR'; message: string };

export type KioskEvent =
  | { type: 'TAP_START' }
  | { type: 'FRAMES_CAPTURED' }
  | { type: 'LIVENESS_FAILED' }
  | { type: 'MATCH_RESULT'; employeeName: string; photoUrl: string | null; direction: 'IN' | 'OUT'; punchedAt: string }
  | { type: 'UNSURE_RESULT'; employeeId: string; employeeName: string; photoUrl: string | null; confidence: number }
  | { type: 'NO_MATCH_RESULT' }
  | { type: 'CONFIRM_YES' }
  | { type: 'CONFIRM_NO' }
  | { type: 'RETRY' }
  | { type: 'GIVE_UP_TO_PIN' }
  | { type: 'PIN_RESULT'; employeeName: string; direction: 'IN' | 'OUT' }
  | { type: 'PIN_FAILED' }
  | { type: 'NETWORK_LOST' }
  | { type: 'NETWORK_RESTORED' }
  | { type: 'TIMEOUT_RETURN_TO_IDLE' }
  | { type: 'ERROR_OCCURRED'; message: string }
  | { type: 'RESET' };

const MAX_FACE_ATTEMPTS = 2; // mirrors config.maxFaceAttempts; duplicated as a
// literal here on purpose — this file takes no imports at all, including
// from config, so it stays trivially unit-testable with zero setup, exactly
// like attendance_rules.py takes no FastAPI or SQLAlchemy import.

/**
 * The one function in this file. Given the current state and an event,
 * returns the next state. Never throws — an event that makes no sense for
 * the current state (e.g. CONFIRM_YES while IDLE) is simply a no-op,
 * returning the same state back, because a stray event arriving from a
 * screen that is mid-transition-away should never crash the kiosk.
 */
export function kioskReducer(state: KioskState, event: KioskEvent): KioskState {
  // NETWORK_LOST and RESET are handled identically from every state — see
  // below — so they are checked first rather than duplicated in every
  // branch of the switch that follows.
  if (event.type === 'NETWORK_LOST' && state.kind !== 'OFFLINE') {
    return { kind: 'OFFLINE' };
  }
  if (event.type === 'RESET') {
    return { kind: 'IDLE' };
  }
  if (event.type === 'ERROR_OCCURRED') {
    return { kind: 'ERROR', message: event.message };
  }

  switch (state.kind) {
    case 'IDLE':
      if (event.type === 'TAP_START') return { kind: 'CAPTURING' };
      return state;

    case 'CAPTURING':
      if (event.type === 'FRAMES_CAPTURED') return { kind: 'MATCHING' };
      if (event.type === 'LIVENESS_FAILED') return { kind: 'NO_MATCH', attemptsUsed: 1 };
      return state;

    case 'MATCHING':
      if (event.type === 'MATCH_RESULT') {
        return {
          kind: 'MATCH',
          employeeName: event.employeeName,
          photoUrl: event.photoUrl,
          direction: event.direction,
          punchedAt: event.punchedAt,
        };
      }
      if (event.type === 'UNSURE_RESULT') {
        return {
          kind: 'UNSURE',
          employeeId: event.employeeId,
          employeeName: event.employeeName,
          photoUrl: event.photoUrl,
          confidence: event.confidence,
        };
      }
      if (event.type === 'NO_MATCH_RESULT') return { kind: 'NO_MATCH', attemptsUsed: 1 };
      return state;

    case 'UNSURE':
      // "Are you {name}?" [Yes] [No] — confirming answers the direction
      // question the same way a MATCH would; declining is treated the same
      // as a straightforward no-match, feeding into the same retry/PIN path
      // rather than a separate one, because from here on the two cases have
      // identical next steps.
      if (event.type === 'CONFIRM_YES') {
        // The confirming screen has no punch result of its own yet — it
        // re-enters MATCHING so the same MATCH_RESULT event this state
        // already knows how to handle is what actually produces the
        // punched-in/out screen. The caller (CaptureScreen) is responsible
        // for calling the API on CONFIRM_YES and dispatching MATCH_RESULT
        // when it resolves.
        return { kind: 'MATCHING' };
      }
      if (event.type === 'CONFIRM_NO') return { kind: 'NO_MATCH', attemptsUsed: 1 };
      return state;

    case 'NO_MATCH':
      if (event.type === 'RETRY') {
        if (state.attemptsUsed >= MAX_FACE_ATTEMPTS) return { kind: 'PIN' };
        return { kind: 'CAPTURING' };
      }
      if (event.type === 'GIVE_UP_TO_PIN') return { kind: 'PIN' };
      return state;

    case 'PIN':
      if (event.type === 'PIN_RESULT') {
        return { kind: 'PIN_SUCCESS', employeeName: event.employeeName, direction: event.direction };
      }
      // PIN_FAILED deliberately does not change state — the PIN screen
      // stays open and shows its own inline error, the same way a login
      // form does not navigate away on a wrong password. There is no
      // attempt limit on the PIN screen itself (unlike face matching):
      // the brief's fallback chain already ends here, and a PIN, once
      // wrong, does not lock the kiosk — it just does not punch anyone in.
      if (event.type === 'PIN_FAILED') return state;
      return state;

    case 'PIN_SUCCESS':
      if (event.type === 'TIMEOUT_RETURN_TO_IDLE') return { kind: 'IDLE' };
      return state;

    case 'MATCH':
      if (event.type === 'TIMEOUT_RETURN_TO_IDLE') return { kind: 'IDLE' };
      return state;

    case 'OFFLINE':
      // Offline is PIN-only per the brief — there is no face path to
      // re-enter from here even implicitly. Only a real network recovery
      // (NETWORK_RESTORED, driven by the app's connectivity listener, not
      // by user action) leaves this state.
      if (event.type === 'NETWORK_RESTORED') return { kind: 'IDLE' };
      if (event.type === 'PIN_RESULT') {
        return { kind: 'PIN_SUCCESS', employeeName: event.employeeName, direction: event.direction };
      }
      return state;

    case 'ERROR':
      if (event.type === 'RETRY') return { kind: 'IDLE' };
      return state;

    default:
      return state;
  }
}

export const initialKioskState: KioskState = { kind: 'IDLE' };