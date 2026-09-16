/**
 * src/screens/NoMatchScreen.tsx
 *
 * "NO MATCH: Attempt 2 -> PIN screen -> 'Please see your manager'" —
 * PHASE-3-BRIEF.md. This screen covers both a genuine no-match AND a
 * liveness failure (a held-up photo) with the same retry path: from the
 * person's point of view standing at the tablet, both look identical
 * ("it didn't recognise me"), and both should lead to the same second
 * chance before falling back to a PIN.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { config } from '../config';
import { colors, font, radius, shadow } from '../theme';

interface Props {
  attemptsUsed: number;
  onRetry: () => void;
  onUsePin: () => void;
}

export default function NoMatchScreen({ attemptsUsed, onRetry, onUsePin }: Props) {
  const attemptsLeft = config.maxFaceAttempts - attemptsUsed;
  const canRetry = attemptsLeft > 0;

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.iconText}>?</Text>
      </View>

      <Text style={styles.title}>We couldn't match your face</Text>
      <Text style={styles.subtitle}>
        {canRetry
          ? 'Try again, making sure your face is well lit and centred.'
          : 'Please use your PIN instead.'}
      </Text>

      <View style={styles.buttonColumn}>
        {canRetry && (
          <TouchableOpacity style={[styles.button, styles.retryButton]} onPress={onRetry} activeOpacity={0.9}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.button, styles.pinButton]} onPress={onUsePin} activeOpacity={0.9}>
          <Text style={styles.pinButtonText}>Use PIN instead</Text>
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
    gap: 8,
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.red50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  iconText: { fontFamily: font.family, color: colors.red600, fontSize: 32, fontWeight: '700' },
  title: {
    fontFamily: font.family,
    color: colors.zinc900,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: font.family,
    color: colors.zinc500,
    fontSize: 17,
    textAlign: 'center',
    marginBottom: 24,
  },
  buttonColumn: { gap: 14, width: '100%', maxWidth: 360 },
  button: { paddingVertical: 20, borderRadius: radius.md, alignItems: 'center', ...shadow.soft },
  retryButton: { backgroundColor: colors.indigo600 },
  pinButton: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  retryButtonText: { fontFamily: font.family, color: '#fff', fontSize: 18, fontWeight: '700' },
  pinButtonText: { fontFamily: font.family, color: colors.zinc600, fontSize: 18, fontWeight: '700' },
});