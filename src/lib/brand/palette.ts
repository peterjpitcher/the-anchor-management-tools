/**
 * Literal colours for emails and PDFs, which cannot read CSS variables. Every value mirrors a
 * token in src/app/globals.css, and tests/lib/brand/palette.test.ts fails if they drift. This
 * is the one module outside globals.css where literal hex belongs
 * (tests/guards/design-tokens.test.ts on main exempts it).
 *
 * Staff documents use STAFF. Only the colours an email uses so far are here; add others from
 * globals.css, under the token's own name, as templates move over.
 */
export const STAFF = {
  /** --color-text */
  text: '#1c1917',
  /** --color-text-muted */
  textMuted: '#57534e',
  /** --color-border-strong */
  borderStrong: '#d6d3d1',
} as const
