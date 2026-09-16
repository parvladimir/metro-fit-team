import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'media',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#FF5A1F',
          50: '#FFF1EA',
          100: '#FFE0CC',
          200: '#FFC199',
          300: '#FFA166',
          400: '#FF8233',
          500: '#FF5A1F',
          600: '#E5470F',
          700: '#B3380C',
          800: '#802808',
          900: '#4D1805',
        },
        surface: {
          DEFAULT: '#0B0D10',
          light: '#FFFFFF',
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
      },
      spacing: {
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-t': 'env(safe-area-inset-top)',
      },
      maxWidth: {
        app: '480px',
      },
    },
  },
  plugins: [],
};

export default config;
