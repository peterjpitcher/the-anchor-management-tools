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

export const STOP_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END', 'STOPALL'] as const
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
 * Three shapes count, and no others:
 *
 *   1. The whole message compacts to the keyword. This is the fix that matters:
 *      a customer replied "No events" and the old exact-match rule missed it
 *      because of the space, so she got an auto-reply asking how many seats she
 *      wanted and had to guess the exact spelling before we stopped texting her.
 *      Also covers "no-events", "No Events." and "noevents".
 *   2. The first word is the keyword. Preserves the old prefix behaviour for
 *      real replies like "STOP MESSAGING ME!!".
 *   3. The first two words compact to the keyword, for "no events please".
 *
 * What is deliberately NOT matched is the keyword appearing anywhere in a longer
 * compacted string. "END" would then swallow "ENDIVE", and "CANCEL" would
 * swallow "cancel my table for Saturday", which is a service request from
 * someone who very much still wants us to text them back.
 */
function messageMeansKeyword(words: string[], keyword: string): boolean {
  if (words.length === 0) return false
  if (compact(words.join(' ')) === keyword) return true
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

  const marketing = MARKETING_STOP_KEYWORDS.find((k) => messageMeansKeyword(words, k))
  if (marketing) return { scope: 'marketing_only', keyword: marketing }

  const stop = STOP_KEYWORDS.find((k) => messageMeansKeyword(words, k))
  if (stop) return { scope: 'all', keyword: stop }

  return null
}
