export type ReceiptRuleMatchable = {
  id: string
  priority?: number | null
  created_at?: string | null
  match_description: string | null
  match_transaction_type: string | null
  match_direction: 'in' | 'out' | 'both'
  match_min_amount: number | null
  match_max_amount: number | null
}

export type ReceiptTransactionMatchable = {
  details: string
  transaction_type: string | null
}

/**
 * How a keyword is looked for in a bank description.
 *
 *  - `substring`: as it has always worked. A keyword of four or more characters matches anywhere,
 *    including inside another word; shorter ones must stand alone.
 *  - `word`: every keyword must stand alone, whatever its length, and runs of spaces count as
 *    one. "shell" no longer matches "SHELLFISH CO".
 *
 * The section's setting decides which is used. It stays on `substring` until someone has looked
 * at the comparison of the two and switched it.
 */
export type RuleMatcherMode = 'substring' | 'word'

export type MatchContext = {
  direction: 'in' | 'out'
  amountValue: number
  matcher?: RuleMatcherMode
}

export type RuleMatchResult = {
  matched: boolean
  matchedNeedleLength: number
  hasTransactionTypeMatch: boolean
  isDirectionSpecific: boolean
  amountConstraintCount: number
}

const SHORT_TOKEN_LENGTH = 3
const ALPHANUMERIC_PATTERN = /^[a-z0-9]+$/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * The keywords in a rule's match text. Keywords are separated by commas; a comma that belongs
 * to the keyword itself is written `\,`. A rule made from a whole bank description used to be
 * cut into pieces at every comma in it.
 */
export function splitRuleKeywords(matchDescription: string | null | undefined): string[] {
  if (!matchDescription) return []
  const keywords: string[] = []
  let current = ''
  for (let index = 0; index < matchDescription.length; index += 1) {
    const char = matchDescription[index]
    if (char === '\\' && matchDescription[index + 1] === ',') {
      current += ','
      index += 1
    } else if (char === ',') {
      keywords.push(current)
      current = ''
    } else {
      current += char
    }
  }
  keywords.push(current)
  return keywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0)
}

/** Writes one keyword so that `splitRuleKeywords` reads it back whole. */
export function escapeRuleKeyword(keyword: string): string {
  return keyword.replace(/,/g, '\\,')
}

