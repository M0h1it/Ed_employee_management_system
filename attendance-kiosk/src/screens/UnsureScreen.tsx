/**
 * src/screens/UnsureScreen.tsx
 *
 * "UNSURE (0.70-0.85): 'Are you Karan Patel?' [Yes] [No]" — PHASE-3-BRIEF.md.
 *
 * CONFIDENCE ITSELF IS NEVER SHOWN, EVEN THOUGH THE STITCH REFERENCE MOCKUP
 * DISPLAYED ONE
 * ---------------------------------------------------------------------------
 * The server already decided this falls in the unsure band
 * (app/api/v1/face.py's UNSURE_THRESHOLD / MATCH_THRESHOLD) — showing
 * "74% match" to the person standing at the kiosk would invite them to
 * reason about a number they have no way to interpret, when the only
 * decision that actually matters is the simple yes/no question already on
 * screen. The mockup's "Executive / Operations (EMP-0001)" designation
 * line is also not shown here: KioskPunchResult (app/schemas/face.py)
 * does not currently return a role or employee code for this path, and
 * adding those fields was explicitly deferred rather than guessed at.
 */

import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';

interface Props {
  employeeName: string;
  photoUrl: string | null;
  onYes: () => void;
  onNo: () => void;
  /** True while a Yes tap's follow-up API call is in flight — both buttons
   * disable so a second tap cannot fire a duplicate confirm mid-request. */
  confirming: boolean;
}

export default function UnsureScreen({ employeeName, photoUrl, onYes, onNo, confirming }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.verifyBadge}>
        <Text style={styles.verifyBadgeText}>VERIFY IDENTITY</Text>
      </View>

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
        <View style={styles.questionBadge}>
          <Text style={styles.questionGlyph}>?</Text>
        </View>
      </View>

      <Text style={styles.question}>Are you {employeeName}?</Text>

      <View style={styles.helperPill}>
        <Text style={styles.helperText}>
          Lighting or angle may have affected the match. Please confirm.
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.noButton]}
          onPress={onNo}
          disabled={confirming}
          activeOpacity={0.9}
        >
          <Text style={styles.noButtonText}>No</Text>
          <Text style={styles.noButtonSubtext}>Not me</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.yesButton]}
          onPress={onYes}
          disabled={confirming}
          activeOpacity={0.9}
        >
          <Text style={styles.yesButtonText}>{confirming ? 'Confirming…' : 'Yes'}</Text>
          {!confirming && <Text style={styles.yesButtonSubtext}>Confirm & check in</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 32,
  },
  verifyBadge: {
    position: 'absolute',
    top: 40,
    backgroundColor: colors.amber50,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  verifyBadgeText: {
    fontFamily: font.family,
    color: colors.amber700,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  photoWrap: { position: 'relative' },
  photoRing: {
    padding: 5,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: colors.amber700,
  },
  photo: { width: 116, height: 116, borderRadius: 58 },
  photoFallback: { backgroundColor: colors.zinc200, alignItems: 'center', justifyContent: 'center' },
  photoFallbackText: { fontFamily: font.family, color: colors.zinc600, fontSize: 44, fontWeight: '700' },
  questionBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.amber700,
    borderWidth: 3,
    borderColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionGlyph: { color: '#fff', fontSize: 15, fontWeight: '700' },

  question: {
    fontFamily: font.family,
    color: colors.zinc900,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  helperPill: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 16,
    maxWidth: 320,
    ...shadow.soft,
  },
  helperText: {
    fontFamily: font.family,
    color: colors.zinc500,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
  },

  buttonRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  button: {
    paddingVertical: 18,
    paddingHorizontal: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    ...shadow.soft,
  },
  yesButton: { backgroundColor: colors.emerald600 },
  noButton: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  yesButtonText: { fontFamily: font.family, color: '#fff', fontSize: 20, fontWeight: '700' },
  yesButtonSubtext: { fontFamily: font.family, color: '#D1FAE5', fontSize: 12, fontWeight: '600', marginTop: 2 },
  noButtonText: { fontFamily: font.family, color: colors.zinc600, fontSize: 20, fontWeight: '700' },
  noButtonSubtext: { fontFamily: font.family, color: colors.zinc400, fontSize: 12, fontWeight: '600', marginTop: 2 },
});