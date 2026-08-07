/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: 'hsl(var(--primary))',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        secondary: 'hsl(var(--secondary))',
        'secondary-foreground': 'hsl(var(--secondary-foreground))',
        muted: 'hsl(var(--muted-foreground) / 0.12)',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        border: 'hsl(var(--border-color))',
        nav: 'hsl(var(--nav))',
        card: 'hsl(var(--secondary))',

        // Aliases used by some existing page classes (e.g. bg-bg-base, text-text-primary)
        'bg-base': '#0f131f',
        'bg-surface-low': '#171b28',
        'bg-surface': '#1b1f2c',
        'bg-surface-high': '#313442',
        'brand-primary': '#adc6ff',
        'brand-accent': '#4d8eff',
        'text-primary': '#dfe2f3',
        'text-secondary': '#c2c6d6',
        'text-muted': '#9aa0b8',
        'border-default': '#2d3344',
        'accent-blue': '#67a5ff',
        'accent-amber': '#e4b35c',
        'accent-red': '#ffb4ab',
      },
      keyframes: {
        gridFloat: {
          '0%, 100%': { transform: 'perspective(1200px) rotateX(62deg) skewX(-8deg) translateY(0px)' },
          '50%': { transform: 'perspective(1200px) rotateX(62deg) skewX(-8deg) translateY(-18px)' },
        },
        pulseRoad: {
          '0%': { transform: 'translateX(-10%)', opacity: '0.2' },
          '50%': { opacity: '0.95' },
          '100%': { transform: 'translateX(110%)', opacity: '0.2' },
        },
        dropdownIn: {
          '0%': { opacity: '0', transform: 'translateY(-6px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'grid-float': 'gridFloat 18s ease-in-out infinite',
        'pulse-road': 'pulseRoad 5s linear infinite',
        'dropdown-in': 'dropdownIn 0.18s ease-out',
      },
      boxShadow: {
        premium: '0 20px 60px rgba(8, 12, 22, 0.45)',
      },
      backgroundImage: {
        'tactical-gradient': 'linear-gradient(135deg, #adc6ff 0%, #4d8eff 100%)',
      },
    },
  },
  plugins: [],
}

