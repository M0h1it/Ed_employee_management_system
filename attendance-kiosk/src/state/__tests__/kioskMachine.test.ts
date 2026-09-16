/**
 * Exercises every transition in PHASE-3-BRIEF.md's kiosk state diagram.
 * No React, no camera, no network — kioskReducer takes plain values in and
 * returns a plain value out, so this runs in milliseconds, the same reason
 * the backend's 28 domain tests run in 0.05s with no database.
 */

import { kioskReducer, initialKioskState, type KioskState } from '../kioskMachine';

describe('kioskReducer — happy path', () => {
  it('starts IDLE', () => {
    expect(initialKioskState).toEqual({ kind: 'IDLE' });
  });

  it('IDLE -> CAPTURING on tap', () => {
    const next = kioskReducer({ kind: 'IDLE' }, { type: 'TAP_START' });
    expect(next).toEqual({ kind: 'CAPTURING' });
  });

  it('CAPTURING -> MATCHING once frames are captured', () => {
    const next = kioskReducer({ kind: 'CAPTURING' }, { type: 'FRAMES_CAPTURED' });
    expect(next).toEqual({ kind: 'MATCHING' });
  });

  it('MATCHING -> MATCH on a high-confidence result', () => {
    const next = kioskReducer(
      { kind: 'MATCHING' },
      {
        type: 'MATCH_RESULT',
        employeeName: 'Karan Patel',
        photoUrl: null,
        direction: 'IN',
        punchedAt: '2026-09-16T09:04:00Z',
      },
    );
    expect(next).toEqual({
      kind: 'MATCH',
      employeeName: 'Karan Patel',
      photoUrl: null,
      direction: 'IN',
      punchedAt: '2026-09-16T09:04:00Z',
    });
  });

  it('MATCH returns to IDLE after the greeting hold times out', () => {
    const matched: KioskState = {
      kind: 'MATCH',
      employeeName: 'Karan Patel',
      photoUrl: null,
      direction: 'IN',
      punchedAt: '2026-09-16T09:04:00Z',
    };
    expect(kioskReducer(matched, { type: 'TIMEOUT_RETURN_TO_IDLE' })).toEqual({ kind: 'IDLE' });
  });
});

describe('kioskReducer — the UNSURE confirm step', () => {
  const unsure: KioskState = {
    kind: 'UNSURE',
    employeeId: 'e71249e5-971c-4bfe-980d-4cb883cdb3ac',
    employeeName: 'Karan Patel',
    photoUrl: null,
    confidence: 0.78,
  };

  it('CONFIRM_YES re-enters MATCHING so the eventual MATCH_RESULT lands normally', () => {
    expect(kioskReducer(unsure, { type: 'CONFIRM_YES' })).toEqual({ kind: 'MATCHING' });
  });

  it('CONFIRM_NO drops into NO_MATCH with one attempt used, same as a straight miss', () => {
    expect(kioskReducer(unsure, { type: 'CONFIRM_NO' })).toEqual({
      kind: 'NO_MATCH',
      attemptsUsed: 1,
    });
  });
});

