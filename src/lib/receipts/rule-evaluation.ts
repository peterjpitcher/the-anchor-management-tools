/**
 * What the rules would do to one payment. Pure: it reads nothing and writes nothing.
 *
 * The rule engine, the preview of a run over history, the rule health figures and the test box
 * all call this, so a preview shows exactly what a run then does.
 *
 * Each field is decided on its own (spec 9.2 item 6):
 *  - the status comes from the best matching rule;
 *  - the vendor comes from the best matching rule that sets a vendor;
 *  - the category comes from the best matching rule that sets a category.
 * What may be written is fixed by `./field-protection`, and nothing is planned for a payment
 * dated on or before the lock date.
 */

import type { ReceiptClassificationSource, ReceiptTransaction } from '@/types/database'
import { canAutomationChangeStatus, canRuleWriteField } from './field-protection'
import {
  rankMatchingReceiptRules,
  type ReceiptRuleMatchable,
  type RuleMatchResult,
  type RuleMatcherMode,
} from './rule-matching'

export type EvaluableRule = ReceiptRuleMatchable & {
  name: string
  auto_status: ReceiptTransaction['status']
  set_vendor_name: string | null
  set_expense_category: string | null
  vendor_id?: string | null
}

export type EvaluablePayment = Pick<
  ReceiptTransaction,
  | 'id'
  | 'transaction_date'
  | 'details'
  | 'transaction_type'
  | 'amount_in'
  | 'amount_out'
  | 'status'
  | 'marked_method'
  | 'vendor_id'
  | 'vendor_name'
  | 'vendor_source'
  | 'vendor_rule_id'
  | 'expense_category'
  | 'expense_category_source'
  | 'expense_rule_id'
  | 'updated_at'
>

export type RuleEvaluationOptions = {
  /** Also classify payments that are no longer pending. Their status is never changed. */
  includeClosed?: boolean
  /** Only plan the fields this rule wins. Every rule still takes part in deciding who wins. */
  targetRuleId?: string | null
  /** Payments dated on or before this are left alone. */
  lockDate?: string | null
  matcher?: RuleMatcherMode
  /** Rules whose vendor could not be tied to the vendor list. Their vendor is not written. */
  unresolvedVendorRuleIds?: ReadonlySet<string>
  /** The time written into the change, as an ISO string. */
  now: string
}

/** A history row written together with the change. */
export type RuleChangeLog = { action_type: string; note: string; rule_id: string }

export type RuleChangePlan = {
  transactionId: string
  /** The payment's version when it was evaluated. The change is written only if it still holds. */
  expectedUpdatedAt: string
  /** The fields to write. A key that is present is written, including null. */
  after: Record<string, string | boolean | null>
  logs: RuleChangeLog[]
  statusChanged: boolean
  vendorChanged: boolean
  expenseChanged: boolean
  /** Plain-language notes on the vendor and category, for the screen and the signals. */
  classificationNotes: string[]
}

export type RuleEvaluation<TRule extends EvaluableRule = EvaluableRule> = {
  /** False when the payment is closed and the run is over pending payments only. */
  inScope: boolean
  /** Some rule matched, or, with a target rule, the target matched. */
  matched: boolean
  /** A rule wanted to set something a person, the import or invoice pairing decided. */
  protectedByOwner: boolean
  /** The rules would change it, but it is on or before the lock date. */
  locked: boolean
  /** A rule that won the vendor could not be tied to the vendor list. */
  vendorUnresolved: boolean
  winners: { status: TRule | null; vendor: TRule | null; expense: TRule | null }
  /** Every rule that matched, best first, for the test box and rule health. */
  ranked: Array<{ rule: TRule; match: RuleMatchResult }>
  plan: RuleChangePlan | null
}

export function paymentDirection(payment: Pick<ReceiptTransaction, 'amount_in' | 'amount_out'>): 'in' | 'out' {
  if (payment.amount_in && payment.amount_in > 0) return 'in'
  return 'out'
}

/** The amount a rule's limits are compared with: money in if there is any, otherwise money out. */
export function paymentAmount(payment: Pick<ReceiptTransaction, 'amount_in' | 'amount_out'>): number {
  if (payment.amount_in && payment.amount_in > 0) return payment.amount_in
  if (payment.amount_out && payment.amount_out > 0) return payment.amount_out
  return 0
}

const NOTHING = {
  matched: false,
  protectedByOwner: false,
  locked: false,
  vendorUnresolved: false,
  plan: null,
} as const

