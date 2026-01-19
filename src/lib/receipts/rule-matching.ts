export type ReceiptRuleMatchable = {
  id: string
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

type MatchContext = {
  direction: 'in' | 'out'
  amountValue: number
}

type RuleMatchResult = {
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

function matchesNeedle(haystackLower: string, needleLower: string): boolean {
  if (!needleLower.length) return false

  if (needleLower.length <= SHORT_TOKEN_LENGTH && ALPHANUMERIC_PATTERN.test(needleLower)) {
    const escaped = escapeRegExp(needleLower)
    const boundaryMatch = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`)
    return boundaryMatch.test(haystackLower)
  }

  return haystackLower.includes(needleLower)
}

function getRuleMatch(
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
    const needles = rule.match_description
      .toLowerCase()
      .split(',')
      .map((needle) => needle.trim())
      .filter((needle) => needle.length > 0)

    for (const needle of needles) {
      if (matchesNeedle(detailTextLower, needle)) {
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
  }

  return {
    matched: true,
    matchedNeedleLength,
    hasTransactionTypeMatch,
    isDirectionSpecific: rule.match_direction !== 'both',
    amountConstraintCount,
  }
}

function isBetterMatch(candidate: RuleMatchResult, currentBest: RuleMatchResult): boolean {
  if (candidate.matchedNeedleLength !== currentBest.matchedNeedleLength) {
    return candidate.matchedNeedleLength > currentBest.matchedNeedleLength
  }

  if (Number(candidate.hasTransactionTypeMatch) !== Number(currentBest.hasTransactionTypeMatch)) {
    return Number(candidate.hasTransactionTypeMatch) > Number(currentBest.hasTransactionTypeMatch)
  }

  if (Number(candidate.isDirectionSpecific) !== Number(currentBest.isDirectionSpecific)) {
    return Number(candidate.isDirectionSpecific) > Number(currentBest.isDirectionSpecific)
  }

  if (candidate.amountConstraintCount !== currentBest.amountConstraintCount) {
    return candidate.amountConstraintCount > currentBest.amountConstraintCount
  }

  return false
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

    if (!bestMatch || isBetterMatch(match, bestMatch)) {
      bestRule = rule
      bestMatch = match
    }
  }

  return bestRule
}

