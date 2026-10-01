/**
 * Figures about the rules themselves, worked out by running the real matcher over payments.
 * Pure: nothing here reads or writes. The services load the rules and payments and call in.
 */

import {
  evaluatePaymentAgainstRules,
  type EvaluablePayment,
  type EvaluableRule,
} from './rule-evaluation'
import type { RuleMatcherMode } from './rule-matching'

export type RuleHealthItem = {
  ruleId: string
  /** Payments the rule matches. */
  matches: number
  /** Payments where it decides the status, the vendor or the category. */
  wins: number
  matchesLast90Days: number
  lastMatchedDate: string | null
  /** Set when the rule matches payments and never wins one: the rule that most often beats it. */
  shadowedBy: { id: string; name: string } | null
}

function daysBefore(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

/**
 * For every rule: how many payments it matches, how many it wins, when it last matched, and
 * whether another rule always beats it. `today` is a London date, yyyy-mm-dd.
 */
export function computeRuleHealth<TRule extends EvaluableRule>(
  payments: readonly EvaluablePayment[],
  rules: readonly TRule[],
  options: { matcher?: RuleMatcherMode; today: string }
): RuleHealthItem[] {
  const recentFrom = daysBefore(options.today, 90)
  const stats = new Map<string, RuleHealthItem & { blockers: Map<string, number> }>()
  for (const rule of rules) {
    stats.set(rule.id, {
      ruleId: rule.id,
      matches: 0,
      wins: 0,
      matchesLast90Days: 0,
      lastMatchedDate: null,
      shadowedBy: null,
      blockers: new Map(),
    })
  }

  for (const payment of payments) {
    const evaluation = evaluatePaymentAgainstRules(payment, rules, {
      includeClosed: true,
      matcher: options.matcher,
      now: options.today,
    })
    if (!evaluation.ranked.length) continue

    const winnerIds = new Set(
      [evaluation.ranked[0].rule, evaluation.winners.vendor, evaluation.winners.expense]
        .filter((rule): rule is TRule => Boolean(rule))
        .map((rule) => rule.id)
    )
    const best = evaluation.ranked[0].rule

    for (const { rule } of evaluation.ranked) {
      const entry = stats.get(rule.id)
      if (!entry) continue
      entry.matches += 1
      if (payment.transaction_date >= recentFrom) entry.matchesLast90Days += 1
      if (!entry.lastMatchedDate || payment.transaction_date > entry.lastMatchedDate) {
        entry.lastMatchedDate = payment.transaction_date
      }
      if (winnerIds.has(rule.id)) {
        entry.wins += 1
      } else {
        entry.blockers.set(best.id, (entry.blockers.get(best.id) ?? 0) + 1)
      }
    }
  }

  const nameById = new Map(rules.map((rule) => [rule.id, rule.name]))

  return rules.map((rule) => {
    const { blockers, ...entry } = stats.get(rule.id) as RuleHealthItem & { blockers: Map<string, number> }
    if (entry.matches > 0 && entry.wins === 0 && blockers.size) {
      const [blockerId] = [...blockers.entries()].sort((left, right) => right[1] - left[1])[0]
      entry.shadowedBy = { id: blockerId, name: nameById.get(blockerId) ?? 'another rule' }
    }
    return entry
  })
}

export type MatcherDifference = {
  transactionId: string
  transactionDate: string
  details: string
  amount: number
  field: 'status' | 'vendor' | 'expense'
  /** The rule that decides the field today, and the one that would under whole-word matching. */
  fromRule: { id: string; name: string } | null
  toRule: { id: string; name: string } | null
}

export type MatcherComparison = {
  reviewed: number
  /** Payments where at least one field would be decided by a different rule, or by none. */
  paymentsAffected: number
  differences: MatcherDifference[]
  /** Per rule: fields it decides today and would stop deciding, and the reverse. */
  byRule: Array<{ ruleId: string; name: string; lost: number; gained: number }>
}

/**
 * Which payments would be decided by a different rule if keywords had to stand alone as whole
 * words. Nothing is changed by this: it is the list to read before switching the matcher.
 */
export function compareRuleMatchers<TRule extends EvaluableRule>(
  payments: readonly EvaluablePayment[],
  rules: readonly TRule[]
): MatcherComparison {
  const differences: MatcherDifference[] = []
  const byRule = new Map<string, { ruleId: string; name: string; lost: number; gained: number }>()
  const affected = new Set<string>()

  const bump = (rule: TRule | null, key: 'lost' | 'gained') => {
    if (!rule) return
    const entry = byRule.get(rule.id) ?? { ruleId: rule.id, name: rule.name, lost: 0, gained: 0 }
    entry[key] += 1
    byRule.set(rule.id, entry)
  }

  for (const payment of payments) {
    const evaluate = (matcher: RuleMatcherMode) => {
      const evaluation = evaluatePaymentAgainstRules(payment, rules, { includeClosed: true, matcher, now: '' })
      return {
        status: evaluation.ranked[0]?.rule ?? null,
        vendor: evaluation.winners.vendor,
        expense: evaluation.winners.expense,
      }
    }
    const today = evaluate('substring')
    const whole = evaluate('word')

    for (const field of ['status', 'vendor', 'expense'] as const) {
      const from = today[field]
      const to = whole[field]
      if ((from?.id ?? null) === (to?.id ?? null)) continue
      affected.add(payment.id)
      bump(from, 'lost')
      bump(to, 'gained')
      differences.push({
        transactionId: payment.id,
        transactionDate: payment.transaction_date,
        details: payment.details,
        amount: Number(payment.amount_out ?? payment.amount_in ?? 0),
        field,
        fromRule: from ? { id: from.id, name: from.name } : null,
        toRule: to ? { id: to.id, name: to.name } : null,
      })
    }
  }

  return {
    reviewed: payments.length,
    paymentsAffected: affected.size,
    differences,
    byRule: [...byRule.values()].sort((left, right) => right.lost + right.gained - (left.lost + left.gained)),
  }
}

export type RuleMatchExplanation = {
  matched: Array<{
    ruleId: string
    name: string
    priority: number
    /** The length of the longest keyword that matched; a longer keyword beats a shorter one. */
    keywordLength: number
    setsVendor: string | null
    setsCategory: string | null
    outcome: string
  }>
  status: { ruleId: string; name: string; outcome: string } | null
  vendor: { ruleId: string; name: string; value: string } | null
  category: { ruleId: string; name: string; value: string } | null
}

/** For the test box: which rules match a bank description, and which one decides each field. */
export function explainRuleMatch<TRule extends EvaluableRule>(
  input: { details: string; transactionType?: string | null; direction: 'in' | 'out'; amount: number },
  rules: readonly TRule[],
  matcher: RuleMatcherMode
): RuleMatchExplanation {
  const payment: EvaluablePayment = {
    id: 'test',
    transaction_date: '9999-12-31',
    details: input.details,
    transaction_type: input.transactionType ?? null,
    amount_in: input.direction === 'in' ? input.amount : null,
    amount_out: input.direction === 'out' ? input.amount : null,
    status: 'pending',
    marked_method: null,
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    vendor_rule_id: null,
    expense_category: null,
    expense_category_source: null,
    expense_rule_id: null,
    updated_at: '',
  }

  const evaluation = evaluatePaymentAgainstRules(payment, rules, { includeClosed: true, matcher, now: '' })
  const best = evaluation.ranked[0]?.rule ?? null

  return {
    matched: evaluation.ranked.map(({ rule, match }) => ({
      ruleId: rule.id,
      name: rule.name,
      priority: typeof rule.priority === 'number' ? rule.priority : 1000,
      keywordLength: match.matchedNeedleLength,
      setsVendor: rule.set_vendor_name,
      setsCategory: rule.set_expense_category,
      outcome: rule.auto_status,
    })),
    status: best ? { ruleId: best.id, name: best.name, outcome: best.auto_status } : null,
    vendor: evaluation.winners.vendor
      ? {
          ruleId: evaluation.winners.vendor.id,
          name: evaluation.winners.vendor.name,
          value: evaluation.winners.vendor.set_vendor_name ?? '',
        }
      : null,
    category: evaluation.winners.expense
      ? {
          ruleId: evaluation.winners.expense.id,
          name: evaluation.winners.expense.name,
          value: evaluation.winners.expense.set_expense_category ?? '',
        }
      : null,
  }
}
