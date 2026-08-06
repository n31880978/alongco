import type { Config } from 'tailwindcss'

// Tokens are the contract with the design canvases (CLAUDE.md §5).
// Use the names in components. Never a raw hex.
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#16161A', deep: '#101116' },
        paper: {
          DEFAULT: '#FBFAF7',
          warm: '#F7F6F2',
          sunk: '#F5F4F0',
          edge: '#ECEBE6',
        },
        blue: {
          DEFAULT: '#2E63E8',
          dark: '#2E4FA8',
          soft: '#9DB4F6',
          tint: '#EDF1FD',
        },
        rose: { DEFAULT: '#F76D8A', deep: '#C7456B', tint: '#FDEFF3' },
        violet: { DEFAULT: '#8A6BEF' },
        green: { DEFAULT: '#1F7A5A', tint: '#E8F5EF' },
        amber: { DEFAULT: '#8A6A22', tint: '#FBF2DC' },
      },
      fontFamily: {
        sans: ['var(--font-public-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-newsreader)', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'Menlo', 'monospace'],
      },
      screens: {
        // One breakpoint. Desktop is an adaptation of the 375px design.
        md: '768px',
      },
      keyframes: {
        acRise: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        acDrift: {
          '0%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(6%,4%,0) scale(1.14)' },
          '100%': { transform: 'translate3d(0,0,0) scale(1)' },
        },
        acDrift2: {
          '0%': { transform: 'translate3d(0,0,0) scale(1.05)' },
          '50%': { transform: 'translate3d(-7%,-5%,0) scale(.94)' },
          '100%': { transform: 'translate3d(0,0,0) scale(1.05)' },
        },
        acSheen: {
          '0%': { transform: 'translateX(-120%)' },
          '55%': { transform: 'translateX(220%)' },
          '100%': { transform: 'translateX(220%)' },
        },
        acPulse: {
          '0%': { opacity: '1', transform: 'scale(1)' },
          '70%': { opacity: '0', transform: 'scale(2.6)' },
          '100%': { opacity: '0', transform: 'scale(2.6)' },
        },
        acPrint: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        acHead: {
          '0%': { top: '0', opacity: '0' },
          '6%': { opacity: '.9' },
          '96%': { opacity: '.9' },
          '100%': { top: '100%', opacity: '0' },
        },
        acStamp: {
          '0%': { opacity: '0', transform: 'rotate(-9deg) scale(1.5)' },
          '70%': { opacity: '0', transform: 'rotate(-9deg) scale(1.5)' },
          '82%': { opacity: '.9', transform: 'rotate(-9deg) scale(.97)' },
          '100%': { opacity: '.82', transform: 'rotate(-9deg) scale(1)' },
        },
        acFadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        rise: 'acRise .7s cubic-bezier(.2,.7,.3,1) both',
        drift: 'acDrift 16s ease-in-out infinite',
        drift2: 'acDrift2 19s ease-in-out infinite',
        drift3: 'acDrift 22s ease-in-out infinite',
        sheen: 'acSheen 2.4s cubic-bezier(.3,.1,.3,1) infinite',
        pulse2: 'acPulse 2.4s ease-out infinite',
        print: 'acPrint 1.1s steps(14) both',
        head: 'acHead 1.1s linear both',
        stamp: 'acStamp 1.9s cubic-bezier(.2,.8,.2,1) both',
        fade: 'acFadeIn .5s ease both',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
