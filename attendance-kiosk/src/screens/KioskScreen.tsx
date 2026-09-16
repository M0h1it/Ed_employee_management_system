/**
 * src/screens/KioskScreen.tsx
 *
 * The only screen this app ever mounts, in the sense that matters — there
 * is no navigation stack, no back button, no way to reach any other view.
 * A kiosk shows exactly one thing at a time, driven entirely by
 * kioskReducer's current state; this component's job is purely to render
 * whichever screen that state calls for and to translate its own
 * asynchronous work (camera capture, API calls, the offline queue) into
 * the plain events the reducer understands.
 *
 * SETUP IS A GATE IN FRONT OF THIS, NOT A STATE INSIDE THE MACHINE
 * ---------------------------------------------------------------------
 * kioskMachine.ts has no "not set up yet" state on purpose — the state
 * diagram it implements (PHASE-3-BRIEF.md) starts from IDLE, and setup is a
 * one-time, before-the-diagram-even-starts concern, not a state a fully
 * working kiosk should ever legitimately revisit. This component checks
 * for a device code before rendering the machine at all, exactly like
 * SessionGuard.tsx gates the admin app on being signed in before showing
 * any of ITS screens.
 */

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { kioskReducer, initialKioskState } from '../state/kioskMachine';
import { useConnectivity } from '../state/useConnectivity';
import { colors } from '../theme';
import { resolveMediaUrl } from '../config';
import { getDeviceCode, setDeviceCode } from '../storage/deviceStore';
import { enqueuePinPunch, queueLength } from '../storage/queueStore';
import { startQueueRunner, stopQueueRunner } from '../api/queueRunner';
import {
  submitFacePunch,
  submitPinPunch,
  verifyDeviceCode,
  DeviceUnauthorizedError,
  InvalidPinError,
  NetworkUnavailableError,
} from '../api/kioskApi';

import SetupScreen from './SetupScreen';
import IdleScreen from './IdleScreen';
import CaptureScreen from './CaptureScreen';
import GreetingScreen from './GreetingScreen';
import UnsureScreen from './UnsureScreen';
import NoMatchScreen from './NoMatchScreen';
import PinScreen from './PinScreen';
import ErrorScreen from './ErrorScreen';

interface Props {
  companyName: string;
  locationLabel?: string;
}

type SetupPhase = 'checking' | 'needed' | 'ready';

