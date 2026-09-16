/**
 * src/screens/GreetingScreen.tsx
 *
 * "Photo + 'Good morning, Karan Patel'" / "Checked in at 9:04 AM" ->
 * IDLE after 4s, per PHASE-3-BRIEF.md. The photo requirement is not
 * decorative: the brief calls it out specifically as how "the person sees
 * immediately that the right face was matched" — showing the wrong photo
 * here (a caching bug, say) is the one failure mode of this whole feature
 * that a person could actually catch by eye, so photoUrl is never skipped
 * just because it's optional in the API response.
 *
 * CONFIDENCE IS DELIBERATELY NOT SHOWN, EVEN THOUGH THE STITCH REFERENCE
 * MOCKUP DISPLAYED ONE
 * ---------------------------------------------------------------------------
 * Same reasoning as UnsureScreen.tsx: the server already decided this is a
 * MATCH (app/api/v1/face.py's MATCH_THRESHOLD). A percentage here invites
 * the person to second-guess a decision that was already made on their
 * behalf, with a number they have no real way to interpret — it adds
 * anxiety, not information. The employee CODE is shown instead (content
 * the mockup also had), because that is something the person can actually
 * use to confirm "yes, that's me" at a glance.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { config } from '../config';
import { colors, font, shadow } from '../theme';

interface Props {
  employeeName: string;
  /** e.g. "EMP-0001" — shown as a small confirmation detail, the way the
   * reference mockup showed one, but never a match percentage (see this
   * file's header comment). Optional: PIN_SUCCESS (KioskScreen.tsx) does
   * not currently have this value to pass, only the face-match path does. */
  employeeCode?: string;
  photoUrl: string | null;
  direction: 'IN' | 'OUT';
  punchedAt: string; // ISO
  onDone: () => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function greetingFor(direction: 'IN' | 'OUT'): string {
  // Direction, not time of day, decides the greeting — matching the
  // brief's own examples ("Good morning" on check-in, "Good evening ...
  // see you tomorrow" on check-out) rather than the wall clock, since a
  // night-shift check-in at 11pm is still someone arriving, not leaving.
  return direction === 'IN' ? 'Good morning' : 'Good evening';
}

export default function GreetingScreen({
  employeeName,
  employeeCode,
  photoUrl,
  direction,
  punchedAt,
  onDone,
}: Props) {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(config.greetingHoldMs / 1000));
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const id = setTimeout(onDone, config.greetingHoldMs);

    Animated.timing(progress, {
      toValue: 1,
      duration: config.greetingHoldMs,
      useNativeDriver: false, // animating a width percentage, not transform/opacity
    }).start();

    const tick = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

    return () => {
      clearTimeout(id);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDone]);

  return (
    <View style={styles.container}>
      {employeeCode && (
        <View style={styles.codeBadge}>
          <Text style={styles.codeBadgeText}>{employeeCode}</Text>
        </View>
      )}

      <View style={styles.photoWrap}>
        <View style={styles.photoRing}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoFallback]}>
              <Text style={styles.photoFallbackText}>{employeeName.charAt(0)}</Text>
            </View>
          )}
        </View>
        <View style={styles.checkBadge}>
          <Text style={styles.checkGlyph}>✓</Text>
        </View>
      </View>

      <Text style={styles.greeting}>
        {greetingFor(direction)}, {employeeName}
      </Text>

      <View style={styles.detailPill}>
        <Text style={styles.detailText}>
          {direction === 'IN' ? `Checked in at ${formatTime(punchedAt)}` : 'See you tomorrow'}
        </Text>
      </View>

      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            },
          ]}
        />
      </View>
      <Text style={styles.returningText}>Returning to home screen in {secondsLeft}s</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  codeBadge: {
    position: 'absolute',
    top: 40,
    right: 28,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    ...shadow.soft,
  },
  codeBadgeText: { fontFamily: font.family, color: colors.zinc400, fontSize: 12, fontWeight: '700' },

  photoWrap: { position: 'relative', marginBottom: 4 },
  photoRing: { padding: 6, borderRadius: 100, backgroundColor: colors.emerald50 },
  photo: { width: 128, height: 128, borderRadius: 64 },
  photoFallback: { backgroundColor: colors.indigo600, alignItems: 'center', justifyContent: 'center' },
  photoFallbackText: { fontFamily: font.family, color: '#fff', fontSize: 52, fontWeight: '700' },
  checkBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.emerald600,
    borderWidth: 3,
    borderColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlyph: { color: '#fff', fontSize: 16, fontWeight: '700' },

  greeting: {
    fontFamily: font.family,
    color: colors.zinc900,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  detailPill: {
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 20,
    ...shadow.soft,
  },
  detailText: { fontFamily: font.family, color: colors.zinc600, fontSize: 17, fontWeight: '600' },

  progressTrack: {
    width: 200,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.zinc200,
    overflow: 'hidden',
    marginTop: 24,
  },
  progressFill: { height: '100%', backgroundColor: colors.emerald600, borderRadius: 2 },
  returningText: { fontFamily: font.family, color: colors.zinc400, fontSize: 13, fontWeight: '500' },
});