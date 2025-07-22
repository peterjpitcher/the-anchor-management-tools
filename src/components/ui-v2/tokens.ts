/**
 * Design Tokens
 * 
 * Central source of truth for all design decisions.
 * These tokens ensure consistency across the entire application.
 */

export const tokens = {
  // Colors - Using the existing green primary theme
  colors: {
    // Primary - Green (maintaining brand consistency)
    primary: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      300: '#86efac',
      400: '#4ade80',
      500: '#22c55e',
      600: '#16a34a', // Main brand color
      700: '#15803d',
      800: '#166534',
      900: '#14532d',
      950: '#052e16',
    },
    
    // Neutral - Gray
    gray: {
      50: '#f9fafb',
      100: '#f3f4f6',
      200: '#e5e7eb',
      300: '#d1d5db',
      400: '#9ca3af',
      500: '#6b7280',
      600: '#4b5563',
      700: '#374151',
      800: '#1f2937',
      900: '#111827',
      950: '#030712',
    },
    
    // Semantic colors
    success: '#16a34a', // green-600
    warning: '#f59e0b', // amber-500
    error: '#dc2626',   // red-600
    info: '#3b82f6',    // blue-500
    
    // Feedback colors for toasts and alerts
    feedback: {
      success: {
        background: '#f0fdf4',
        text: '#166534',
        border: '#bbf7d0',
      },
      error: {
        background: '#fef2f2',
        text: '#991b1b',
        border: '#fecaca',
      },
      warning: {
        background: '#fffbeb',
        text: '#92400e',
        border: '#fde68a',
      },
      info: {
        background: '#eff6ff',
        text: '#1e40af',
        border: '#bfdbfe',
      },
    },
    
    // Surface colors
    background: '#ffffff',
    surface: '#ffffff',
    surfaceRaised: '#f9fafb', // gray-50
    border: '#e5e7eb', // gray-200
    
    // Text colors
    text: {
      primary: '#111827',   // gray-900
      secondary: '#6b7280', // gray-500
      tertiary: '#9ca3af',  // gray-400
      inverse: '#ffffff',
    },
  },
  
  // Typography
  typography: {
    // Font families
    fontFamily: {
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      mono: 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
    
    // Font sizes
    fontSize: {
      xs: '0.75rem',    // 12px
      sm: '0.875rem',   // 14px
      base: '1rem',     // 16px
      lg: '1.125rem',   // 18px
      xl: '1.25rem',    // 20px
      '2xl': '1.5rem',  // 24px
      '3xl': '1.875rem', // 30px
      '4xl': '2.25rem', // 36px
      '5xl': '3rem',    // 48px
    },
    
    // Line heights
    lineHeight: {
      none: '1',
      tight: '1.25',
      snug: '1.375',
      normal: '1.5',
      relaxed: '1.625',
      loose: '2',
    },
    
    // Font weights
    fontWeight: {
      thin: '100',
      light: '300',
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
      extrabold: '800',
      black: '900',
    },
  },
  
  // Spacing (4px base unit)
  spacing: {
    0: '0',
    0.5: '0.125rem', // 2px
    1: '0.25rem',    // 4px
    1.5: '0.375rem', // 6px
    2: '0.5rem',     // 8px
    2.5: '0.625rem', // 10px
    3: '0.75rem',    // 12px
    3.5: '0.875rem', // 14px
    4: '1rem',       // 16px
    5: '1.25rem',    // 20px
    6: '1.5rem',     // 24px
    7: '1.75rem',    // 28px
    8: '2rem',       // 32px
    9: '2.25rem',    // 36px
    10: '2.5rem',    // 40px
    11: '2.75rem',   // 44px (touch target minimum)
    12: '3rem',      // 48px
    14: '3.5rem',    // 56px
    16: '4rem',      // 64px
    20: '5rem',      // 80px
    24: '6rem',      // 96px
    28: '7rem',      // 112px
    32: '8rem',      // 128px
  },
  
  // Layout
  layout: {
    // Container max widths
    container: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    
    // Breakpoints
    breakpoints: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
  },
  
  // Borders
  borders: {
    radius: {
      none: '0',
      sm: '0.125rem',  // 2px
      base: '0.25rem', // 4px
      md: '0.375rem',  // 6px
      lg: '0.5rem',    // 8px
      xl: '0.75rem',   // 12px
      '2xl': '1rem',   // 16px
      '3xl': '1.5rem', // 24px
      full: '9999px',
    },
    
    width: {
      0: '0',
      1: '1px',
      2: '2px',
      4: '4px',
      8: '8px',
    },
  },
  
  // Shadows
  shadows: {
    none: 'none',
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',
  },
  
  // Z-index scale
  zIndex: {
    0: '0',
    10: '10',
    20: '20',
    30: '30',
    40: '40',
    50: '50',
    dropdown: '1000',
    sticky: '1020',
    fixed: '1030',
    modalBackdrop: '1040',
    modal: '1050',
    popover: '1060',
    tooltip: '1070',
  },
  
  // Animation
  animation: {
    // Durations
    duration: {
      75: '75ms',
      100: '100ms',
      150: '150ms',
      200: '200ms',
      300: '300ms',
      500: '500ms',
      700: '700ms',
      1000: '1000ms',
    },
    
    // Timing functions
    easing: {
      linear: 'linear',
      in: 'cubic-bezier(0.4, 0, 1, 1)',
      out: 'cubic-bezier(0, 0, 0.2, 1)',
      inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
  },
  
  // Component-specific tokens
  components: {
    // Touch target minimum size (44px for mobile)
    touchTarget: {
      min: '2.75rem', // 44px
    },
    
    // Focus ring
    focusRing: {
      width: '2px',
      offset: '2px',
      color: '#16a34a', // primary-600
    },
  },
} as const

// Type-safe token getter
export type Tokens = typeof tokens

// Helper to get nested token values
export function getToken<T extends keyof Tokens>(
  category: T
): Tokens[T]

export function getToken<T extends keyof Tokens, K extends keyof Tokens[T]>(
  category: T,
  key: K
): Tokens[T][K]

export function getToken<
  T extends keyof Tokens,
  K extends keyof Tokens[T],
  V extends keyof Tokens[T][K]
>(
  category: T,
  key: K,
  subkey: V
): Tokens[T][K][V]

export function getToken(...args: string[]): any {
  return args.reduce((acc, key) => acc[key], tokens as any)
}