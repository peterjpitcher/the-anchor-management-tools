/** Print and email renderers do not load the app stylesheet. Values are pinned to
 * the corresponding globals.css tokens by the brand-palette test. */
export const DOCUMENT_PALETTE = {
  text: '#1c1917',
  textMuted: '#57534e',
  border: '#ececea',
  surface2: '#fafaf9',
} as const
