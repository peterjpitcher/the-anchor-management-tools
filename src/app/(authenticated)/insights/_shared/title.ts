/** Small words stay lower case inside a Title Case label ("Employees and Compliance"). */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'])

/**
 * A report section's title as the page shows it on a card or a button: Title Case (UI_UX.md,
 * Page chrome). The report stores it in sentence case ("Hosted events"), which the weekly email
 * and the running text keep; only the card titles and the jump links change.
 */
export function insightSectionTitle(title: string): string {
  return title
    .split(' ')
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ')
}
