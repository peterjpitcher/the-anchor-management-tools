/**
 * Literal colours for emails and generated documents, which cannot read CSS variables: mail
 * clients strip them and the PDF renderers do not load the app stylesheet. Every value mirrors a
 * token in the `@theme static` block of src/app/globals.css, and tests/ds/brand-palette.test.ts
 * fails if they drift. This is the only place hex belongs outside globals.css.
 *
 * Which palette:
 * - STAFF: anything from Orange Jelly or for staff: invoices, receipts, quotes, statements,
 *   contracts, staff emails, rota and hours PDFs. Brand green buttons (owner decision, 18 Sep 2026).
 * - GUEST: anything a guest or customer receives about The Anchor: booking, event, table and
 *   voucher emails and guest-facing sheets. The Anchor green and the guest gold primary button
 *   (owner decision, 18 Sep 2026), exactly as the guest pages draw it.
 */

export const STAFF = {
  text: '#1c1917',
  textStrong: '#0c0a09',
  textMuted: '#57534e',
  textSoft: '#78716c',
  textSubtle: '#a8a29e',
  bg: '#fafaf9',
  surface: '#ffffff',
  surface2: '#fafaf9',
  surfaceHover: '#f5f5f4',
  border: '#ececea',
  borderStrong: '#d6d3d1',
  primary: '#006A4E',
  primaryHover: '#064e3b',
  primarySoft: '#ecfdf5',
  primarySoftFg: '#043927',
  primaryFg: '#ffffff',
  success: '#16a34a',
  successSoft: '#f0fdf4',
  successFg: '#166534',
  successBorder: '#bbf7d0',
  warning: '#d97706',
  warningSoft: '#fffbeb',
  warningFg: '#92400e',
  warningBorder: '#fde68a',
  danger: '#dc2626',
  dangerSoft: '#fef2f2',
  dangerFg: '#991b1b',
  dangerBorder: '#fecaca',
  info: '#0284c7',
  infoSoft: '#f0f9ff',
  infoFg: '#075985',
  infoBorder: '#bae6fd',
} as const

/** Chart series 1 to 6, as the app draws them (--color-chart-1 .. -6). */
export const CHART_SERIES = ['#006A4E', '#0284c7', '#d97706', '#7c3aed', '#db2777', '#0d9488'] as const

export const GUEST = {
  green: '#005131',
  greenDeep: '#0c1d11',
  greenLight: '#006b45',
  gold: '#a57626',
  goldDark: '#8b6914',
  goldDeep: '#6f5410',
  goldBright: '#c9a020',
  cream: '#faf8f3',
  creamText: '#f0e6c6',
  charcoal: '#1a1a1a',
  sand: '#f5e6d3',
  success: '#006b45',
  danger: '#b1372f',
  bg: '#faf8f3',
  surface: '#ffffff',
  sunk: '#f2ede3',
  border: '#e2dccf',
  borderStrong: '#d2c9b4',
  text: '#1a1a1a',
  textStrong: '#005131',
  textMuted: '#6f6a61',
  accentText: '#8b6914',
  /** The guest primary button: GuestButton draws gold-dark with white text (5.1:1). */
  buttonBg: '#8b6914',
  buttonText: '#ffffff',
} as const

/** The four document greys the private booking receipt PDF uses. A subset of STAFF. */
export const DOCUMENT_PALETTE = {
  text: STAFF.text,
  textMuted: STAFF.textMuted,
  border: STAFF.border,
  surface2: STAFF.surface2,
} as const
