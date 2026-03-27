import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#111217',
          800: '#181b1f',
          700: '#22252b',
          600: '#2c2f35',
          500: '#383b42',
        },
        accent: {
          cyan:   'var(--cyan)',
          green:  'var(--green)',
          purple: 'var(--purple)',
          orange: 'var(--orange)',
          red:    'var(--red)',
          blue:   'var(--blue)',
          yellow: 'var(--yellow)',
        },
      },
      fontFamily: {
        sans: ['Pretendard Variable', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        card: 'var(--c-shadow)',
      },
    },
  },
  plugins: [],
}

export default config
