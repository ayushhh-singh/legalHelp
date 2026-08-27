import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/** Wrap a bare HSL-triplet variable so Tailwind's alpha modifiers work. */
const hsl = (v: string) => `hsl(var(${v}) / <alpha-value>)`

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand tokens — the vocabulary the app actually writes in.
        paper: { DEFAULT: hsl('--paper'), 2: hsl('--paper-2') },
        ink: { DEFAULT: hsl('--ink'), 2: hsl('--ink-2') },
        thread: hsl('--thread'),
        ok: hsl('--ok'),

        // shadcn/ui aliases, resolving to the same tokens.
        background: hsl('--background'),
        foreground: hsl('--foreground'),
        card: { DEFAULT: hsl('--card'), foreground: hsl('--card-foreground') },
        popover: { DEFAULT: hsl('--popover'), foreground: hsl('--popover-foreground') },
        primary: { DEFAULT: hsl('--primary'), foreground: hsl('--primary-foreground') },
        secondary: { DEFAULT: hsl('--secondary'), foreground: hsl('--secondary-foreground') },
        muted: { DEFAULT: hsl('--muted'), foreground: hsl('--muted-foreground') },
        accent: { DEFAULT: hsl('--accent'), foreground: hsl('--accent-foreground') },
        destructive: { DEFAULT: hsl('--destructive'), foreground: hsl('--destructive-foreground') },
        border: hsl('--border'),
        input: hsl('--input'),
        ring: hsl('--ring'),
      },
      fontFamily: {
        // Point at the same CSS variables tokens.css defines — one source of truth.
        display: 'var(--font-display)',
        sans: 'var(--font-ui)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'var(--radius)',
        sm: 'var(--radius)',
      },
    },
  },
  plugins: [animate],
} satisfies Config
