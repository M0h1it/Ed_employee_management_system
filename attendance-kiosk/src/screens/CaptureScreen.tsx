/**
 * src/screens/CaptureScreen.tsx
 *
 * "Please look at the camera" / 3 frames over 1 second, per
 * PHASE-3-BRIEF.md. Captures to FILES (capturePhotoToFile), not in-memory
 * Photo objects — vision-camera v5's capturePhoto() returns a native object
 * that must be manually dispose()'d, and a kiosk capturing continuously all
 * day is exactly the kind of long-running process where a missed dispose()
 * would slowly exhaust memory. capturePhotoToFile has no such lifecycle to
 * get wrong, and this app already needs a file path for the upload
 * (kioskApi.submitFacePunch takes URIs), so there is no in-memory step this
 * screen actually needs.
 *
 * API SHAPES BELOW WERE READ DIRECTLY FROM
 * node_modules/react-native-vision-camera@5.2.3 SOURCE, NOT ASSUMED —
 * this library's v5 API (nitro-based, outputs array, capturePhotoToFile)
 * is a significant departure from the older <Camera> + takePhoto() pattern
 * that most existing tutorials and documentation describe; do not
 * "simplify" this back to that older shape, it will not compile against
 * this version.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';
import { config } from '../config';
import { font } from '../theme';

interface Props {
  /** Called once all frames are captured, with file:// URIs ready to
   * upload as-is. */
  onCaptured: (frameUris: string[]) => void;
  /** Called if the camera itself cannot be used at all (no permission, no
   * device found) — the caller is responsible for showing an ERROR state,
   * this screen does not know how to recover on its own. */
  onCameraUnavailable: (reason: string) => void;
}

/**
 * PhotoFile.filePath (per the library's own type) is a plain filesystem
 * path, not a file:// URL — React Native's fetch/FormData on Android
 * specifically expects the file:// scheme to read local files, so every
 * path from this screen is normalised here, once, rather than trusting
 * every call site to remember to do it.
 */
function toFileUri(filePath: string): string {
  return filePath.startsWith('file://') ? filePath : `file://${filePath}`;
}

