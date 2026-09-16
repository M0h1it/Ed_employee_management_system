/**
 * src/screens/PinScreen.tsx
 *
 * The fallback path per PHASE-3-BRIEF.md: two failed face attempts, a
 * declined enrolment, or the device being offline all land here. A numeric
 * pad rather than a system keyboard — this runs on a wall-mounted kiosk
 * tablet, not a personal device, so the on-screen keys need to be large
 * enough to hit accurately without looking down, the same reasoning behind
 * generate_pin() producing digits only (see app/core/security.py).
 *
 * IDENTIFIED BY EMPLOYEE CODE, NOT USERNAME
 * ----------------------------------------------
 * The kiosk asks for the employee code (e.g. "EMP-0042"), not a login
 * username. pin_hash carries no UNIQUE constraint server-side (see
 * kiosk_pin_punch's docstring in app/api/v1/face.py) — a random 6-digit PIN
 * can collide between two people, so identifying by PIN alone risks
 * matching the wrong employee. emp_code IS unique, and its "EMP-####"
 * shape is mostly digits already, which is why the "EMP-" prefix is shown
 * fixed and un-editable here: the person only ever needs to type the
 * numeric part on a pad that already suits digits, never letters.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';

interface Props {
  onSubmit: (employeeCode: string, pin: string) => void;
  errorMessage: string | null;
  submitting: boolean;
  onCancel: () => void;
}

const PIN_LENGTH = 6;
const CODE_DIGITS_LENGTH = 4; // "EMP-0042" -> 4 digits after the prefix
const EMP_PREFIX = 'EMP-';

type Field = 'code' | 'pin';

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function PinScreen({ onSubmit, errorMessage, submitting, onCancel }: Props) {
  const [codeDigits, setCodeDigits] = useState('');
  const [pin, setPin] = useState('');
  const [activeField, setActiveField] = useState<Field>('code');

  function pressKey(key: string) {
    if (submitting) return;

    if (key === '⌫') {
      if (activeField === 'pin' && pin.length === 0) {
        setActiveField('code');
        setCodeDigits((c) => c.slice(0, -1));
      } else if (activeField === 'pin') {
        setPin((p) => p.slice(0, -1));
      } else {
        setCodeDigits((c) => c.slice(0, -1));
      }
      return;
    }
    if (key === '') return;

    if (activeField === 'code') {
      setCodeDigits((c) => {
        const next = c.length < CODE_DIGITS_LENGTH ? c + key : c;
        if (next.length === CODE_DIGITS_LENGTH) setActiveField('pin');
        return next;
      });
    } else {
      setPin((p) => (p.length < PIN_LENGTH ? p + key : p));
    }
  }

  const canSubmit = codeDigits.length === CODE_DIGITS_LENGTH && pin.length === PIN_LENGTH && !submitting;

  function handleSubmit() {
    onSubmit(`${EMP_PREFIX}${codeDigits}`, pin);
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.cancel} onPress={onCancel}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Enter your employee code and PIN</Text>

      <View style={styles.fieldsRow}>
        <TouchableOpacity
          style={[styles.codeField, activeField === 'code' && styles.fieldActive]}
          onPress={() => setActiveField('code')}
          activeOpacity={0.85}
        >
          <Text style={styles.fieldLabel}>EMPLOYEE CODE</Text>
          <Text style={styles.codeText}>
            {EMP_PREFIX}
            {codeDigits.padEnd(CODE_DIGITS_LENGTH, '·')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.pinField, activeField === 'pin' && styles.fieldActive]}
          onPress={() => codeDigits.length === CODE_DIGITS_LENGTH && setActiveField('pin')}
          activeOpacity={0.85}
        >
          <Text style={styles.fieldLabel}>PIN</Text>
          <View style={styles.pinDots}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View key={i} style={[styles.pinDot, i < pin.length && styles.pinDotFilled]} />
            ))}
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.errorSlot}>
        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
      </View>

      <View style={styles.pad}>
        {PAD_KEYS.map((key, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.key, key === '' && styles.keyHidden]}
            onPress={() => pressKey(key)}
            disabled={key === '' || submitting}
            activeOpacity={0.7}
          >
            <Text style={styles.keyText}>{key}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.submit, !canSubmit && styles.submitDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit}
        activeOpacity={0.9}
      >
        <Text style={styles.submitText}>{submitting ? 'Checking…' : 'Submit'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.base,
    alignItems: 'center',
    paddingTop: 56,
    gap: 20,
  },
  cancel: { position: 'absolute', top: 24, left: 24, padding: 8 },
  cancelText: { fontFamily: font.family, color: colors.zinc500, fontSize: 16, fontWeight: '600' },
  title: {
    fontFamily: font.family,
    color: colors.zinc900,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 24,
    letterSpacing: -0.3,
  },
  fieldsRow: { flexDirection: 'row', gap: 12 },
  codeField: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    ...shadow.soft,
  },
  pinField: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    justifyContent: 'center',
    ...shadow.soft,
  },
  fieldActive: { borderColor: colors.indigo600 },
  fieldLabel: {
    fontFamily: font.family,
    color: colors.zinc400,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  codeText: { fontFamily: font.family, color: colors.zinc900, fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  pinDots: { flexDirection: 'row', gap: 8 },
  pinDot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.zinc200,
  },
  pinDotFilled: { backgroundColor: colors.indigo600, borderColor: colors.indigo600 },
  errorSlot: { height: 24, justifyContent: 'center' },
  error: {
    fontFamily: font.family,
    color: colors.red600,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  pad: {
    width: 280,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  key: {
    width: 80,
    height: 64,
    marginBottom: 12,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyHidden: { backgroundColor: 'transparent', borderWidth: 0 },
  keyText: { fontFamily: font.family, color: colors.zinc900, fontSize: 22, fontWeight: '600' },
  submit: {
    width: 280,
    paddingVertical: 18,
    borderRadius: radius.md,
    backgroundColor: colors.indigo600,
    alignItems: 'center',
    ...shadow.soft,
  },
  submitDisabled: { backgroundColor: colors.zinc200 },
  submitText: { fontFamily: font.family, color: '#fff', fontSize: 18, fontWeight: '700' },
});