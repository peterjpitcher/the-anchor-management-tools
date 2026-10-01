/**
 * What makes two rules the same rule: what they match and what they do. Used to refuse a
 * duplicate when a rule is created, edited or approved from a suggestion, whether the existing
 * one is switched on or off.
 */

import { splitRuleKeywords } from './rule-matching'

export type RuleIdentityInput = {
  match_description?: string | null
  match_transaction_type?: string | null
  match_direction?: string | null
  match_min_amount?: number | string | null
  match_max_amount?: number | string | null
  set_vendor_name?: string | null
  vendor_id?: string | null
  set_expense_category?: string | null
  auto_status?: string | null
}

function text(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function amount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : ''
}

/** The keywords, whatever order or spacing they were typed in. */
export function ruleKeywordSet(matchDescription: string | null | undefined): string[] {
  return [...new Set(splitRuleKeywords((matchDescription ?? '').toLowerCase()).map((keyword) => text(keyword)))]
    .filter(Boolean)
    .sort()
}

export function ruleIdentityKey(rule: RuleIdentityInput): string {
  return JSON.stringify([
    ruleKeywordSet(rule.match_description),
    text(rule.match_transaction_type),
    rule.match_direction ?? 'both',
    amount(rule.match_min_amount),
    amount(rule.match_max_amount),
    // The vendor itself where it is known; its name only for an old rule with no vendor id.
    rule.vendor_id ?? text(rule.set_vendor_name),
    rule.set_expense_category ?? '',
    rule.auto_status ?? 'pending',
  ])
}

export function findDuplicateRule<T extends RuleIdentityInput & { id: string }>(
  rules: readonly T[],
  candidate: RuleIdentityInput,
  excludeId?: string | null
): T | null {
  const key = ruleIdentityKey(candidate)
  return rules.find((rule) => rule.id !== excludeId && ruleIdentityKey(rule) === key) ?? null
}

/** The fields that decide what a rule matches and does. A review covers these and nothing else. */
export function ruleBehaviourChanged(before: RuleIdentityInput, after: RuleIdentityInput): boolean {
  return ruleIdentityKey(before) !== ruleIdentityKey(after)
}