export default function KioskScreen({ companyName, locationLabel }: Props) {
  const [setupPhase, setSetupPhase] = useState<SetupPhase>('checking');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSubmitting, setSetupSubmitting] = useState(false);

  const [state, dispatch] = useReducer(kioskReducer, initialKioskState);
  const { isOnline, reportSuccess, reportFailure } = useConnectivity();
  const [queuedCount, setQueuedCount] = useState(0);

  // Frames captured for the current attempt — held here, not in the
  // reducer, because a frame set is transient working data for one in-flight
  // request, not a fact about what state the kiosk is in. Re-used across a
  // CONFIRM_YES follow-up call, which is why it survives past CAPTURING.
  const pendingFrames = useRef<string[] | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [confirmingUnsure, setConfirmingUnsure] = useState(false);

  const refreshQueuedCount = useCallback(() => {
    void queueLength().then(setQueuedCount);
  }, []);

  // --- Setup gate --------------------------------------------------------

  useEffect(() => {
    (async () => {
      const stored = await getDeviceCode();
      if (!stored) {
        setSetupPhase('needed');
        return;
      }
      try {
        const ok = await verifyDeviceCode(stored);
        setSetupPhase(ok ? 'ready' : 'needed');
      } catch {
        // Could not reach the server to verify — this is NOT the same as
        // "needs setup". A tablet that has already been set up and simply
        // has no signal right now should go straight to the OFFLINE state
        // once the machine mounts, not back through setup, which would ask
        // the admin to re-enter a code that was never actually invalid.
        setSetupPhase('ready');
      }
    })();
  }, []);

  async function handleSetupSubmit(code: string) {
    setSetupSubmitting(true);
    setSetupError(null);
    try {
      const ok = await verifyDeviceCode(code);
      if (!ok) {
        setSetupError('That code was not recognised. Check it and try again.');
        return;
      }
      await setDeviceCode(code);
      setSetupPhase('ready');
    } catch (error) {
      setSetupError(
        error instanceof NetworkUnavailableError
          ? 'Could not reach the server. Check the network connection and try again.'
          : 'Something went wrong. Try again.',
      );
    } finally {
      setSetupSubmitting(false);
    }
  }

  // --- Queue runner + connectivity reflection into the reducer -----------

  useEffect(() => {
    if (setupPhase !== 'ready') return;
    refreshQueuedCount();
    startQueueRunner(() => refreshQueuedCount());
    return () => stopQueueRunner();
  }, [setupPhase, refreshQueuedCount]);

  const wasOnline = useRef(isOnline);
  useEffect(() => {
    if (wasOnline.current && !isOnline) dispatch({ type: 'NETWORK_LOST' });
    if (!wasOnline.current && isOnline) dispatch({ type: 'NETWORK_RESTORED' });
    wasOnline.current = isOnline;
  }, [isOnline]);

  // --- Face capture flow ---------------------------------------------------

  async function runFaceMatch(frameUris: string[], confirmEmployeeId?: string) {
    try {
      const result = await submitFacePunch(frameUris, new Date(), confirmEmployeeId);
      reportSuccess();

      if (result.outcome === 'MATCH' && result.direction && result.punchedAt) {
        dispatch({
          type: 'MATCH_RESULT',
          employeeName: result.employeeName ?? 'there',
          photoUrl: resolveMediaUrl(result.photoUrl),
          direction: result.direction,
          punchedAt: result.punchedAt,
        });
      } else if (result.outcome === 'UNSURE' && result.employeeId) {
        dispatch({
          type: 'UNSURE_RESULT',
          employeeId: result.employeeId,
          employeeName: result.employeeName ?? 'there',
          photoUrl: resolveMediaUrl(result.photoUrl),
          confidence: result.confidence ?? 0,
        });
      } else if (result.outcome === 'LIVENESS_FAILED') {
        dispatch({ type: 'LIVENESS_FAILED' });
      } else {
        dispatch({ type: 'NO_MATCH_RESULT' });
      }
    } catch (error) {
      if (error instanceof NetworkUnavailableError) {
        reportFailure();
        dispatch({ type: 'NETWORK_LOST' });
        return;
      }
      if (error instanceof DeviceUnauthorizedError) {
        // A revoked/invalid device mid-operation. Sent back through setup
        // rather than into ERROR — this is exactly the state a tablet
        // should be in until someone re-enters a working code, and setup
        // already knows how to get out of it.
        setSetupPhase('needed');
        return;
      }
      dispatch({
        type: 'ERROR_OCCURRED',
        message: error instanceof Error ? error.message : 'Something went wrong.',
      });
    }
  }

  const handleCaptured = useCallback(async (frameUris: string[]) => {
    pendingFrames.current = frameUris;
    dispatch({ type: 'FRAMES_CAPTURED' });
    await runFaceMatch(frameUris);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCameraUnavailable(reason: string) {
    dispatch({ type: 'ERROR_OCCURRED', message: reason });
  }

  async function handleConfirmYes() {
    if (!pendingFrames.current || state.kind !== 'UNSURE') {
      dispatch({ type: 'ERROR_OCCURRED', message: 'Something went wrong. Please try again.' });
      return;
    }
    const confirmEmployeeId = state.employeeId;
    setConfirmingUnsure(true);
    dispatch({ type: 'CONFIRM_YES' });
    try {
      await runFaceMatch(pendingFrames.current, confirmEmployeeId);
    } finally {
      setConfirmingUnsure(false);
    }
  }

  function handleConfirmNo() {
    dispatch({ type: 'CONFIRM_NO' });
  }

  function handleRetry() {
    dispatch({ type: 'RETRY' });
  }

  // --- PIN flow ------------------------------------------------------------

  async function handlePinSubmit(employeeCode: string, pin: string) {
    setPinSubmitting(true);
    setPinError(null);
    try {
      const result = await submitPinPunch(employeeCode, pin);
      reportSuccess();
      dispatch({ type: 'PIN_RESULT', employeeName: result.employeeName, direction: result.direction });
    } catch (error) {
      if (error instanceof NetworkUnavailableError) {
        // Offline: queue it, per this project's own decision — stays queued
        // forever until it can be sent, never dropped, never expires.
        await enqueuePinPunch(employeeCode, pin);
        refreshQueuedCount();
        reportFailure();
        dispatch({ type: 'NETWORK_LOST' });
        return;
      }
      if (error instanceof InvalidPinError) {
        setPinError('That employee code or PIN was not recognised.');
        dispatch({ type: 'PIN_FAILED' });
        return;
      }
      if (error instanceof DeviceUnauthorizedError) {
        setSetupPhase('needed');
        return;
      }
      setPinError('Something went wrong. Please try again.');
    } finally {
      setPinSubmitting(false);
    }
  }

  // --- Home launcher: swallow the physical back button everywhere --------

  // This app is registered as a HOME launcher (see AndroidManifest.xml's
  // second intent-filter on MainActivity) — there is no "previous screen"
  // for back to return to, and no app underneath this one to reveal. Every
  // screen already has its own explicit way forward (Cancel on PIN, Retry
  // on NoMatch/Error); back doing nothing is what keeps the kiosk from
  // ever showing a blank Android background.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  // --- Auto-return to IDLE from terminal states -----------------------------

  useEffect(() => {
    if (state.kind === 'PIN_SUCCESS') {
      const id = setTimeout(() => dispatch({ type: 'TIMEOUT_RETURN_TO_IDLE' }), 4000);
      return () => clearTimeout(id);
    }
  }, [state.kind]);

  // --- Render ----------------------------------------------------------------

  if (setupPhase === 'checking') {
    return <View style={styles.blank} />;
  }

  if (setupPhase === 'needed') {
    return (
      <SetupScreen
        onSubmit={handleSetupSubmit}
        errorMessage={setupError}
        submitting={setupSubmitting}
      />
    );
  }

  return (
    <View style={styles.root}>
      {renderScreen()}
      {/* Persistent across every screen once setup is complete, not just
          IDLE's own queue banner — the person asked for this specifically
          so offline is never a silent state discoverable only by trying to
          punch and having it queue. Placed above everything via absolute
          positioning rather than piping a prop into each screen, so no
          future screen can be added here and accidentally forget it. */}
      {!isOnline && (
        <View style={styles.offlineBadge} pointerEvents="none">
          <View style={styles.offlineDot} />
          <Text style={styles.offlineBadgeText}>Offline — working locally</Text>
        </View>
      )}
    </View>
  );

  function renderScreen() {
    switch (state.kind) {
      case 'IDLE':
      return (
        <IdleScreen
          companyName={companyName}
          locationLabel={locationLabel}
          onTapStart={() => dispatch({ type: 'TAP_START' })}
          queuedCount={queuedCount}
          isOnline={isOnline}
        />
      );

    case 'CAPTURING':
      return (
        <CaptureScreen onCaptured={handleCaptured} onCameraUnavailable={handleCameraUnavailable} />
      );

    case 'MATCHING':
      // No distinct screen — this is a brief in-flight moment between a
      // capture (or a Yes confirm) resolving; CaptureScreen and
      // UnsureScreen both already show their own "in progress" affordance
      // for the instant before this state's result arrives, so a third
      // spinner screen would only flash and add a jarring extra transition.
      return <View style={styles.blank} />;

    case 'MATCH':
      return (
        <GreetingScreen
          employeeName={state.employeeName}
          photoUrl={state.photoUrl}
          direction={state.direction}
          punchedAt={state.punchedAt}
          onDone={() => dispatch({ type: 'TIMEOUT_RETURN_TO_IDLE' })}
        />
      );

    case 'UNSURE':
      return (
        <UnsureScreen
          employeeName={state.employeeName}
          photoUrl={state.photoUrl}
          onYes={handleConfirmYes}
          onNo={handleConfirmNo}
          confirming={confirmingUnsure}
        />
      );

    case 'NO_MATCH':
      return (
        <NoMatchScreen
          attemptsUsed={state.attemptsUsed}
          onRetry={handleRetry}
          onUsePin={() => dispatch({ type: 'GIVE_UP_TO_PIN' })}
        />
      );

    case 'PIN':
      return (
        <PinScreen
          onSubmit={handlePinSubmit}
          errorMessage={pinError}
          submitting={pinSubmitting}
          onCancel={() => dispatch({ type: 'RESET' })}
        />
      );

    case 'PIN_SUCCESS':
      return (
        <GreetingScreen
          employeeName={state.employeeName}
          photoUrl={null}
          direction={state.direction}
          punchedAt={new Date().toISOString()}
          onDone={() => dispatch({ type: 'TIMEOUT_RETURN_TO_IDLE' })}
        />
      );

    case 'OFFLINE':
      return (
        <PinScreen
          onSubmit={handlePinSubmit}
          errorMessage={pinError}
          submitting={pinSubmitting}
          // Previously a no-op — offline had no "cancel" destination on
          // purpose at the time, but that left the person stuck on this
          // screen with no way back to IDLE even to just look at the
          // resting screen while they wait for the network to come back.
          // RESET is safe here: cancelling only leaves this screen, it
          // does not touch the offline queue — anything already queued
          // keeps retrying in the background via queueRunner.ts regardless
          // of which screen is showing.
          onCancel={() => dispatch({ type: 'RESET' })}
        />
      );

    case 'ERROR':
      return <ErrorScreen message={state.message} onRetry={() => dispatch({ type: 'RETRY' })} />;

    default:
      return <View style={styles.blank} />;
    }
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  blank: { flex: 1, backgroundColor: colors.base },
  offlineBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1C1917', // near-black, deliberately NOT colors.zinc900 —
    // this badge has to read on top of every screen, including CaptureScreen's
    // own dark background, so it uses a fixed dark chip rather than a
    // theme token that would go invisible against a dark screen underneath it.
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    zIndex: 50,
  },
  offlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FBBF24' }, // amber-400
  offlineBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
});