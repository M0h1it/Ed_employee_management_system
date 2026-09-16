/** @type {import('tailwindcss').Config} */

/**
 * Shared design system — matches Ruver / Alya so every Blysk project looks
 * like one product.
 *
 * Inter 300-800, 16px root. Indigo #4F46E5 primary. Warm off-white #FAF9F6
 * canvas, white cards. Zinc text ramp. Hairline borders, soft shadows.
 *
 * Tailwind's default palette (zinc, indigo, emerald, amber, rose, red) is
 * still available because this file uses `extend` — use those directly rather
 * than inventing new colour names.
 */

const sans = [
  'Inter',
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'sans-serif',
];

const mono = [
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  'Liberation Mono',
  'Courier New',
  'monospace',
];

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Page canvas and card surfaces */
        base: '#FAF9F6', // warm off-white page background
        card: '#FFFFFF',

        /* Pastel accent fills, straight from the shared spec */
        accent: {
          mint: '#EDFAF4',
          lavender: '#EEF2FF',
          sky: '#EFF6FF',
          peach: '#FFF4ED',
          rose: '#FFF1F2',
          amber: '#FFFBEB',
          violet: '#F5F3FF',
        },
      },

      /**
       * Radius scale from the shared spec:
       * 4 chips · 8 small buttons/tabs · 12 buttons, inputs, nav items ·
       * 16 cards, tables, modals · 18 KPI cards · full badges
       */
      borderRadius: {
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '18px',
      },

      boxShadow: {
        xs: '0 1px 2px rgba(0,0,0,0.04)',
        card: '0 1px 3px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.05)',
        'card-hover': '0 2px 8px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.08)',
        dropdown: '0 4px 24px rgba(0,0,0,0.12)',
        modal: '0 4px 24px rgba(0,0,0,0.12), 0 24px 64px rgba(0,0,0,0.14)',
      },

      spacing: {
        'space-xxs': '0.125rem',
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '0.75rem',
        'space-base': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2rem',
        'sidebar-width': '252px',
        'sidebar-collapsed': '72px',
        'header-height': '60px',
        'row-height-compact': '2.75rem',
      },

      /**
       * The type tokens keep their names from the first build, so no component
       * had to be rewritten — only the VALUES changed, to the shared scale.
       * Every token is Inter except mono-data.
       */
      fontFamily: {
        'headline-lg': sans,
        'headline-md': sans,
        'headline-sm': sans,
        'label-md': sans,
        'label-sm': sans,
        'body-md': sans,
        'body-sm': sans,
        'mono-data': mono,
        sans,
        mono,
      },

      fontSize: {
        'headline-lg': ['22px', { lineHeight: '28px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-md': ['15px', { lineHeight: '22px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-sm': ['13px', { lineHeight: '18px', letterSpacing: '-0.005em', fontWeight: '600' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '19px', fontWeight: '400' }],
        'label-md': ['12px', { lineHeight: '16px', fontWeight: '500' }],
        'label-sm': ['11px', { lineHeight: '15px', letterSpacing: '0.02em', fontWeight: '600' }],
        'mono-data': ['11.5px', { lineHeight: '16px', fontWeight: '500' }],
        kpi: ['26px', { lineHeight: '1', letterSpacing: '-0.02em', fontWeight: '800' }],
      },

      transitionDuration: {
        DEFAULT: '150ms',
      },

      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': {
          from: { opacity: '0', transform: 'translate(-50%, -46%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(12px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'scale-in': 'scale-in 250ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 250ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};