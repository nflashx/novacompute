/* ============================================================
   NovaCompute — shared Tailwind theme.
   Loaded immediately after the Tailwind CDN script on every page
   so all pages share one set of design tokens.
   ============================================================ */

tailwind.config = {
  theme: {
    extend: {
      colors: {
        night: {
          DEFAULT: '#05070e',
          900: '#0a0f1c',
          800: '#0e1424',
          700: '#141c30',
        },
        nova: {
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
        },
        pulse: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 24px 60px -24px rgba(2, 6, 17, 0.9)',
        'glow-violet': '0 12px 40px -10px rgba(124, 58, 237, 0.5)',
        'glow-cyan': '0 12px 40px -10px rgba(34, 211, 238, 0.35)',
      },
    },
  },
};
