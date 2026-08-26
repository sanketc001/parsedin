import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#08090c',
          900: '#0c0e13',
          850: '#11141b',
          800: '#161a23',
          700: '#1f2430',
          600: '#2b3140',
          500: '#3d4557',
        },
        accent: {
          DEFAULT: '#5b9dff',
          soft: '#8fbcff',
          dim: '#243550',
        },
        node: {
          person: '#5b9dff',
          company: '#f5a05b',
          school: '#7ee0a8',
          self: '#e07ee0',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