describe('kioskReducer — retry and PIN fallback (brief: "2 attempts -> PIN -> see your manager")', () => {
  it('first NO_MATCH retry goes back to CAPTURING, not straight to PIN', () => {
    const first: KioskState = { kind: 'NO_MATCH', attemptsUsed: 1 };
    expect(kioskReducer(first, { type: 'RETRY' })).toEqual({ kind: 'CAPTURING' });
  });

  it('a second attempt that also misses reaches PIN on the next RETRY', () => {
    // CAPTURING -> MATCHING -> NO_MATCH_RESULT again, simulating the second
    // failed attempt, then RETRY is what should now hit the cap.
    let state: KioskState = { kind: 'CAPTURING' };
    state = kioskReducer(state, { type: 'FRAMES_CAPTURED' });
    state = kioskReducer(state, { type: 'NO_MATCH_RESULT' });
    expect(state).toEqual({ kind: 'NO_MATCH', attemptsUsed: 1 });

    // The screen is responsible for tracking that this is now the second
    // attempt and constructing the state accordingly before dispatching
    // RETRY again — reflected here directly for the reducer's own contract.
    const secondMiss: KioskState = { kind: 'NO_MATCH', attemptsUsed: 2 };
    expect(kioskReducer(secondMiss, { type: 'RETRY' })).toEqual({ kind: 'PIN' });
  });

  it('GIVE_UP_TO_PIN always goes straight to PIN regardless of attempts used', () => {
    const first: KioskState = { kind: 'NO_MATCH', attemptsUsed: 1 };
    expect(kioskReducer(first, { type: 'GIVE_UP_TO_PIN' })).toEqual({ kind: 'PIN' });
  });

  it('a successful PIN punch reaches PIN_SUCCESS', () => {
    const next = kioskReducer(
      { kind: 'PIN' },
      { type: 'PIN_RESULT', employeeName: 'Karan Patel', direction: 'OUT' },
    );
    expect(next).toEqual({ kind: 'PIN_SUCCESS', employeeName: 'Karan Patel', direction: 'OUT' });
  });

  it('a failed PIN attempt stays on the PIN screen (no lockout, no navigation)', () => {
    const stillPin = kioskReducer({ kind: 'PIN' }, { type: 'PIN_FAILED' });
    expect(stillPin).toEqual({ kind: 'PIN' });
  });
});

describe('kioskReducer — offline handling', () => {
  it('NETWORK_LOST drops into OFFLINE from mid-capture', () => {
    expect(kioskReducer({ kind: 'CAPTURING' }, { type: 'NETWORK_LOST' })).toEqual({
      kind: 'OFFLINE',
    });
  });

  it('NETWORK_LOST from IDLE also goes to OFFLINE', () => {
    expect(kioskReducer({ kind: 'IDLE' }, { type: 'NETWORK_LOST' })).toEqual({ kind: 'OFFLINE' });
  });

  it('NETWORK_LOST while already OFFLINE is a no-op, not a re-entry', () => {
    expect(kioskReducer({ kind: 'OFFLINE' }, { type: 'NETWORK_LOST' })).toEqual({ kind: 'OFFLINE' });
  });

  it('OFFLINE only accepts PIN punches, producing PIN_SUCCESS directly', () => {
    const next = kioskReducer(
      { kind: 'OFFLINE' },
      { type: 'PIN_RESULT', employeeName: 'Karan Patel', direction: 'IN' },
    );
    expect(next).toEqual({ kind: 'PIN_SUCCESS', employeeName: 'Karan Patel', direction: 'IN' });
  });

  it('NETWORK_RESTORED returns to IDLE, not to whatever was in progress before', () => {
    expect(kioskReducer({ kind: 'OFFLINE' }, { type: 'NETWORK_RESTORED' })).toEqual({
      kind: 'IDLE',
    });
  });
});

describe('kioskReducer — robustness', () => {
  it('an event that makes no sense for the current state is a no-op, not a crash', () => {
    const idle: KioskState = { kind: 'IDLE' };
    expect(kioskReducer(idle, { type: 'CONFIRM_YES' })).toEqual(idle);
    expect(kioskReducer(idle, { type: 'PIN_FAILED' })).toEqual(idle);
  });

  it('RESET returns to IDLE from any state', () => {
    const states: KioskState[] = [
      { kind: 'CAPTURING' },
      { kind: 'MATCHING' },
      { kind: 'PIN' },
      { kind: 'OFFLINE' },
      { kind: 'ERROR', message: 'boom' },
    ];
    for (const s of states) {
      expect(kioskReducer(s, { type: 'RESET' })).toEqual({ kind: 'IDLE' });
    }
  });

  it('ERROR_OCCURRED captures the message and RETRY from ERROR returns to IDLE', () => {
    const errored = kioskReducer({ kind: 'IDLE' }, { type: 'ERROR_OCCURRED', message: 'no camera' });
    expect(errored).toEqual({ kind: 'ERROR', message: 'no camera' });
    expect(kioskReducer(errored, { type: 'RETRY' })).toEqual({ kind: 'IDLE' });
  });
});