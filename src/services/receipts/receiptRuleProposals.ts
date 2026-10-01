/**
 * Proposing rules from what people and the AI have already decided, and checking a proposal
 * against every payment before it can be approved.
 *
 * A proposal is raised only when two or more payments of one vendor share a piece of description
 * text. The keyword is that text, so it is in every payment it was raised from. Before it is
 * offered, and again when it is approved, it is run over every payment: if it would also catch
 * payments belonging to a different vendor, it cannot be approved as it stands.
 *
 * Nothing about a person is proposed: payments naming a member of staff, and vendors who are
 * people, are left out. Wage payments are recognised from the employee list instead.
 *
 * @requires Run by the job queue, or by a caller that has verified the user is a super admin.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { loadPayrollEmployees } from '@/lib/receipts/ai-classification'
import { containsEmployeeName } from '@/lib/receipts/payroll-recognition'
import { evaluatePaymentAgainstRules, type EvaluablePayment } from '@/lib/receipts/rule-evaluation'
import { ruleIdentityKey, type RuleIdentityInput } from '@/lib/receipts/rule-identity'
import {
  countKeywordMatches,
  proposeVendorRule,
  type ProposalPayment,
  type VendorRuleProposal,
} from '@/lib/receipts/rule-proposals'
import type { RuleMatcherMode } from '@/lib/receipts/rule-matching'
import type { ReceiptRule, ReceiptRuleSuggestion, ReceiptTransaction } from '@/types/database'
import { loadReceiptSettings } from './receiptSettings'
import type { AdminClient } from './types'

/** New proposals per run. The rest wait for the next run. */
const PROPOSAL_CAP = 25
/** A person decided these. Rule and AI values are not evidence for a new rule. */
const PERSON_SOURCES = new Set(['manual', 'ai_accepted'])
/** The vendor was set by a person or the AI, and no rule covers it yet. */
const UNRULED_VENDOR_SOURCES = new Set(['manual', 'ai_accepted', 'ai'])

type PaymentRow = Pick<
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
> & { no_category_applies?: boolean | null }

const PAYMENT_COLUMNS =
  'id, transaction_date, details, transaction_type, amount_in, amount_out, status, marked_method, vendor_id, vendor_name, vendor_source, vendor_rule_id, expense_category, no_category_applies, expense_category_source, expense_rule_id, updated_at'

function directionOf(payment: Pick<PaymentRow, 'amount_in' | 'amount_out'>): 'in' | 'out' {
  return payment.amount_in && payment.amount_in > 0 ? 'in' : 'out'
}

async function loadAllPayments(supabase: AdminClient): Promise<PaymentRow[]> {
  return fetchAllRows<PaymentRow>(
    (from, to) =>
      (supabase as any).from('receipt_transactions').select(PAYMENT_COLUMNS).order('id', { ascending: true }).range(from, to),
    { label: 'receipt payments for rule proposals' }
  )
}

function toProposalPayment(payment: PaymentRow): ProposalPayment {
  return { id: payment.id, details: payment.details, direction: directionOf(payment), vendorId: payment.vendor_id }
}

/** The one category people gave these payments, when two or more have one and they all agree. */
function agreedCategory(payments: readonly PaymentRow[]): string | null {
  const decided = payments.filter(
    (payment) => payment.expense_category && PERSON_SOURCES.has(payment.expense_category_source ?? '')
  )
  if (decided.length < 2) return null
  const categories = new Set(decided.map((payment) => payment.expense_category))
  return categories.size === 1 ? (decided[0].expense_category as string) : null
}

/** Splits a vendor's payments by the first word of the description, for vendors that trade under several. */
function byLeadingWord(payments: readonly PaymentRow[]): PaymentRow[][] {
  const groups = new Map<string, PaymentRow[]>()
  for (const payment of payments) {
    const word = payment.details.toLowerCase().match(/[a-z0-9]{3,}/)?.[0] ?? ''
    const group = groups.get(word) ?? []
    group.push(payment)
    groups.set(word, group)
  }
  return [...groups.values()].filter((group) => group.length >= 2)
}

type SuggestionInsert = {
  suggested_name: string
  match_description: string | null
  match_transaction_type: string | null
  match_direction: string
  match_min_amount: number | null
  match_max_amount: number | null
  set_vendor_id: string | null
  set_vendor_name: string | null
  set_expense_category: string | null
  auto_status: 'pending'
  evidence_transaction_ids: string[]
  evidence: Record<string, unknown>
}

