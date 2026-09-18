/**
 * JS access to the design tokens in the `@theme static` block of src/app/globals.css.
 * Use these ONLY where a CSS class cannot reach: canvas drawing, chart libraries that take
 * colour props, and inline styles computed in JS. Component styling uses Tailwind utilities
 * (bg-primary, text-text-muted and so on).
 *
 * Every value is a `var(--token)` string, which works anywhere CSS is parsed (inline styles,
 * SVG, Recharts props). Canvas cannot parse `var()`, so canvas code calls resolveToken() or
 * resolveColour(), which read the computed value from :root. `@theme static` guarantees every
 * token is present there. tests/ds/tokens.test.ts fails if a name here is missing from
 * globals.css.
 */

/** Read a CSS custom property from the document root. Returns '' on the server. */
export function getToken(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** The computed value of a token, for canvas and other places that cannot read var(). */
export function resolveToken(name: string): string {
  return getToken(name)
}

/**
 * Turn a colour that may be a `var(--token)` string into a literal a canvas can paint.
 * Anything that is not a var() reference is returned unchanged.
 */
export function resolveColour(colour: string): string {
  const match = colour.match(/^var\((--[\w-]+)\)$/)
  return match ? resolveToken(match[1]) : colour
}

const colors = {
  brand: {
    50: 'var(--color-brand-50)',
    100: 'var(--color-brand-100)',
    200: 'var(--color-brand-200)',
    300: 'var(--color-brand-300)',
    400: 'var(--color-brand-400)',
    500: 'var(--color-brand-500)',
    600: 'var(--color-brand-600)',
    700: 'var(--color-brand-700)',
    800: 'var(--color-brand-800)',
    900: 'var(--color-brand-900)',
  },
  bg: 'var(--color-bg)',
  surface: 'var(--color-surface)',
  surface2: 'var(--color-surface-2)',
  surfaceHover: 'var(--color-surface-hover)',
  border: 'var(--color-border)',
  borderStrong: 'var(--color-border-strong)',
  borderFocus: 'var(--color-border-focus)',
  text: 'var(--color-text)',
  textStrong: 'var(--color-text-strong)',
  textMuted: 'var(--color-text-muted)',
  textSoft: 'var(--color-text-soft)',
  textSubtle: 'var(--color-text-subtle)',
  primary: 'var(--color-primary)',
  primaryHover: 'var(--color-primary-hover)',
  primarySoft: 'var(--color-primary-soft)',
  primarySoftFg: 'var(--color-primary-soft-fg)',
  primaryFg: 'var(--color-primary-fg)',
  onDark: 'var(--color-on-dark)',
  onDarkMuted: 'var(--color-on-dark-muted)',
  onDarkSubtle: 'var(--color-on-dark-subtle)',
  onDarkHover: 'var(--color-on-dark-hover)',
  onDarkActive: 'var(--color-on-dark-active)',
  onDarkBorder: 'var(--color-on-dark-border)',
  sidebar: 'var(--color-sidebar)',
  sidebarFg: 'var(--color-sidebar-fg)',
  sidebarFgMuted: 'var(--color-sidebar-fg-muted)',
  sidebarActiveBg: 'var(--color-sidebar-active-bg)',
  sidebarHoverBg: 'var(--color-sidebar-hover-bg)',
  sidebarBorder: 'var(--color-sidebar-border)',
  success: 'var(--color-success)',
  successSoft: 'var(--color-success-soft)',
  successFg: 'var(--color-success-fg)',
  successBorder: 'var(--color-success-border)',
  warning: 'var(--color-warning)',
  warningSoft: 'var(--color-warning-soft)',
  warningFg: 'var(--color-warning-fg)',
  warningBorder: 'var(--color-warning-border)',
  danger: 'var(--color-danger)',
  dangerSoft: 'var(--color-danger-soft)',
  dangerFg: 'var(--color-danger-fg)',
  dangerBorder: 'var(--color-danger-border)',
  info: 'var(--color-info)',
  infoSoft: 'var(--color-info-soft)',
  infoFg: 'var(--color-info-fg)',
  infoBorder: 'var(--color-info-border)',
  overlay: 'var(--color-overlay)',
  chart: [
    'var(--color-chart-1)',
    'var(--color-chart-2)',
    'var(--color-chart-3)',
    'var(--color-chart-4)',
    'var(--color-chart-5)',
    'var(--color-chart-6)',
  ],
} as const

const spacing = {
  sidebarExpanded: 'var(--spacing-sidebar-expanded)',
  sidebarCollapsed: 'var(--spacing-sidebar-collapsed)',
  topbar: 'var(--spacing-topbar)',
  logoRow: 'var(--spacing-logo-row)',
  padCard: 'var(--spacing-pad-card)',
  pageShellPadY: 'var(--spacing-page-shell-pad-y)',
  cellY: 'var(--spacing-cell-y)',
  inputH: 'var(--spacing-input-h)',
  btnH: 'var(--spacing-btn-h)',
  btnHSm: 'var(--spacing-btn-h-sm)',
  btnHLg: 'var(--spacing-btn-h-lg)',
  touch: 'var(--spacing-touch)',
} as const

const shadows = {
  xs: 'var(--shadow-xs)',
  sm: 'var(--shadow-sm)',
  default: 'var(--shadow-default)',
  lg: 'var(--shadow-lg)',
  ring: 'var(--shadow-ring)',
} as const

const radii = {
  sm: 'var(--radius-sm)',
  default: 'var(--radius-default)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
  xl: 'var(--radius-xl)',
  pill: 'var(--radius-pill)',
} as const

const easing = {
  default: 'var(--ease-default)',
} as const

export const tokens = { colors, spacing, shadows, radii, easing } as const
