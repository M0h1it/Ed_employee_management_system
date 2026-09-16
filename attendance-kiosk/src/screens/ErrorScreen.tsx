/**
 * src/screens/ErrorScreen.tsx
 *
 * The catch-all for anything the rest of the state machine has no specific
 * screen for — a missing camera, a permission permanently denied, an
 * unexpected server error. Deliberately generic and deliberately not
 * reachable from most failures: a network problem goes to OFFLINE, a wrong
 * PIN stays on PIN with an inline message, a no-match goes to NO_MATCH —
 * this screen exists for the remainder, not as the default outcome of a
 * normal failure.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';

interface Props {
  message: string;
  onRetry: () => void;
}

export default function ErrorScreen({ message, onRetry }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.iconText}>!</Text>
      </View>

      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>{message}</Text>

      <TouchableOpacity style={styles.button} onPress={onRetry} activeOpacity={0.9}>
        <Text style={styles.buttonText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.red50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  iconText: { color: colors.red600, fontSize: 30, fontWeight: '700' },
  title: { fontFamily: font.family, color: colors.zinc900, fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  message: {
    fontFamily: font.family,
    color: colors.zinc500,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 320,
    marginBottom: 8,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: radius.md,
    backgroundColor: colors.indigo600,
    ...shadow.soft,
  },
  buttonText: { fontFamily: font.family, color: '#fff', fontSize: 17, fontWeight: '700' },
});