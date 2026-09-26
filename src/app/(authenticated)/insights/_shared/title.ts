/** Small words stay lower case inside a Title Case label ("Employees and Compliance"). */
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'])

/**
 * A report heading as the page shows it: Title Case (UI_UX.md, Page chrome) for section card
 * titles, the jump links and the sub-headings inside a card ("Needs Attention", a list's title).
 * The report stores them in sentence case ("Hosted events"), which the weekly email and the
 * running text keep; only the page's display changes.
 */
export function insightSectionTitle(title: string): string {
  return title
    .split(' ')
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ')
}
