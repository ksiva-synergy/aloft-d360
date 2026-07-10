/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // REBRAND: Synergy Marine Group inspired colors → Spinor Labs brand palette
        // Primary: Berkeley Navy #003262 | Accent: Gold #FDB515 | Dark bg: #0D1B2A
        'navy': {
          50: '#f0f4ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#003262',
          600: '#002a54',
          700: '#002046',
          800: '#001838',
          900: '#001028',
        },
        'marine': {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        'saffron': {
          50: '#fefce8',
          100: '#fef9c3',
          200: '#fef08a',
          300: '#fde047',
          400: '#FDB515',
          500: '#e0a010',
          600: '#c48a0a',
          700: '#a87306',
          800: '#8c5e03',
          900: '#704a01',
        },
        // REBRAND: Spinor Labs gold accent
        'gold': {
          DEFAULT: '#FDB515',
          light: '#fec84b',
          dark: '#c48a0a',
        },
        // Semantic accent colors for analytics dashboard
        'success': {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
        'info': {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a5f',
        },
        'warning': {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        'danger': {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        // evals-v2 brand aliases — authoritative flat tokens for eval surfaces
        'brand': {
          navy: '#003262',
          gold:  '#FDB515',
        },
        'terminal': {
          bg:      '#0d1117',
          surface: '#161b22',
          border:  '#30363d',
          muted:   '#8b949e',
        },
        'builder': {
          bg:              'var(--builder-bg)',
          surface:         'var(--builder-surface)',
          'surface-raised':'var(--builder-surface-raised)',
          border:          'var(--builder-border)',
          'border-bright': 'var(--builder-border-bright)',
          gold:            'var(--builder-gold)',
          'gold-dim':      'var(--builder-gold-dim)',
          text:            'var(--builder-text)',
          'text-muted':    'var(--builder-text-muted)',
          'text-label':    'var(--builder-text-label)',
          'green-live':    'var(--builder-green-live)',
          'amber-preview': 'var(--builder-amber-preview)',
          'red-fail':      'var(--builder-red-fail)',
        },
      },
      fontFamily: {
        // REBRAND: Inter → Inter Tight | JetBrains Mono → IBM Plex Mono
        sans: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', '"SF Mono"', 'monospace'],
        // evals-v2 semantic font aliases
        display: ['"Source Serif 4"', 'Georgia', 'serif'],   // --fd: headings, agent names
        body:    ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'], // --fu: labels, body
      },
      borderRadius: {
        // Spinor Labs: 4px base (inputs/chips/buttons), 6px max (cards/panels)
        // Use rounded-sm (4px) for interactive elements, rounded-card (6px) for surfaces
        'sm':    '4px',
        'card':  '6px',
        'brand': '6px',  // evals-v2 max border-radius — do not exceed
        // Intentionally NOT overriding 'md'/'lg'/'xl' — their presence in JSX is a violation;
        // removing the override here surfaces the violation rather than silencing it.
      },
      transitionTimingFunction: {
        'sidebar': 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      boxShadow: {
        'nav': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        'slide-in-from-top': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'slide-in-from-bottom': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'slide-in-from-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-in-from-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-in-from-top-4': {
          '0%': { transform: 'translateY(-1rem)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-in-from-bottom-4': {
          '0%': { transform: 'translateY(1rem)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-in-from-left-4': {
          '0%': { transform: 'translateX(-1rem)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-from-right-4': {
          '0%': { transform: 'translateX(1rem)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-from-top-2': {
          '0%': { transform: 'translateY(-0.5rem)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-in-from-bottom-5': {
          '0%': { transform: 'translateY(1.25rem)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'zoom-in-95': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'zoom-out-95': {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(0.95)', opacity: '0' },
        },
        'lab-glow': {
          '0%, 100%': { boxShadow: '0 0 8px 2px var(--tw-shadow-color, rgba(99,102,241,0.3))' },
          '50%': { boxShadow: '0 0 20px 6px var(--tw-shadow-color, rgba(99,102,241,0.5))' },
        },
        'lab-shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'lab-float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'lab-bar-grow': {
          '0%': { transform: 'scaleX(0)', opacity: '0' },
          '100%': { transform: 'scaleX(1)', opacity: '1' },
        },
        'lab-ring-spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'lab-count-pulse': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.25)' },
        },
        'lab-gradient-x': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'lab-stagger-in': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'lab-scale-in': {
          '0%': { transform: 'scale(0.85)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'lab-slide-in-right': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'lab-slide-in-left': {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'lab-slide-down': {
          '0%': { maxHeight: '0', opacity: '0' },
          '100%': { maxHeight: '500px', opacity: '1' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'progress-slide': {
          '0%': { transform: 'translateX(-100%)' },
          '50%': { transform: 'translateX(200%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        'builder-dot-pulse': {
          '0%, 80%, 100%': { opacity: '0.3', transform: 'scale(0.8)' },
          '40%': { opacity: '1', transform: 'scale(1)' },
        },
        'builder-toast-in': {
          '0%': { opacity: '0', transform: 'translateX(1rem)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'builder-toast-out': {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(1rem)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-out': 'fade-out 0.3s ease-out',
        'slide-in-from-top': 'slide-in-from-top 0.3s ease-out',
        'slide-in-from-bottom': 'slide-in-from-bottom 0.3s ease-out',
        'slide-in-from-left': 'slide-in-from-left 0.3s ease-out',
        'slide-in-from-right': 'slide-in-from-right 0.3s ease-out',
        'slide-in-from-top-4': 'slide-in-from-top-4 0.5s ease-out',
        'slide-in-from-bottom-4': 'slide-in-from-bottom-4 0.5s ease-out',
        'slide-in-from-left-4': 'slide-in-from-left-4 0.5s ease-out',
        'slide-in-from-right-4': 'slide-in-from-right-4 0.5s ease-out',
        'slide-in-from-top-2': 'slide-in-from-top-2 0.3s ease-out',
        'slide-in-from-bottom-5': 'slide-in-from-bottom-5 0.3s ease-out',
        'zoom-in-95': 'zoom-in-95 0.2s ease-out',
        'zoom-out-95': 'zoom-out-95 0.2s ease-out',
        'lab-glow': 'lab-glow 2s ease-in-out infinite',
        'lab-shimmer': 'lab-shimmer 2s linear infinite',
        'lab-float': 'lab-float 3s ease-in-out infinite',
        'lab-bar-grow': 'lab-bar-grow 0.5s ease-out forwards',
        'lab-ring-spin': 'lab-ring-spin 2s linear infinite',
        'lab-count-pulse': 'lab-count-pulse 0.4s ease-out',
        'lab-gradient-x': 'lab-gradient-x 3s ease infinite',
        'lab-stagger-in': 'lab-stagger-in 0.4s ease-out forwards',
        'lab-scale-in': 'lab-scale-in 0.3s ease-out',
        'lab-slide-in-right': 'lab-slide-in-right 0.3s ease-out',
        'lab-slide-in-left': 'lab-slide-in-left 0.3s ease-out',
        'lab-slide-down': 'lab-slide-down 0.3s ease-out',
        'shimmer': 'shimmer 1.5s ease-in-out infinite',
        'builder-dot-pulse': 'builder-dot-pulse 1.4s ease-in-out infinite',
        'builder-toast-in': 'builder-toast-in 0.3s ease-out forwards',
        'builder-toast-out': 'builder-toast-out 0.3s ease-in forwards',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
}
