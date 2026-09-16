/**
 * src/screens/SetupScreen.tsx
 *
 * Shown once, when no device code is stored yet (see deviceStore.ts) — or
 * again if the stored code stops working (revoked, or never valid). The
 * code itself comes from the admin's "Add device" / "Reactivate" flow in
 * DevicesPanel.tsx on the web admin side, shown to THEM once; this screen
 * is where that same value gets typed in, also effectively once per code.
 *
 * DELIBERATELY NO "SKIP" OR "USE WITHOUT A CODE" OPTION
 * ----------------------------------------------------------
 * Every kiosk call requires X-Device-Code — there is no valid state for
 * this app to be in without one, so this screen has no back door and no
 * offline/demo mode. get_current_device (app/api/deps.py) rejects a
 * missing header the same as a wrong one.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';

interface Props {
  onSubmit: (code: string) => void;
  errorMessage: string | null;
  submitting: boolean;
}

export default function SetupScreen({ onSubmit, errorMessage, submitting }: Props) {
  const [code, setCode] = useState('');

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.iconText}>⚙</Text>
      </View>

      <Text style={styles.title}>Set up this kiosk</Text>
      <Text style={styles.subtitle}>
        Enter the device code shown when this tablet was registered in the admin panel.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="000000"
        placeholderTextColor={colors.zinc400}
        value={code}
        onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        editable={!submitting}
      />

      <View style={styles.errorSlot}>
        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
      </View>

      <TouchableOpacity
        style={[styles.button, (code.length !== 6 || submitting) && styles.buttonDisabled]}
        onPress={() => onSubmit(code)}
        disabled={code.length !== 6 || submitting}
        activeOpacity={0.9}
      >
        <Text style={styles.buttonText}>{submitting ? 'Checking…' : 'Continue'}</Text>
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
    backgroundColor: colors.indigo50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  iconText: { fontSize: 28, color: colors.indigo600 },
  title: { fontFamily: font.family, color: colors.zinc900, fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: {
    fontFamily: font.family,
    color: colors.zinc500,
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 320,
    lineHeight: 21,
  },
  input: {
    width: 220,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    color: colors.zinc900,
    borderRadius: radius.lg,
    paddingVertical: 16,
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 8,
    fontFamily: font.family,
    ...shadow.soft,
  },
  errorSlot: { height: 24, justifyContent: 'center' },
  error: { fontFamily: font.family, color: colors.red600, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  button: {
    width: 220,
    paddingVertical: 16,
    borderRadius: radius.md,
    backgroundColor: colors.indigo600,
    alignItems: 'center',
    ...shadow.soft,
  },
  buttonDisabled: { backgroundColor: colors.zinc200 },
  buttonText: { fontFamily: font.family, color: '#fff', fontSize: 17, fontWeight: '700' },
});