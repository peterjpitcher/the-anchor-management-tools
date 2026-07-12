/**
 * Normalise the capitalisation of a person's name for storage and display.
 *
 * Title-cases each part while respecting hyphens (Mary-Jane), apostrophes
 * (O'Brien) and the "Mc" prefix (McDonald). Collapses runs of whitespace.
 * Leaves an empty/whitespace-only input as an empty string.
 *
 * Deliberately conservative: it does not lower-case name particles (de, van,
 * von) because getting those wrong is worse than a plain title-case.
 */
export function normalizePersonName(value: string | null | undefined): string {
  const cleaned = (value ?? '').trim().replace(/\s+/g, ' ')
  if (!cleaned) return ''

  const capitalise = (word: string): string => {
    if (!word) return word
    // Title-case sub-parts split by hyphen or apostrophe, keeping the separators.
    return word
      .split(/([-'])/)
      .map((part) => {
        if (part === '-' || part === "'") return part
        if (!part) return part
        const lower = part.toLowerCase()
        // McDonald / McBride
        if (lower.length > 2 && lower.startsWith('mc')) {
          return 'Mc' + lower.charAt(2).toUpperCase() + lower.slice(3)
        }
        return lower.charAt(0).toUpperCase() + lower.slice(1)
      })
      .join('')
  }

  return cleaned.split(' ').map(capitalise).join(' ')
}