function matchesNeedle(haystackLower: string, needleLower: string, matcher: RuleMatcherMode): boolean {
  if (!needleLower.length) return false

  if (matcher === 'word') {
    const needle = collapseSpaces(needleLower)
    if (!needle.length) return false
    // A boundary is asked for only where the keyword itself starts or ends with a letter or
    // digit, so a keyword such as "*amazon" or "co." still matches as written.
    const before = /^[a-z0-9]/.test(needle) ? '(^|[^a-z0-9])' : ''
    const after = /[a-z0-9]$/.test(needle) ? '([^a-z0-9]|$)' : ''
    return new RegExp(`${before}${escapeRegExp(needle)}${after}`).test(collapseSpaces(haystackLower))
  }

  if (needleLower.length <= SHORT_TOKEN_LENGTH && ALPHANUMERIC_PATTERN.test(needleLower)) {
    const escaped = escapeRegExp(needleLower)
    const boundaryMatch = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`)
    return boundaryMatch.test(haystackLower)
  }

  return haystackLower.includes(needleLower)
}

export function getRuleMatch(
  rule: ReceiptRuleMatchable,
  transaction: ReceiptTransactionMatchable,
  context: MatchContext
): RuleMatchResult {
  if (rule.match_direction !== 'both' && rule.match_direction !== context.direction) {
    return {
      matched: false,
      matchedNeedleLength: 0,
      hasTransactionTypeMatch: false,
      isDirectionSpecific: false,
      amountConstraintCount: 0,
    }
  }

  const amountConstraintCount = Number(rule.match_min_amount != null) + Number(rule.match_max_amount != null)

  if (rule.match_min_amount != null && context.amountValue < rule.match_min_amount) {
    return {
      matched: false,
      matchedNeedleLength: 0,
      hasTransactionTypeMatch: false,
      isDirectionSpecific: false,
      amountConstraintCount,
    }
  }

  if (rule.match_max_amount != null && context.amountValue > rule.match_max_amount) {
    return {
      matched: false,
      matchedNeedleLength: 0,
      hasTransactionTypeMatch: false,
      isDirectionSpecific: false,
      amountConstraintCount,
    }
  }

  const detailTextLower = transaction.details.toLowerCase()

  let matchedNeedleLength = 0
  if (rule.match_description) {
    const needles = splitRuleKeywords(rule.match_description.toLowerCase())

    for (const needle of needles) {
      if (matchesNeedle(detailTextLower, needle, context.matcher ?? 'substring')) {
        matchedNeedleLength = Math.max(matchedNeedleLength, needle.length)
      }
    }

    if (!matchedNeedleLength) {
      return {
        matched: false,
        matchedNeedleLength: 0,
        hasTransactionTypeMatch: false,
        isDirectionSpecific: false,
        amountConstraintCount,
      }
    }
  }

  let hasTransactionTypeMatch = false
  if (rule.match_transaction_type) {
    const transactionTypeLower = (transaction.transaction_type ?? '').toLowerCase()
    if (transactionTypeLower) {
      // Transaction has a type → it must contain the rule's type, as before.
      if (!transactionTypeLower.includes(rule.match_transaction_type.toLowerCase())) {
        return {
          matched: false,
          matchedNeedleLength,
          hasTransactionTypeMatch: false,
          isDirectionSpecific: false,
          amountConstraintCount,
        }
      }
      hasTransactionTypeMatch = true
    } else {
      // Typeless row (e.g. Amex): the type requirement is indeterminate. Allow the
      // match ONLY if the rule also matched on description; a type-only rule (no
      // description) must NOT match a typeless row (would over-match every credit).
      if (!rule.match_description) {
        return {
          matched: false,
          matchedNeedleLength,
          hasTransactionTypeMatch: false,
          isDirectionSpecific: false,
          amountConstraintCount,
        }
      }
      hasTransactionTypeMatch = false
    }
  }

  return {
    matched: true,
    matchedNeedleLength,
    hasTransactionTypeMatch,
    isDirectionSpecific: rule.match_direction !== 'both',
    amountConstraintCount,
  }
}

function normalizedPriority(rule: ReceiptRuleMatchable): number {
  const value = typeof rule.priority === 'number' ? rule.priority : Number(rule.priority ?? 1000)
  return Number.isFinite(value) ? value : 1000
}

function compareCreatedAt(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
}

function compareReceiptRuleMatches(
  candidateRule: ReceiptRuleMatchable,
  candidate: RuleMatchResult,
  currentRule: ReceiptRuleMatchable,
  currentBest: RuleMatchResult
): number {
  const priorityDelta = normalizedPriority(candidateRule) - normalizedPriority(currentRule)
  if (priorityDelta !== 0) {
    return priorityDelta
  }

  if (candidate.matchedNeedleLength !== currentBest.matchedNeedleLength) {
    return currentBest.matchedNeedleLength - candidate.matchedNeedleLength
  }

  if (Number(candidate.hasTransactionTypeMatch) !== Number(currentBest.hasTransactionTypeMatch)) {
    return Number(currentBest.hasTransactionTypeMatch) - Number(candidate.hasTransactionTypeMatch)
  }

  if (Number(candidate.isDirectionSpecific) !== Number(currentBest.isDirectionSpecific)) {
    return Number(currentBest.isDirectionSpecific) - Number(candidate.isDirectionSpecific)
  }

  if (candidate.amountConstraintCount !== currentBest.amountConstraintCount) {
    return currentBest.amountConstraintCount - candidate.amountConstraintCount
  }

  const createdAtDelta = compareCreatedAt(candidateRule.created_at, currentRule.created_at)
  if (createdAtDelta !== 0) {
    return createdAtDelta
  }

  return candidateRule.id.localeCompare(currentRule.id)
}

function isBetterMatch(
  candidateRule: ReceiptRuleMatchable,
  candidate: RuleMatchResult,
  currentRule: ReceiptRuleMatchable,
  currentBest: RuleMatchResult
): boolean {
  return compareReceiptRuleMatches(candidateRule, candidate, currentRule, currentBest) < 0
}

/**
 * Every rule that matches the payment, best first. The first decides the status. The vendor
 * comes from the first that sets a vendor and the category from the first that sets a category,
 * so a rule that only names the vendor no longer blocks a lower rule from giving the category.
 */
export function rankMatchingReceiptRules<TRule extends ReceiptRuleMatchable>(
  rules: readonly TRule[],
  transaction: ReceiptTransactionMatchable,
  context: MatchContext
): Array<{ rule: TRule; match: RuleMatchResult }> {
  const matches: Array<{ rule: TRule; match: RuleMatchResult }> = []
  for (const rule of rules) {
    const match = getRuleMatch(rule, transaction, context)
    if (match.matched) matches.push({ rule, match })
  }
  return matches.sort((left, right) => compareReceiptRuleMatches(left.rule, left.match, right.rule, right.match))
}

export function selectBestReceiptRule<TRule extends ReceiptRuleMatchable>(
  rules: readonly TRule[],
  transaction: ReceiptTransactionMatchable,
  context: MatchContext
): TRule | null {
  let bestRule: TRule | null = null
  let bestMatch: RuleMatchResult | null = null

  for (const rule of rules) {
    const match = getRuleMatch(rule, transaction, context)
    if (!match.matched) continue

    if (!bestRule || !bestMatch || isBetterMatch(rule, match, bestRule, bestMatch)) {
      bestRule = rule
      bestMatch = match
    }
  }

  return bestRule
}