export function evaluatePaymentAgainstRules<TRule extends EvaluableRule>(
  payment: EvaluablePayment,
  rules: readonly TRule[],
  options: RuleEvaluationOptions
): RuleEvaluation<TRule> {
  const isPending = payment.status === 'pending'
  const noWinners = { status: null, vendor: null, expense: null }

  if (!options.includeClosed && !isPending) {
    return { ...NOTHING, inScope: false, winners: noWinners, ranked: [] }
  }

  const direction = paymentDirection(payment)
  const ranked = rankMatchingReceiptRules(
    rules,
    { details: payment.details, transaction_type: payment.transaction_type },
    { direction, amountValue: paymentAmount(payment), matcher: options.matcher }
  )

  if (!ranked.length) {
    return { ...NOTHING, inScope: true, winners: noWinners, ranked }
  }

  const target = options.targetRuleId ?? null
  if (target && !ranked.some((entry) => entry.rule.id === target)) {
    return { ...NOTHING, inScope: true, winners: noWinners, ranked }
  }

  // Who wins each field, among every rule that matched.
  const bestStatus = ranked[0].rule
  const bestVendor = ranked.find((entry) => Boolean(entry.rule.set_vendor_name))?.rule ?? null
  const bestExpense =
    direction === 'out' ? ranked.find((entry) => Boolean(entry.rule.set_expense_category))?.rule ?? null : null

  // With a target rule, only the fields it wins are its to write.
  const owns = (rule: TRule | null): TRule | null => (rule && (!target || rule.id === target) ? rule : null)
  const statusRule = owns(bestStatus)
  const vendorRuleCandidate = owns(bestVendor)
  const expenseRule = owns(bestExpense)

  const vendorUnresolved = Boolean(vendorRuleCandidate && options.unresolvedVendorRuleIds?.has(vendorRuleCandidate.id))
  const vendorRule = vendorUnresolved ? null : vendorRuleCandidate

  const winners = { status: statusRule, vendor: vendorRule, expense: expenseRule }

  const vendorValueDiffers = Boolean(vendorRule) && payment.vendor_name !== vendorRule?.set_vendor_name
  const expenseValueDiffers = Boolean(expenseRule) && payment.expense_category !== expenseRule?.set_expense_category
  // Same value, but not yet recorded as this rule's: the rule takes it over from the AI or an older rule.
  const vendorOwnerDiffers =
    Boolean(vendorRule) && (payment.vendor_source !== 'rule' || payment.vendor_rule_id !== vendorRule?.id)
  const expenseOwnerDiffers =
    Boolean(expenseRule) &&
    (payment.expense_category_source !== 'rule' || payment.expense_rule_id !== expenseRule?.id)

  const vendorWritable = canRuleWriteField(payment.vendor_source)
  const expenseWritable = canRuleWriteField(payment.expense_category_source)
  const vendorChanged = (vendorValueDiffers || vendorOwnerDiffers) && vendorWritable
  const expenseChanged = (expenseValueDiffers || expenseOwnerDiffers) && expenseWritable

  const targetStatus = statusRule?.auto_status ?? null
  const wantsStatus = Boolean(statusRule) && isPending && targetStatus !== payment.status
  const statusChanged = wantsStatus && canAutomationChangeStatus(payment)

  const protectedByOwner =
    (vendorValueDiffers && !vendorWritable) || (expenseValueDiffers && !expenseWritable) || (wantsStatus && !statusChanged)

  const base = { inScope: true, matched: true, protectedByOwner, vendorUnresolved, winners, ranked }

  if (!vendorChanged && !expenseChanged && !statusChanged) {
    return { ...base, locked: false, plan: null }
  }

  if (options.lockDate && payment.transaction_date <= options.lockDate) {
    return { ...base, locked: true, plan: null }
  }

  const after: Record<string, string | boolean | null> = {}
  const logs: RuleChangeLog[] = []
  const classificationNotes: string[] = []

  if (statusChanged && statusRule && targetStatus) {
    after.status = targetStatus
    after.receipt_required = targetStatus === 'pending'
    after.marked_by = null
    after.marked_by_email = null
    after.marked_by_name = null
    after.marked_at = options.now
    after.marked_method = 'rule'
    if (targetStatus === 'auto_completed') {
      after.auto_completed_reason = `trusted_rule:${statusRule.id}`
    }
    logs.push({
      action_type: 'rule_auto_mark',
      note: `Auto-marked by rule: ${statusRule.name}`,
      rule_id: statusRule.id,
    })
  }

  const notesByRule = new Map<string, { rule: TRule; notes: string[] }>()
  const note = (rule: TRule, text: string) => {
    const entry = notesByRule.get(rule.id) ?? { rule, notes: [] }
    entry.notes.push(text)
    notesByRule.set(rule.id, entry)
    classificationNotes.push(text)
  }

  if (vendorChanged && vendorRule) {
    after.vendor_name = vendorRule.set_vendor_name
    after.vendor_id = vendorRule.vendor_id ?? null
    after.vendor_source = 'rule' satisfies ReceiptClassificationSource
    after.vendor_rule_id = vendorRule.id
    after.vendor_updated_at = options.now
    note(vendorRule, `Vendor → ${vendorRule.set_vendor_name}`)
  }

  if (expenseChanged && expenseRule) {
    after.expense_category = expenseRule.set_expense_category
    after.expense_category_source = 'rule' satisfies ReceiptClassificationSource
    after.expense_rule_id = expenseRule.id
    after.expense_updated_at = options.now
    note(expenseRule, `Expense → ${expenseRule.set_expense_category}`)
  }

  for (const { rule, notes } of notesByRule.values()) {
    logs.push({
      action_type: 'rule_classification',
      note: `Classification updated by rule ${rule.name}: ${notes.join(' | ')}`,
      rule_id: rule.id,
    })
  }

  // The rule that last acted on a pending payment. A closed payment keeps whatever it had:
  // its vendor_rule_id and expense_rule_id already say which rule classified it.
  if (isPending) {
    const acting = statusRule ?? vendorRule ?? expenseRule
    if (acting) after.rule_applied_id = acting.id
  }

  return {
    ...base,
    locked: false,
    plan: {
      transactionId: payment.id,
      expectedUpdatedAt: payment.updated_at,
      after,
      logs,
      statusChanged,
      vendorChanged,
      expenseChanged,
      classificationNotes,
    },
  }
}
