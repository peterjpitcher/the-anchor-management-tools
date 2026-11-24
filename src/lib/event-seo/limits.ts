// ──────────────────────────────────────────────────────────────
// Event SEO limits: the one rule set for event page copy.
//
// The prompt builder, the quality gate, the SEO health score and the event
// drawer all read their numbers from here. Before 24 November 2026 each of them
// carried its own (a meta title was 20-40 in the prompt, 20-60 in the gate, up
// to 60 in the health score, /60 in the drawer and 47 on the website), so a
// draft could pass one and fail the next. A guard test
// (tests/guards/event-seo-limits.test.ts) fails if any of those files carries
// its own number again.
//
// Spec: tasks/spec-2026-11-24-event-seo-generation.md, section 5.
// ──────────────────────────────────────────────────────────────

export type Range = { readonly min: number; readonly max: number }

export const EVENT_SEO_LIMITS = {
  /**
   * The stored meta title is a short name for the night, never dated. The
   * website builds the search title from the event name and date, and falls
   * back to this one only when the name is too long. 28 leaves room for the
   * longest date the website adds (", 30 September 2026", 19 characters) inside
   * its 47 character budget.
   */
  metaTitleChars: { min: 10, max: 28 },
  /** The website's own budget for the part of the title before " | The Anchor". */
  websiteTitleChars: 47,
  metaDescriptionChars: { min: 120, max: 155 },
  shortDescriptionChars: { min: 120, max: 160 },
  longDescriptionWords: { min: 220, max: 320 },
  longDescriptionParagraphs: { min: 4, max: 5 },
  highlightsCount: { min: 3, max: 5 },
  highlightWords: { min: 3, max: 8 },
  imageAltTextChars: { min: 60, max: 125 },
  faqCount: { min: 4, max: 6 },
  faqAnswerWords: { min: 20, max: 50 },
  slugChars: { min: 1, max: 60 },
  /** Focus phrase plus up to two variants. */
  focusKeywords: { min: 1, max: 3 },
  supportingKeywords: { min: 0, max: 6 },
  localKeywords: { min: 0, max: 4 },
  /** Supporting terms the body must carry when three or more are given. */
  supportingInBody: 2,
} as const

/**
 * How far a length may miss its range before the gate blocks it. Inside this
 * margin a miss is a warning: models count characters badly, and a meta
 * description of 158 characters is not worth a second model call.
 */
export const LENGTH_TOLERANCE = 0.1

export function withinRange(value: number, range: Range): boolean {
  return value >= range.min && value <= range.max
}

/** Within the range widened by LENGTH_TOLERANCE on each side. */
export function withinTolerance(value: number, range: Range): boolean {
  const slackMin = Math.floor(range.min * (1 - LENGTH_TOLERANCE))
  const slackMax = Math.ceil(range.max * (1 + LENGTH_TOLERANCE))
  return value >= slackMin && value <= slackMax
}

export function describeRange(range: Range, unit: string): string {
  return `${range.min} to ${range.max} ${unit}`
}

/**
 * Place names a page may use for its local terms. Stanwell Moor is always one;
 * the body names it and one other. "Near me" searches are met by these and by
 * the Event schema, never by writing "near me" into copy.
 */
export const HOME_PLACE = 'Stanwell Moor'
export const NEARBY_PLACES = ['Staines', 'Heathrow', 'Ashford', 'Feltham', 'Egham', 'Colnbrook', 'West Drayton'] as const