function suggestionIdentity(suggestion: {
  match_description: string | null
  match_direction: string | null
  match_min_amount?: number | string | null
  match_max_amount?: number | string | null
  set_vendor_id?: string | null
  set_vendor_name: string | null
  set_expense_category: string | null
  auto_status?: string | null
}): RuleIdentityInput {
  return {
    match_description: suggestion.match_description,
    match_transaction_type: null,
    match_direction: suggestion.match_direction,
    match_min_amount: suggestion.match_min_amount ?? null,
    match_max_amount: suggestion.match_max_amount ?? null,
    vendor_id: suggestion.set_vendor_id ?? null,
    set_vendor_name: suggestion.set_vendor_name,
    set_expense_category: suggestion.set_expense_category,
    auto_status: suggestion.auto_status ?? 'pending',
  }
}

export async function performSuggestReceiptRules(): Promise<{ reviewed: number; created: number }> {
  const supabase = createAdminClient()

  const [payments, settings, employees, rulesResult, suggestionsResult, vendorsResult] = await Promise.all([
    loadAllPayments(supabase),
    loadReceiptSettings(supabase),
    loadPayrollEmployees(supabase),
    supabase.from('receipt_rules').select('*'),
    // Every proposal ever made, whatever became of it: a declined one stays declined.
    fetchAllRows<ReceiptRuleSuggestion>(
      (from, to) =>
        (supabase as any).from('receipt_rule_suggestions').select('*').order('id', { ascending: true }).range(from, to),
      { label: 'receipt rule suggestions for dedupe' }
    ),
    fetchAllRows<{ id: string; canonical_name: string; kind: string | null; status: string }>(
      (from, to) =>
        (supabase as any)
          .from('receipt_vendors')
          .select('id, canonical_name, kind, status')
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'receipt vendors for rule proposals' }
    ),
  ])

  if (rulesResult.error) {
    throw new Error(`Failed to load receipt rules: ${rulesResult.error.message}`)
  }

  const rules = (rulesResult.data ?? []) as ReceiptRule[]
  const activeRules = rules
    .filter((rule) => rule.is_active)
    .sort((left, right) => (left.priority ?? 1000) - (right.priority ?? 1000) || left.created_at.localeCompare(right.created_at))
  const vendorById = new Map(vendorsResult.map((vendor) => [vendor.id, vendor]))

  // Payments carrying a member of staff's name take no part: not as evidence, and not as
  // something a keyword is checked against by name.
  const usable = payments.filter((payment) => !containsEmployeeName(payment.details, employees))
  const allProposalPayments = usable.map(toProposalPayment)

  const known = new Set<string>([
    ...rules.map((rule) => ruleIdentityKey(rule)),
    ...suggestionsResult.map((suggestion) => ruleIdentityKey(suggestionIdentity(suggestion))),
  ])

  const inserts: SuggestionInsert[] = []
  const offer = (insert: SuggestionInsert): void => {
    if (inserts.length >= PROPOSAL_CAP) return
    const key = ruleIdentityKey(suggestionIdentity(insert))
    if (known.has(key)) return
    known.add(key)
    inserts.push(insert)
  }

  // ---- A new rule for a vendor that no rule sets yet --------------------------------------------
  const unruledByVendor = new Map<string, PaymentRow[]>()
  for (const payment of usable) {
    if (!payment.vendor_id || payment.vendor_rule_id) continue
    if (!UNRULED_VENDOR_SOURCES.has(payment.vendor_source ?? '')) continue
    const group = unruledByVendor.get(payment.vendor_id) ?? []
    group.push(payment)
    unruledByVendor.set(payment.vendor_id, group)
  }

  for (const [vendorId, vendorPayments] of unruledByVendor) {
    const vendor = vendorById.get(vendorId)
    if (!vendor || vendor.kind === 'person' || (vendor.status !== 'unconfirmed' && vendor.status !== 'confirmed')) continue
    if (vendorPayments.length < 2) continue

    // Already covered: an active rule would give every one of these payments this vendor.
    const covered = vendorPayments.every((payment) => {
      const evaluation = evaluatePaymentAgainstRules(payment as EvaluablePayment, activeRules, {
        includeClosed: true,
        matcher: settings.matcher,
        now: '',
      })
      return evaluation.winners.vendor?.vendor_id === vendorId
    })
    if (covered) continue

    const whole = proposeVendorRule(vendorId, vendorPayments.map(toProposalPayment), allProposalPayments, settings.matcher)
    const groups: Array<{ proposal: VendorRuleProposal; payments: PaymentRow[] }> = whole
      ? [{ proposal: whole, payments: vendorPayments }]
      : byLeadingWord(vendorPayments)
          .map((group) => ({
            proposal: proposeVendorRule(vendorId, group.map(toProposalPayment), allProposalPayments, settings.matcher),
            payments: group,
          }))
          .filter((entry): entry is { proposal: VendorRuleProposal; payments: PaymentRow[] } => Boolean(entry.proposal))

    for (const { proposal, payments: evidence } of groups) {
      const category = proposal.direction === 'out' ? agreedCategory(evidence) : null
      offer({
        suggested_name: `${vendor.canonical_name} auto-tag`,
        match_description: proposal.keyword,
        match_transaction_type: null,
        match_direction: proposal.direction,
        match_min_amount: null,
        match_max_amount: null,
        set_vendor_id: vendorId,
        set_vendor_name: vendor.canonical_name,
        set_expense_category: category,
        auto_status: 'pending',
        evidence_transaction_ids: proposal.evidenceIds,
        evidence: {
          source: 'checked',
          kind: 'new_rule',
          transaction_count: evidence.length,
          preview_match_count: proposal.matchCount,
          collision_count: proposal.collisions,
          details_samples: proposal.samples,
        },
      })
    }
  }

  // ---- A category for a rule that names the vendor and sets none --------------------------------
  const byVendorRule = new Map<string, PaymentRow[]>()
  for (const payment of usable) {
    if (!payment.vendor_rule_id) continue
    const group = byVendorRule.get(payment.vendor_rule_id) ?? []
    group.push(payment)
    byVendorRule.set(payment.vendor_rule_id, group)
  }

  for (const rule of activeRules) {
    if (!rule.set_vendor_name || rule.set_expense_category || rule.set_no_category) continue
    if (rule.match_direction !== 'out') continue
    if (rule.vendor_id && vendorById.get(rule.vendor_id)?.kind === 'person') continue

    const category = agreedCategory(byVendorRule.get(rule.id) ?? [])
    if (!category) continue

    const evidence = (byVendorRule.get(rule.id) ?? []).filter((payment) => payment.expense_category === category)
    offer({
      suggested_name: `${rule.name}: add ${category}`,
      match_description: rule.match_description,
      match_transaction_type: null,
      match_direction: rule.match_direction,
      match_min_amount: rule.match_min_amount,
      match_max_amount: rule.match_max_amount,
      set_vendor_id: rule.vendor_id,
      set_vendor_name: rule.set_vendor_name,
      set_expense_category: category,
      auto_status: 'pending',
      evidence_transaction_ids: evidence.slice(0, 20).map((payment) => payment.id),
      evidence: {
        source: 'checked',
        kind: 'add_category',
        target_rule_id: rule.id,
        target_rule_name: rule.name,
        transaction_count: evidence.length,
        details_samples: [...new Set(evidence.map((payment) => payment.details))].slice(0, 3),
      },
    })
  }

  if (!inserts.length) {
    return { reviewed: payments.length, created: 0 }
  }

  const { error: insertError } = await (supabase as any).from('receipt_rule_suggestions').insert(inserts)
  if (insertError) {
    throw new Error(`Failed to create receipt rule suggestions: ${insertError.message}`)
  }

  return { reviewed: payments.length, created: inserts.length }
}

