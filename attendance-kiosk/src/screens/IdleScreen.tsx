/**
 * src/screens/IdleScreen.tsx
 *
 * "Company name, clock, one large button" — PHASE-3-BRIEF.md, verbatim.
 * The top header carries only the logo, this specific kiosk's location
 * label, and online/offline status — the company name itself is shown
 * large, centered, above the clock, which is the one piece of identity
 * content a person glancing at the kiosk actually needs at that size.
 *
 * The one-button decision itself is untouched: nothing here is a second
 * way to start a punch — there is still exactly one thing to tap. An
 * always-on camera would match every passer-by, which is surveillance
 * rather than attendance; this screen has no live camera preview or
 * standalone camera icon for that reason, only the one big button.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, font, radius, shadow } from '../theme';

interface Props {
  companyName: string;
  /** e.g. "East Entrance Gate" — the physical location this specific
   * tablet is mounted at, shown as a subtitle so a site with several
   * kiosks can tell them apart at a glance. Optional: a single-kiosk site
   * has no need to label its one tablet. */
  locationLabel?: string;
  onTapStart: () => void;
  /** Shown as a small banner rather than blocking IDLE entirely — a queued
   * count is informational, not something that should stop new punches
   * (offline PIN punches still queue normally regardless of how many are
   * already waiting). */
  queuedCount: number;
  /** Reflects the same connectivity signal that drives NETWORK_LOST /
   * NETWORK_RESTORED (see useConnectivity.ts) — this dot and the OFFLINE
   * state the machine falls into are always in agreement, never two
   * separate opinions about whether the kiosk is online. */
  isOnline: boolean;
}

function useClock(): { time: string; date: string } {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return {
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

export default function IdleScreen({
  companyName,
  locationLabel,
  onTapStart,
  queuedCount,
  isOnline,
}: Props) {
  const { time, date } = useClock();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoBox}>
            <Text style={styles.logoGlyph}>◈</Text>
          </View>
          {locationLabel && <Text style={styles.locationLabel}>{locationLabel}</Text>}
        </View>

        <View style={styles.statusPill}>
          <View style={[styles.statusDot, !isOnline && styles.statusDotOffline]} />
          <Text style={[styles.statusText, !isOnline && styles.statusTextOffline]}>
            {isOnline ? 'Online' : 'Offline'}
          </Text>
        </View>
      </View>

      <View style={styles.centerContent}>
        <Text style={styles.companyName}>{companyName}</Text>
        <Text style={styles.clock}>{time}</Text>
        <Text style={styles.date}>{date}</Text>
      </View>

      <View style={styles.bottomContent}>
        <TouchableOpacity style={styles.button} onPress={onTapStart} activeOpacity={0.9}>
          <Text style={styles.buttonText}>Tap to check in / out</Text>
        </TouchableOpacity>

        <View style={styles.queueSlot}>
          {queuedCount > 0 && (
            <View style={styles.queueBanner}>
              <Text style={styles.queueBannerText}>
                {queuedCount} punch{queuedCount === 1 ? '' : 'es'} waiting to sync
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.base,
    justifyContent: 'space-between',
    paddingTop: 32,
    paddingBottom: 48,
    paddingHorizontal: 28,
  },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.indigo600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlyph: { color: '#fff', fontSize: 18 },
  locationLabel: {
    fontFamily: font.family,
    color: colors.zinc500,
    fontSize: 14,
    fontWeight: '600',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.emerald50,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.emerald600 },
  statusDotOffline: { backgroundColor: colors.zinc400 },
  statusText: { fontFamily: font.family, color: colors.emerald600, fontSize: 12, fontWeight: '700' },
  statusTextOffline: { color: colors.zinc500 },

  centerContent: { alignItems: 'center', gap: 10 },
  companyName: {
    fontFamily: font.family,
    color: colors.zinc900,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  clock: {
    fontFamily: font.family,
    color: colors.zinc900,
    fontSize: 56,
    fontWeight: '700',
    letterSpacing: -1,
  },
  date: { fontFamily: font.family, color: colors.zinc500, fontSize: 16, fontWeight: '500' },

  bottomContent: { alignItems: 'center', gap: 16 },
  button: {
    backgroundColor: colors.indigo600,
    paddingVertical: 22,
    width: '100%',
    borderRadius: radius.lg,
    alignItems: 'center',
    ...shadow.soft,
  },
  buttonText: { fontFamily: font.family, color: '#fff', fontSize: 20, fontWeight: '700' },
  queueSlot: { height: 32, justifyContent: 'center' },
  queueBanner: {
    backgroundColor: colors.amber50,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  queueBannerText: { fontFamily: font.family, color: colors.amber700, fontSize: 14, fontWeight: '600' },
});