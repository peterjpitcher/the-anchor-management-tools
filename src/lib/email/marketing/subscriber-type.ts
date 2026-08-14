import type { SubscriberType } from '@/types/marketing'

/**
 * Suggests whether a contact is a corporate or an individual subscriber.
 *
 * This is a HINT for the person doing the eligibility review, never a decision. It exists
 * because reviewing 160 contacts one at a time is what stalls a launch, and a stalled review
 * is what leads to somebody marking the whole list eligible without reading it. Turning the
 * job into checking a suggestion rather than typing an answer is the point.
 *
 * Why it matters legally: a limited company or an LLP is a corporate subscriber and may be
 * emailed without prior consent. A sole trader or an ordinary partnership counts as an
 * individual subscriber and needs consent or a fully satisfied soft opt-in. Nothing about an
 * email address tells you which, so a human still confirms every one.
 *
 * The suggestion is deliberately conservative: anything that is not clearly an incorporated
 * body or a public institution comes back as 'unknown' rather than guessing 'corporate',
 * because guessing wrong in that direction is the one that creates a breach.
 */

export interface SubscriberTypeSuggestion {
  suggestion: SubscriberType
  /** Plain-English reason, shown to the reviewer so they can disagree with it. */
  reason: string
  /** 'high' where the evidence is an incorporation suffix or a public body. */
  confidence: 'high' | 'low'
}

/** Suffixes that mean an incorporated body, so a corporate subscriber under PECR. */
const INCORPORATED = [
  'ltd', 'ltd.', 'limited', 'plc', 'p.l.c.', 'llp', 'l.l.p.', 'llc', 'inc', 'inc.',
  'incorporated', 'gmbh', 'b.v.', 'bv', 'n.v.', 'nv', 'sa', 'ag', 'pty',
]

/** Words that mean a public body or institution, also corporate subscribers. */
const INSTITUTION = [
  'school', 'college', 'academy', 'university', 'sixth form', 'nursery', 'primary',
  'secondary', 'council', 'borough', 'nhs', 'trust', 'hospital', 'surgery', 'authority',
  'police', 'fire service', 'ambulance', 'chamber of commerce', 'federation', 'association',
  'charity', 'foundation', 'institute', 'airport', 'airways', 'airlines',
]

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function suggestSubscriberType(input: {
  companyName?: string | null
  email?: string | null
  isFreemail?: boolean
}): SubscriberTypeSuggestion {
  const company = normalise(input.companyName ?? '')

  if (company) {
    const words = company.split(' ')
    const suffixHit = INCORPORATED.find((suffix) => words.includes(suffix))
    if (suffixHit) {
      return {
        suggestion: 'corporate',
        reason: `Company name contains "${suffixHit}", so it is an incorporated body.`,
        confidence: 'high',
      }
    }

    const institutionHit = INSTITUTION.find((word) => company.includes(word))
    if (institutionHit) {
      return {
        suggestion: 'corporate',
        reason: `Company name contains "${institutionHit}", which is an organisation rather than a person.`,
        confidence: 'high',
      }
    }
  }

  // A free-mail address is not proof of a sole trader, but it is the single strongest reason
  // to look properly before emailing, so it is surfaced rather than resolved.
  if (input.isFreemail) {
    return {
      suggestion: 'unknown',
      reason: 'Free-mail address with no company suffix. Often a sole trader, who needs consent. Check before marking eligible.',
      confidence: 'low',
    }
  }

  if (company) {
    return {
      suggestion: 'unknown',
      reason: 'Business domain, but the name does not show an incorporated body. Could be a sole trader trading under a name.',
      confidence: 'low',
    }
  }

  return {
    suggestion: 'unknown',
    reason: 'Not enough information to suggest a type.',
    confidence: 'low',
  }
}
