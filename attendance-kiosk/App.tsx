/**
 * App.tsx
 *
 * The entire app is one screen (KioskScreen) inside a status bar and safe
 * area wrapper — there is no navigation library needed because a kiosk
 * never has more than one thing on screen at a time, and what that one
 * thing is is entirely driven by kioskReducer's state, not by routes.
 */

import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import KioskScreen from './src/screens/KioskScreen';
import { colors } from './src/theme';

// Left as constants here rather than piped through src/config/index.ts,
// since (unlike apiBaseUrl) this is copy an admin might reasonably want a
// non-developer to update by editing one obvious line at the top of the
// app's entry point.
const COMPANY_NAME = 'Experiences Digital';
const LOCATION_LABEL = 'Main Entrance'; // set per physical kiosk on install; optional

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar hidden barStyle="dark-content" />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  // Insets are read but deliberately unused in layout: a kiosk tablet is
  // mounted in one fixed orientation and every screen already fills the
  // frame edge-to-edge (see each screen's StyleSheet), so there is no
  // notch/home-indicator content to avoid the way a phone app would need to.
  useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <KioskScreen companyName={COMPANY_NAME} locationLabel={LOCATION_LABEL} />
    </View>
  );
}

const styles = StyleSheet.create({
  // The shell's own background matters only for the brief instant before
  // KioskScreen's first real screen paints — every screen sets its own
  // background (light base for most, dark for the live camera view), so
  // this is just the shell's resting color, matching the light theme most
  // of the app actually uses.
  container: { flex: 1, backgroundColor: colors.base },
});

export default App;