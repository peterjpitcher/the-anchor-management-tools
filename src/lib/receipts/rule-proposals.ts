/**
 * Working out a rule to propose from payments that already carry a vendor. Pure.
 *
 * A proposal used to take its keyword from the AI's free text. 27 of the first 68 had a keyword
 * that appeared in none of the payments they were raised from, and 10 matched more than fifty
 * payments each ("range" matched 1,423). A keyword is now taken from the payments themselves:
 * a piece of text that every one of them contains, checked against every other vendor's
 * payments before it is offered.
 */

import { escapeRuleKeyword, getRuleMatch, type RuleMatcherMode } from './rule-matching'

export type ProposalPayment = {
  id: string
  details: string
  direction: 'in' | 'out'
  vendorId: string | null
}

export type VendorRuleProposal = {
  /** The keyword as it goes into the rule, with any comma escaped. */
  keyword: string
  direction: 'in' | 'out' | 'both'
  /** The payments it was worked out from. Every one of them contains the keyword. */
  evidenceIds: string[]
  /** How many payments the keyword matches in all. */
  matchCount: number
  /** How many of those belong to a different vendor. Above zero, the proposal cannot be approved. */
  collisions: number
  samples: string[]
}

/** Words that say how a payment was made, not who it was made to. */
const GENERIC_WORDS = new Set([
  'card', 'purchase', 'payment', 'payments', 'debit', 'direct', 'credit', 'faster', 'outward', 'inward',
  'transfer', 'standing', 'order', 'bill', 'ref', 'reference', 'the', 'and', 'for', 'www', 'com', 'co',
  'uk', 'gb', 'gbp', 'ltd', 'limited', 'plc', 'contactless', 'pos', 'visa', 'mastercard', 'paypal',
  'sumup', 'zettle', 'sq', 'bacs', 'chaps', 'dd', 'so', 'fp', 'to', 'from', 'of', 'on', 'at', 'via',
])

function collapse(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function trimPunctuation(text: string): string {
  return text.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
}

function isMeaningful(phrase: string): boolean {
  const words = phrase.split(/[^a-z0-9]+/).filter(Boolean)
  const real = words.filter((word) => !GENERIC_WORDS.has(word) && !/^\d+$/.test(word))
  // At least one real word of three letters or more, and four characters in all.
  return real.some((word) => word.length >= 3) && phrase.replace(/[^a-z0-9]/g, '').length >= 4
}

function standsAlone(haystack: string, needle: string): boolean {
  let from = 0
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) return false
    const before = index === 0 ? '' : haystack[index - 1]
    const after = index + needle.length >= haystack.length ? '' : haystack[index + needle.length]
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true
    from = index + 1
  }
  return false
}

/**
 * The longest piece of text, made of whole words, that every description contains. Null when
 * there is none worth using: nothing shared, or only words such as "card purchase".
 */
export function findSharedKeyword(descriptions: readonly string[]): string | null {
  const texts = descriptions.map(collapse).filter(Boolean)
  if (texts.length < 2) return null

  const words = texts[0].split(' ')
  let best: string | null = null

  for (let length = words.length; length >= 1; length -= 1) {
    for (let start = 0; start + length <= words.length; start += 1) {
      const phrase = trimPunctuation(words.slice(start, start + length).join(' '))
      if (!phrase || !isMeaningful(phrase)) continue
      if (best && phrase.length <= best.length) continue
      if (texts.every((text) => standsAlone(text, phrase))) {
        best = phrase
      }
    }
    // The longest phrase of this many words beats anything shorter.
    if (best) return best
  }

  return best
}

function matchesKeyword(keyword: string, payment: ProposalPayment, matcher: RuleMatcherMode): boolean {
  return getRuleMatch(
    {
      id: 'proposal',
      match_description: keyword,
      match_transaction_type: null,
      match_direction: 'both',
      match_min_amount: null,
      match_max_amount: null,
    },
    { details: payment.details, transaction_type: null },
    { direction: payment.direction, amountValue: 0, matcher }
  ).matched
}

/** How many payments a keyword matches, and how many of those belong to another vendor. */
export function countKeywordMatches(
  keyword: string,
  vendorId: string | null,
  allPayments: readonly ProposalPayment[],
  matcher: RuleMatcherMode
): { matchCount: number; collisions: number } {
  let matchCount = 0
  let collisions = 0
  for (const payment of allPayments) {
    if (!matchesKeyword(keyword, payment, matcher)) continue
    matchCount += 1
    if (payment.vendorId && payment.vendorId !== vendorId) collisions += 1
  }
  return { matchCount, collisions }
}

/**
 * A rule to propose for one vendor, from two or more of its payments. Null when they share no
 * usable text. The proposal says how many payments of other vendors the keyword would also
 * catch; the caller refuses to approve one where that is above zero.
 */
export function proposeVendorRule(
  vendorId: string,
  evidence: readonly ProposalPayment[],
  allPayments: readonly ProposalPayment[],
  matcher: RuleMatcherMode = 'substring'
): VendorRuleProposal | null {
  if (evidence.length < 2) return null

  const shared = findSharedKeyword(evidence.map((payment) => payment.details))
  if (!shared) return null

  const keyword = escapeRuleKeyword(shared)
  // The keyword came from whole words, but the rule is matched by the matcher in use. It must
  // find every payment it was worked out from, or the proposal would not do what it says.
  if (!evidence.every((payment) => matchesKeyword(keyword, payment, matcher))) return null

  const directions = new Set(evidence.map((payment) => payment.direction))
  const { matchCount, collisions } = countKeywordMatches(keyword, vendorId, allPayments, matcher)

  return {
    keyword,
    direction: directions.size === 1 ? [...directions][0] : 'both',
    evidenceIds: evidence.slice(0, 20).map((payment) => payment.id),
    matchCount,
    collisions,
    samples: [...new Set(evidence.map((payment) => payment.details))].slice(0, 3),
  }
}