export default function CaptureScreen({ onCaptured, onCameraUnavailable }: Props) {
  const { hasPermission, requestPermission, canRequestPermission } = useCameraPermission();
  // 'front' alone already prefers the best front-facing device on this
  // tablet if there is more than one (the library's own sorting handles
  // that) — this app never falls back to a rear camera even if front
  // capture fails, because a rear camera faces the room, not the person
  // being punched in; showing the wrong side of the tablet is not a
  // recoverable alternative here, it is a different, wrong photo.
  const device = useCameraDevice('front');
  const photoOutput = usePhotoOutput({ quality: 0.85 });
  const capturedUris = useRef<string[]>([]);
  const [framesTaken, setFramesTaken] = useState(0);
  const capturing = useRef(false); // guards against overlapping capture loops

  // Rendering <Camera> does not mean its session is ready to capture from —
  // connecting the session to its outputs (this screen's photoOutput
  // included) happens asynchronously on the native side, and calling
  // capturePhotoToFile before that connection completes throws
  // "PhotoOutput is not yet attached to the CameraSession!" (a real crash
  // caught on-device, not something reproducible in any typecheck or test
  // run — see this file's own header comment on what could and couldn't be
  // verified without a physical device). onConfigured is the library's own
  // signal for exactly this moment; capture must wait for it instead of
  // assuming readiness the instant device/hasPermission become truthy.
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (!hasPermission && canRequestPermission) {
      requestPermission();
    }
  }, [hasPermission, canRequestPermission, requestPermission]);

  useEffect(() => {
    if (!hasPermission && !canRequestPermission) {
      // Permission was denied and the OS will not ask again from here —
      // per usePermission's own contract, the person has to go into system
      // Settings. A kiosk tablet is set up once by an admin, so this is
      // reported as a setup problem, not something to retry from this screen.
      onCameraUnavailable(
        'Camera permission was denied. Enable it in the device Settings app to use face check-in.',
      );
    }
  }, [hasPermission, canRequestPermission, onCameraUnavailable]);

  useEffect(() => {
    if (hasPermission && device == null) {
      onCameraUnavailable('No front-facing camera was found on this device.');
    }
  }, [hasPermission, device, onCameraUnavailable]);

  const runCaptureSequence = useCallback(async () => {
    if (capturing.current || !sessionReady) return;
    capturing.current = true;
    capturedUris.current = [];
    setFramesTaken(0);

    try {
      for (let i = 0; i < config.captureFrameCount; i++) {
        const file = await photoOutput.capturePhotoToFile({}, {});
        capturedUris.current.push(toFileUri(file.filePath));
        setFramesTaken(capturedUris.current.length);

        if (i < config.captureFrameCount - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, config.captureIntervalMs));
        }
      }
      onCaptured(capturedUris.current);
    } catch (error) {
      onCameraUnavailable(
        error instanceof Error ? error.message : 'The camera could not take a photo.',
      );
    } finally {
      capturing.current = false;
    }
  }, [sessionReady, photoOutput, onCaptured, onCameraUnavailable]);

  // Starts once the session actually reports itself configured — CAPTURING
  // is only ever entered right after a tap on IDLE, per kioskMachine.ts, so
  // there is no separate "start" button here; the session becoming ready
  // IS the start, whether that happens to land before or after this
  // component's first render.
  useEffect(() => {
    if (sessionReady) {
      void runCaptureSequence();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady]);

  if (!hasPermission || device == null) {
    return (
      <View style={styles.container}>
        <Text style={styles.instruction}>Setting up the camera…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        outputs={[photoOutput]}
        onConfigured={() => setSessionReady(true)}
        onError={(error) =>
          onCameraUnavailable(error instanceof Error ? error.message : 'The camera reported an error.')
        }
      />
      <View style={styles.topBadgeRow}>
        <View style={styles.scanningBadge}>
          <View style={styles.recDot} />
          <Text style={styles.scanningBadgeText}>Scanning</Text>
        </View>
      </View>

      <View style={styles.faceTarget} pointerEvents="none" />

      <View style={styles.overlay}>
        <Text style={styles.instruction}>Please look at the camera</Text>
        <Text style={styles.subInstruction}>Hold still — this takes about a second</Text>
        <View style={styles.dots}>
          {Array.from({ length: config.captureFrameCount }).map((_, i) => (
            <View key={i} style={[styles.dot, i < framesTaken && styles.dotFilled]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Deliberately still dark, unlike every other screen: this is a
  // full-screen live camera preview, and text needs to stay legible
  // regardless of what's behind it — a light backdrop here would fight the
  // actual image being shown, not the app's own design choice.
  container: { flex: 1, backgroundColor: '#000' },

  topBadgeRow: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scanningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(24,24,27,0.72)', // zinc-900 at reduced opacity — a
    // dark chip that reads on any live camera background, rather than a
    // solid theme color that could clash with whatever the camera happens
    // to be pointed at.
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F87171' }, // red-400
  scanningBadgeText: { fontFamily: font.family, color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },

  // A static circular guide, not a live face-tracking overlay — this app
  // has no on-device face detection of its own (matching happens
  // server-side, see kioskApi.ts), so the circle is a framing hint for
  // where to stand, not a claim that a face was found there.
  faceTarget: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 240,
    height: 240,
    marginTop: -120,
    marginLeft: -120,
    borderRadius: 120,
    borderWidth: 2,
    borderColor: 'rgba(129,140,248,0.6)', // indigo-400 at reduced opacity
    borderStyle: 'dashed',
  },

  overlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  instruction: {
    fontFamily: font.family,
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 4,
  },
  subInstruction: {
    fontFamily: font.family,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 16,
  },
  dots: { flexDirection: 'row', gap: 12 },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#818CF8', // indigo-400 — the one accent color still reads
    // as this product even on the one screen that has to stay dark
    backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: '#818CF8', borderColor: '#818CF8' },
});