/**
 * Shared OJ Projects utilities.
 */

/**
 * Derives a short client code from a vendor name.
 * Used for project codes and references.
 *
 * Examples:
 *   "Orange Jelly Limited" -> "OJ"
 *   "Acme Corp" -> "AC"
 *   "The Star Pub" -> "SP"
 */
export function deriveClientCode(vendorName: string): string {
  const stopWords = new Set(['THE', 'LIMITED', 'LTD', 'CO', 'COMPANY', 'GROUP', 'SERVICES', 'SERVICE', 'AND'])
  const tokens = String(vendorName || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((t) => t.toUpperCase())
    .filter((t) => !stopWords.has(t))

  if (tokens.length === 0) return 'CLIENT'

  const initials = tokens.slice(0, 3).map((t) => t[0]).join('')
  return initials || 'CLIENT'
}

/**
 * Rounds a monetary value to 2 decimal places using epsilon correction.
 * Prevents floating-point rounding errors (e.g. 0.1 + 0.2 = 0.30000000000000004).
 */
export function roundMoney(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}
