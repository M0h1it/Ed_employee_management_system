/**
 * Exercises useConnectivity's debounce logic directly — this is the signal
 * that drives KioskScreen's persistent offline badge (added at the
 * person's explicit request: offline must be visible on every screen, not
 * discoverable only by trying to punch). No native modules involved, so
 * this runs the same way kioskMachine.test.ts does: a small harness
 * component rendered with react-test-renderer, the same tool the existing
 * App.test.tsx smoke test already uses in this project.
 */

import React from 'react';
import { act, create } from 'react-test-renderer';
import { useConnectivity } from '../useConnectivity';

function Harness({ onRender }: { onRender: (api: ReturnType<typeof useConnectivity>) => void }) {
  const api = useConnectivity();
  onRender(api);
  return null;
}

describe('useConnectivity', () => {
  it('starts online', () => {
    let latest!: ReturnType<typeof useConnectivity>;
    act(() => {
      create(<Harness onRender={(api) => (latest = api)} />);
    });
    expect(latest.isOnline).toBe(true);
  });

  it('does not flip offline after a single failure — debounced by design', () => {
    let latest!: ReturnType<typeof useConnectivity>;
    act(() => {
      create(<Harness onRender={(api) => (latest = api)} />);
    });

    act(() => {
      latest.reportFailure();
    });
    expect(latest.isOnline).toBe(true);
  });

  it('flips offline after two consecutive failures', () => {
    let latest!: ReturnType<typeof useConnectivity>;
    act(() => {
      create(<Harness onRender={(api) => (latest = api)} />);
    });

    act(() => {
      latest.reportFailure();
    });
    act(() => {
      latest.reportFailure();
    });
    expect(latest.isOnline).toBe(false);
  });

  it('a success after going offline immediately brings it back online', () => {
    let latest!: ReturnType<typeof useConnectivity>;
    act(() => {
      create(<Harness onRender={(api) => (latest = api)} />);
    });

    act(() => {
      latest.reportFailure();
    });
    act(() => {
      latest.reportFailure();
    });
    expect(latest.isOnline).toBe(false);

    act(() => {
      latest.reportSuccess();
    });
    expect(latest.isOnline).toBe(true);
  });

  it('a success resets the failure counter, so a lone failure afterward does not flip it offline again', () => {
    let latest!: ReturnType<typeof useConnectivity>;
    act(() => {
      create(<Harness onRender={(api) => (latest = api)} />);
    });

    // One failure, then a success — the counter should reset to zero, not
    // carry over toward the threshold.
    act(() => {
      latest.reportFailure();
    });
    act(() => {
      latest.reportSuccess();
    });
    act(() => {
      latest.reportFailure();
    });
    expect(latest.isOnline).toBe(true); // still just one failure since the reset
  });
});