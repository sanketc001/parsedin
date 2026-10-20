import type { Config } from 'tailwindcss';

// ---------------------------------------------------------------------------
// LinkedIn's visual language, as tokens.
//
// Named by role rather than by shade — `surface`, `line`, `fg-muted` — because
// the app was authored dark-first and a literal palette would have inverted
// meanings all over the codebase ("slate-600 is the faintest text" is a trap
// for whoever edits this next).
//
// Every foreground tone is AA on white at body size:
//   fg        #191919  16.9:1
//   fg-muted  #4d4d4d   8.6:1
//   fg-subtle #666666   5.7:1
//   fg-faint  #767676   4.5:1
// so the quiet metadata lines stay legible instead of decorative.
// ---------------------------------------------------------------------------

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /** Page background — LinkedIn's warm off-white, not a neutral gray. */
        canvas: '#f4f2ee',
        surface: {
          DEFAULT: '#ffffff',
          sunken: '#f3f2ef',
          hover: '#ebe9e5',
        },
        line: {
          DEFAULT: '#e4e2dd',
          strong: '#c4c2bd',
        },
        fg: {
          DEFAULT: '#191919',
          muted: '#4d4d4d',
          subtle: '#666666',
          faint: '#767676',
        },
        brand: {
          DEFAULT: '#0a66c2',
          dark: '#004182',
          tint: '#eaf3fd',
        },
        success: '#01754f',
        warn: '#915907',
        danger: '#b24020',
        /** Graph node kinds, retuned for a light canvas. */
        node: {
          person: '#0a66c2',
          company: '#915907',
          school: '#01754f',
          self: '#8c4bce',
        },
      },
      fontFamily: {
        // LinkedIn ships Source Sans; the system stack is the closest match
        // that needs no web font and renders identically on Windows.
        sans: [
          '-apple-system',
          'system-ui',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // LinkedIn's card is a hairline, not a drop shadow. The second layer
        // only appears on hover, where it reads as "this is clickable".
        card: '0 0 0 1px rgba(0,0,0,0.08)',
        raised: '0 0 0 1px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.10)',
        nav: '0 0 0 1px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
