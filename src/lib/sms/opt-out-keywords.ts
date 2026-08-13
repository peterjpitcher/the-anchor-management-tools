/**
 * Inbound opt-out keyword detection, shared by the Twilio webhook and the
 * holding-queue linker in src/services/communications.ts.
 *
 * These lists and the matching rule used to be duplicated in both places. They
 * are here now because the matching rule got smarter and two copies of it would
 * drift: a customer who opts out on one path but not the other is the worst
 * possible outcome for something this close to consent.
 *
 * This module deliberately imports nothing. The webhook's request path must not
 * pull in RBAC server actions, which is why communications.ts could never be the
 * shared home.
 *
 * Two tiers. A bare STOP silences everything, including booking confirmations,
 * because that is what the sender means and what carriers enforce anyway. A
 * marketing keyword stops event promotion only, so someone tired of event
 * invites still gets the confirmation for a table they book next week.
 */

/**
 * Full-opt-out keywords that carry no other meaning in a reply to a pub, so they
 * are honoured even when the customer keeps typing: "STOP MESSAGING ME!!" is a
 * real production message and unmistakably means stop.
 */
const STOP_KEYWORDS_LEADING_OK = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'QUIT'] as const

/**
 * Full-opt-out keywords that are also ordinary English, so they only count when
 * they are the entire message.
 *
 * "Cancel my table for Saturday" is a service request from someone who very much
 * wants us to text them back, and treating it as a full opt-out silenced their
 * booking confirmations too. Carriers only require the bare keyword to be
 * honoured, which the whole-message rule still does.
 */
const STOP_KEYWORDS_EXACT_ONLY = ['CANCEL', 'END'] as const

export const STOP_KEYWORDS = [...STOP_KEYWORDS_LEADING_OK, ...STOP_KEYWORDS_EXACT_ONLY] as const
export const MARKETING_STOP_KEYWORDS = ['NOEVENTS', 'NOPROMO', 'NOOFFERS'] as const

export type OptOutScope = 'all' | 'marketing_only'

export type OptOutDetection = {
  scope: OptOutScope
  /**
   * The canonical keyword that matched, e.g. 'NOEVENTS' even when the customer
   * wrote "No events". Analytics group on this, and the customer's exact words
   * are already stored on the message row.
   */
  keyword: string
}

/** Strip everything that is not a letter or digit, and upper-case the rest. */
function compact(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Does this message read as the given opt-out keyword?
 *
 * Whole-message match always counts, and it is the fix that matters for the
 * marketing keywords: a customer replied "No events" and the old exact-match
 * rule missed it because of the space, so she got an auto-reply asking how many
 * seats she wanted and had to guess the exact spelling before we stopped texting
 * her. Compacting also covers "no-events", "No Events." and "noevents".
 *
 * `allowLeading` additionally accepts the keyword as the opening word or opening
 * two words, for keywords that mean nothing else in a reply to a pub.
 *
 * What is never matched is the keyword appearing anywhere inside a longer
 * compacted string. That would let "END" swallow "ENDIVE".
 */
function messageMeansKeyword(words: string[], keyword: string, allowLeading: boolean): boolean {
  if (words.length === 0) return false
  if (compact(words.join(' ')) === keyword) return true
  if (!allowLeading) return false
  if (compact(words[0]) === keyword) return true
  if (words.length >= 2 && compact(words.slice(0, 2).join(' ')) === keyword) return true
  return false
}

/**
 * Classify an inbound message body as a full opt-out, a marketing-only opt-out,
 * or neither. Marketing wins ties so that the narrower preference is honoured.
 */
export function detectOptOut(bodyText: string | null | undefined): OptOutDetection | null {
  const words = (bodyText ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null

  // Marketing keywords are compound words with no everyday meaning, so a leading
  // match is safe and catches "no events please".
  const marketing = MARKETING_STOP_KEYWORDS.find((k) => messageMeansKeyword(words, k, true))
  if (marketing) return { scope: 'marketing_only', keyword: marketing }

  const leadingStop = STOP_KEYWORDS_LEADING_OK.find((k) => messageMeansKeyword(words, k, true))
  if (leadingStop) return { scope: 'all', keyword: leadingStop }

  const exactStop = STOP_KEYWORDS_EXACT_ONLY.find((k) => messageMeansKeyword(words, k, false))
  if (exactStop) return { scope: 'all', keyword: exactStop }

  return null
}