export type SuggestionCheck = {
  /** Payments the keyword matches today. */
  matchCount: number
  /** Of those, how many belong to a different vendor. Above zero, it cannot be approved. */
  collisions: number
}

/**
 * Runs each suggestion's keyword over every payment, with the matcher in use. One read of the
 * payments covers all the suggestions given.
 */
export async function checkSuggestionsAgainstPayments(
  supabase: AdminClient,
  suggestions: ReadonlyArray<Pick<ReceiptRuleSuggestion, 'id' | 'match_description' | 'set_vendor_id'>>
): Promise<Map<string, SuggestionCheck>> {
  const checks = new Map<string, SuggestionCheck>()
  if (!suggestions.length) return checks

  const [payments, settings] = await Promise.all([loadAllPayments(supabase), loadReceiptSettings(supabase)])
  const proposalPayments = payments.map(toProposalPayment)
  const matcher: RuleMatcherMode = settings.matcher

  for (const suggestion of suggestions) {
    if (!suggestion.match_description) {
      checks.set(suggestion.id, { matchCount: 0, collisions: 0 })
      continue
    }
    checks.set(
      suggestion.id,
      countKeywordMatches(suggestion.match_description, suggestion.set_vendor_id ?? null, proposalPayments, matcher)
    )
  }
  return checks
}
