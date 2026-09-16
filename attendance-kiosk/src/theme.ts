/**
 * src/theme.ts
 *
 * Ported directly from attendance-admin/tailwind.config.js — same colors,
 * same font family, same radius language — so this app reads as the same
 * product, not a different one that happens to talk to the same backend.
 * Every screen imports from here rather than hardcoding a hex value, for
 * the exact reason Button.tsx's own comment gives for centralising style
 * once: "the moment two screens style their own buttons, they drift."
 *
 * SIZES ARE SCALED UP, NOT COPIED PIXEL-FOR-PIXEL
 * -----------------------------------------------------
 * The admin site's type scale (11-22px) is tuned for a desktop screen
 * viewed at arm's length from a keyboard. A kiosk tablet is viewed from
 * 30-60cm away, often in passing, sometimes by someone who isn't looking
 * closely — so `fontSize` and `radius` below intentionally do NOT match
 * the admin app's literal pixel values, only its color palette, font
 * family, and the relative WEIGHT of each role (a primary action still
 * gets the boldest, largest treatment; a caption still gets the smallest).
 */

export const colors = {
  // Page canvas and card surfaces — identical hex values to
  // attendance-admin's `base`/`card` tokens.
  base: '#FAF9F6',
  card: '#FFFFFF',

  // Zinc text ramp, matching Tailwind's default palette the admin app
  // extends rather than replaces.
  zinc900: '#18181B',
  zinc600: '#52525B',
  zinc500: '#71717A',
  zinc400: '#A1A1AA',
  zinc200: '#E4E4E7',
  zinc100: '#F4F4F5',

  // Indigo — the one accent color, exact match to Button.tsx's primary
  // variant (`bg-indigo-600` / `hover:bg-indigo-700`).
  indigo600: '#4F46E5',
  indigo700: '#4338CA',
  indigo50: '#EEF2FF', // == accent.lavender in tailwind.config.js

  emerald600: '#059669',
  emerald50: '#EDFAF4', // == accent.mint
  red600: '#DC2626',
  red50: '#FFF1F2', // == accent.rose
  amber700: '#B45309',
  amber50: '#FFFBEB', // == accent.amber

  border: 'rgba(0,0,0,0.08)', // matches the admin app's border-black/[0.08]
} as const;

export const font = {
  // React Native's font-family lookup differs by platform; 'System' picks
  // the OS default (Roboto on Android) unless Inter is bundled as a custom
  // font asset. This app does not currently bundle Inter — using 'System'
  // rather than naming 'Inter' directly and having every string silently
  // fall back with no warning if the font file is never added. Bundling
  // Inter properly (react-native.config.js + rebuilding) is a follow-up,
  // not something to fake with a font name that does not resolve.
  family: 'System',
} as const;

export const radius = {
  sm: 8, // rounded-lg — chips, small controls
  md: 12, // rounded-xl — the admin app's standard button/input radius
  lg: 16, // rounded-2xl — cards, modals; used here for the kiosk's primary button
  xl: 24, // scaled beyond the admin app's own scale, for a kiosk's single
  // full-width dialogs (PIN pad, setup) where a desktop-sized 16px reads as
  // too tight at this physical size and viewing distance.
} as const;

export const shadow = {
  // Mirrors Button.tsx's shadow-xs — a very soft, barely-there lift, not a
  // heavy drop shadow. React Native has no CSS box-shadow, so this is the
  // closest native equivalent (iOS shadow props; ignored on Android without
  // `elevation`, which is added per-component where it matters).
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
} as const;