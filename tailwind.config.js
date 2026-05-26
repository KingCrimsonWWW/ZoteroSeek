/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}', './addon/**/*.xhtml'],
  theme: {
    extend: {
      colors: {
        'zs': {
          'bg': {
            'primary': '#111113',
            'sidebar': '#18181b',
            'card': '#1f1f23',
            'input': '#1a1a1e',
            'header': 'rgba(18,18,18,0.85)',
          },
          'text': {
            'primary': '#ececec',
            'secondary': '#888888',
          },
          'accent': {
            'DEFAULT': '#5B7FFF',
            'hover': '#4A6EE0',
            'subtle': 'rgba(91,127,255,0.12)',
          },
          'border': 'rgba(255,255,255,0.06)',
        },
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
      fontFamily: {
        'sans': ['Inter', 'SF Pro', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  corePlugins: {
    preflight: false,
  },
  plugins: [],
};
