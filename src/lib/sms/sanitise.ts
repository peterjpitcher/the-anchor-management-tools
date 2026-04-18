/**
 * Sanitises a string value before interpolation into an SMS body.
 * - Strips ASCII control characters (newlines, tabs, \0-\x1F, \x7F).
 * - Collapses multiple whitespace runs into a single space.
 * - Trims.
 * - Caps length.
 *
 * Use for EVERY user-controlled variable (customer_first_name, event_type, etc.)
 * in SMS templates to prevent body-injection attacks.
 */
export function sanitiseSmsVariable(
  value: string | null | undefined,
  maxLen: number
): string {
  if (!value) return ''
  return value
    // Strip non-whitespace control chars entirely (BEL, NULL, etc.)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalise any remaining whitespace (incl. \t \n \r) to single spaces
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}
