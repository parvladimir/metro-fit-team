import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'media',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        creator: ['var(--font-creator)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        // Primary accent — cyan/turquoise, replacing the earlier orange brand.
        brand: {
          DEFAULT: '#00D7F5',
          50: '#04282D', // subtle dark-teal tint (active nav pill bg, soft accent surfaces)
          100: '#063840',
          200: '#075263',
          300: '#04788C',
          400: '#00A6C2',
          500: '#00D7F5',
          600: '#00C9E8',
          700: '#00A3BD',
          800: '#007A8C',
          900: '#00505C',
        },
        // Repurposed as the app's full dark-surface + text scale. Every
        // existing `bg-neutral-*` / `text-neutral-*` / `border-neutral-*`
        // call site automatically becomes part of the dark theme through
        // this single remap — 50 is the deepest background, 900 is
        // near-white primary text.
        neutral: {
          50: '#04141A',
          100: '#0E2226',
          150: '#152A2E',
          200: '#1E383C',
          300: '#2C4A4F',
          // 400 lifted from #5B7B7F (3.6:1 on cards) to 5.2:1 so small labels stay readable
          400: '#73989C',
          500: '#8AA9AC',
          600: '#AEC7C9',
          700: '#CFE1E2',
          800: '#E6F1F1',
          900: '#F5FAFA',
        },
        surface: {
          DEFAULT: '#00191D',
          light: '#0E2226',
          // Card depth levels: 1 = quiet/secondary, 2 = primary card, 3 = raised (chips, buttons)
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        // Semantic accents: cyan is the identity, the rest only carry meaning.
        // Channels are RGB triplets so opacity modifiers work (bg-accent-success/15).
        accent: {
          primary: 'rgb(var(--accent-primary-rgb) / <alpha-value>)',
          success: 'rgb(var(--accent-success-rgb) / <alpha-value>)',
          achievement: 'rgb(var(--accent-achievement-rgb) / <alpha-value>)',
          challenge: 'rgb(var(--accent-challenge-rgb) / <alpha-value>)',
          info: 'rgb(var(--accent-info-rgb) / <alpha-value>)',
          warning: 'rgb(var(--accent-warning-rgb) / <alpha-value>)',
        },
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      fontSize: {
        'metric-lg': ['2.75rem', { lineHeight: '1.05', fontWeight: '800' }],
        'metric-md': ['1.75rem', { lineHeight: '1.1', fontWeight: '700' }],
        'page-title': ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '800' }],
        'card-heading': ['1.0625rem', { lineHeight: '1.35', fontWeight: '700' }],
      },
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-t': 'env(safe-area-inset-top)',
      },
      maxWidth: {
        app: '480px',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
