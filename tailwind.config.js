/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        sidebar: '#005131', // Management Tools Green
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          // Production green palette
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#005131', // Main brand green
          700: '#004028', // Hover state
          800: '#003520', // Active state
          900: '#002818',
          950: '#001510',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        // Production-specific green shades
        green: {
          200: '#bbf7d0', // Sidebar icon inactive color
          600: '#16a34a', // Button background
          700: '#15803d', // Button hover, active nav item
          800: '#166534', // Button active state
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      borderRadius: {
        // Production border radius values
        'sm': '0.125rem',  // 2px
        'DEFAULT': '0.375rem', // 6px - cards, inputs
        'md': '0.375rem',  // 6px
        'lg': '0.5rem',    // 8px - buttons
      },
      boxShadow: {
        // Production shadows
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'DEFAULT': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'card': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)', // Card shadow
      },
      // Component-specific styles
      ringColor: {
        DEFAULT: '#005131', // Focus ring color (production green)
      },
      ringOffsetColor: {
        sidebar: '#005131', // For focus rings on sidebar
      },
    },
  },
  plugins: [],
}; 