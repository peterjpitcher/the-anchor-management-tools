/**
 * JS access to CSS design tokens defined in globals.css @theme block.
 * Use these ONLY when CSS variables won't work: canvas rendering, chart libraries,
 * dynamic inline styles computed in JS.
 *
 * For component styling, always use Tailwind utility classes (bg-primary, text-text, etc.)
 */

/** Read a CSS custom property value from the document root */
function getToken(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Pre-defined token accessors for common use cases */
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
  textSubtle: 'var(--color-text-subtle)',
  primary: 'var(--color-primary)',
  primaryHover: 'var(--color-primary-hover)',
  primarySoft: 'var(--color-primary-soft)',
  primarySoftFg: 'var(--color-primary-soft-fg)',
  primaryFg: 'var(--color-primary-fg)',
  sidebarBg: 'var(--color-sidebar-bg)',
  sidebarFg: 'var(--color-sidebar-fg)',
  success: 'var(--color-success)',
  successSoft: 'var(--color-success-soft)',
  successFg: 'var(--color-success-fg)',
  warning: 'var(--color-warning)',
  warningSoft: 'var(--color-warning-soft)',
  warningFg: 'var(--color-warning-fg)',
  danger: 'var(--color-danger)',
  dangerSoft: 'var(--color-danger-soft)',
  dangerFg: 'var(--color-danger-fg)',
  info: 'var(--color-info)',
  infoSoft: 'var(--color-info-soft)',
  infoFg: 'var(--color-info-fg)',
} as const

const spacing = {
  sidebarExpanded: 'var(--spacing-sidebar-expanded)',
  sidebarCollapsed: 'var(--spacing-sidebar-collapsed)',
  topbar: 'var(--spacing-topbar)',
  padCard: 'var(--spacing-pad-card)',
  rowH: 'var(--spacing-row-h)',
  rowHLg: 'var(--spacing-row-h-lg)',
  inputH: 'var(--spacing-input-h)',
  btnH: 'var(--spacing-btn-h)',
  btnHSm: 'var(--spacing-btn-h-sm)',
  btnHLg: 'var(--spacing-btn-h-lg)',
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

export {};
