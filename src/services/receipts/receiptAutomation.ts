/**
 * The receipt rule engine: applies the saved rules to payments.
 *
 * It has no auth of its own. It is called by the import, by rule changes and by the refresh of
 * pending payments, each of which has already checked the user. A run over history goes through
 * `receiptRuleRuns.ts`, which previews first and records what it changes.
 *
 * What the rules would do is worked out by `@/lib/receipts/rule-evaluation`, the same code the
 * preview uses. What may be written is fixed by `@/lib/receipts/field-protection`:
 *  - a vendor or category only where nothing has decided it, or where a rule or the AI set it;
 *  - a status only on a pending payment that no person reopened;
 *  - nothing on a payment dated on or before the lock date;
 *  - nothing at all on a payment that changed between the read and the write.
 * Each change is written by `apply_receipt_rule_change`, together with its history rows, in one
 * transaction: a change without history cannot exist.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import {
  evaluatePaymentAgainstRules,
  paymentDirection,
  type RuleChangePlan,
} from '@/lib/receipts/rule-evaluation'
import type { RuleMatcherMode } from '@/lib/receipts/rule-matching'
import { logger } from '@/lib/logger'
import type { ReceiptExpenseCategory, ReceiptRule, ReceiptTransaction } from '@/types/database'

import type { AdminClient, AutomationResult } from './types'
import { recordReceiptClassificationSignals } from './receiptGovernance'
import { loadReceiptSettings } from './receiptSettings'
import { resolveReceiptVendor } from './receiptVendors'

export type AutomationOptions = {
  /** Also classify payments that are no longer pending. Their status is never changed. */
  includeClosed?: boolean
  /** Write only the fields this rule wins. Every active rule still decides who wins. */
  targetRuleId?: string | null
  /** Work out what would change and write nothing. */
  dryRun?: boolean
  /** The user who started this run, recorded on every log row it writes. */
  performedBy?: string | null
}

const READ_CHUNK_SIZE = 100

function emptyResult(): AutomationResult {
  return {
    statusAutoUpdated: 0,
    classificationUpdated: 0,
    matched: 0,
    vendorIntended: 0,
    expenseIntended: 0,
    protectedCount: 0,
    conflicts: 0,
    failed: 0,
    locked: 0,
    samples: [],
  }
}

function toSample(transaction: ReceiptTransaction): AutomationResult['samples'][number] {
  return {
    id: transaction.id,
    status: transaction.status,
    direction: paymentDirection(transaction),
    details: transaction.details,
    transaction_type: transaction.transaction_type,
    amount_in: transaction.amount_in,
    amount_out: transaction.amount_out,
    vendor_name: transaction.vendor_name,
    vendor_source: transaction.vendor_source,
    expense_category: transaction.expense_category,
    expense_source: transaction.expense_category_source,
  }
}

export type RulesForEvaluation = {
  rules: ReceiptRule[]
  /** Rules whose vendor could not be tied to the vendor list. Their vendor is not written. */
  unresolvedVendorRuleIds: Set<string>
  /** The newest `updated_at` among the active rules, and how many there are: the version of the set. */
  rulesetUpdatedAt: string | null
  rulesetCount: number
  lockDate: string | null
  matcher: RuleMatcherMode
}

/**
 * The active rules in the order the matcher expects, the lock date and the matcher setting.
 * A rule that names its vendor in text only is tied to the vendor list here, so the payment gets
 * the vendor's own id and name and not the rule's spelling of it. A dry run looks the vendor up
 * and creates nothing.
 *
 * Throws when the rules or the settings cannot be read: a failed load is a failure, and used to
 * be reported as "0 matched".
 */
export async function loadRulesForEvaluation(
  supabase: AdminClient,
  options: { createVendors: boolean }
): Promise<RulesForEvaluation> {
  const { data, error } = await supabase
    .from('receipt_rules')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[receipts] could not load rules', error)
    throw new Error('Failed to load receipt rules')
  }

  const rules = ((data ?? []) as ReceiptRule[]).filter((rule) => rule.is_active)
  const settings = await loadReceiptSettings(supabase)

  // The version of the rule set is taken before any name is tied to the vendor list, so it is
  // exactly what the database holds.
  const rulesetUpdatedAt = rules.reduce<string | null>((latest, rule) => {
    if (!rule.updated_at) return latest
    if (!latest || new Date(rule.updated_at).getTime() > new Date(latest).getTime()) return rule.updated_at
    return latest
  }, null)

  const unresolvedVendorRuleIds = new Set<string>()
  for (const rule of rules) {
    if (!rule.set_vendor_name || rule.vendor_id) continue
    try {
      const vendor = await resolveReceiptVendor(
        supabase,
        { name: rule.set_vendor_name },
        { create: options.createVendors, origin: 'rule' }
      )
      if (vendor) {
        rule.vendor_id = vendor.id
        rule.set_vendor_name = vendor.canonicalName
      }
    } catch (vendorError) {
      console.error('[receipts] could not resolve a rule vendor', { ruleId: rule.id, error: vendorError })
      unresolvedVendorRuleIds.add(rule.id)
    }
  }

  return {
    rules,
    unresolvedVendorRuleIds,
    rulesetUpdatedAt,
    rulesetCount: rules.length,
    lockDate: settings.lockDate,
    matcher: settings.matcher,
  }
}

type SignalInput = Parameters<typeof recordReceiptClassificationSignals>[1][number]

/** The trace rows for a change that has been written. */
export function signalsForRuleChange(
  transaction: ReceiptTransaction,
  plan: RuleChangePlan,
  rules: { status: ReceiptRule | null; vendor: ReceiptRule | null; expense: ReceiptRule | null },
  performedBy: string | null,
  now: string
): SignalInput[] {
  const signals: SignalInput[] = []
  const newStatus = plan.statusChanged ? (plan.after.status as ReceiptTransaction['status']) : transaction.status

  if (plan.statusChanged && rules.status) {
    signals.push({
      transaction_id: transaction.id,
      source: 'rule',
      signal_type: 'rule_auto_mark',
      prior_vendor_id: transaction.vendor_id ?? null,
      new_vendor_id: transaction.vendor_id ?? null,
      prior_vendor_name: transaction.vendor_name,
      new_vendor_name: transaction.vendor_name,
      prior_expense_category: transaction.expense_category,
      new_expense_category: transaction.expense_category,
      prior_status: transaction.status,
      new_status: newStatus,
      rule_id: rules.status.id,
      ai_confidence: null,
      performed_by: performedBy,
      performed_at: now,
      payload: { rule_name: rules.status.name },
    })
  }

  if (plan.vendorChanged || plan.expenseChanged) {
    const rule = (plan.vendorChanged ? rules.vendor : null) ?? rules.expense
    signals.push({
      transaction_id: transaction.id,
      source: 'rule',
      signal_type: 'rule_classification',
      prior_vendor_id: transaction.vendor_id ?? null,
      new_vendor_id: plan.vendorChanged ? ((plan.after.vendor_id as string | null) ?? null) : transaction.vendor_id ?? null,
      prior_vendor_name: transaction.vendor_name,
      new_vendor_name: plan.vendorChanged ? ((plan.after.vendor_name as string | null) ?? null) : transaction.vendor_name,
      prior_expense_category: transaction.expense_category,
      new_expense_category: plan.expenseChanged
        ? ((plan.after.expense_category as ReceiptExpenseCategory | null) ?? null)
        : transaction.expense_category,
      prior_status: transaction.status,
      new_status: newStatus,
      rule_id: rule?.id ?? null,
      ai_confidence: null,
      performed_by: performedBy,
      performed_at: now,
      payload: {
        note: plan.classificationNotes.join(' | '),
        rule_name: rule?.name ?? null,
        vendor_rule_id: plan.vendorChanged ? rules.vendor?.id ?? null : null,
        expense_rule_id: plan.expenseChanged ? rules.expense?.id ?? null : null,
        prior_vendor_source: transaction.vendor_source,
        prior_expense_category_source: transaction.expense_category_source,
      },
    })
  }

  return signals
}

export async function applyAutomationRules(
  transactionIds: string[],
  options: AutomationOptions = {}
): Promise<AutomationResult> {
  if (!transactionIds.length) {
    return emptyResult()
  }

  const { includeClosed = false, targetRuleId = null, dryRun = false, performedBy = null } = options
  const supabase = createAdminClient()

  const loaded = await loadRulesForEvaluation(supabase, { createVendors: !dryRun })
  if (!loaded.rules.length) {
    return emptyResult()
  }
  if (targetRuleId && !loaded.rules.some((rule) => rule.id === targetRuleId)) {
    return emptyResult()
  }

  const idChunks: string[][] = []
  for (let index = 0; index < transactionIds.length; index += READ_CHUNK_SIZE) {
    idChunks.push(transactionIds.slice(index, index + READ_CHUNK_SIZE))
  }

  const chunkResults = await Promise.all(
    idChunks.map(async (chunk) => {
      const { data, error } = await supabase.from('receipt_transactions').select('*').in('id', chunk)
      return { data: (data ?? []) as ReceiptTransaction[], error }
    })
  )

  const chunkError = chunkResults.find((result) => result.error)?.error
  if (chunkError) {
    console.error('[receipts] applyAutomationRules could not load transactions', chunkError)
    throw new Error('Failed to load receipt transactions')
  }

  const transactions = chunkResults.flatMap((result) => result.data)
  if (!transactions.length) {
    return emptyResult()
  }

  const result = emptyResult()
  const signals: SignalInput[] = []
  const now = new Date().toISOString()
  const inspected: ReceiptTransaction[] = []

  for (const transaction of transactions) {
    const evaluation = evaluatePaymentAgainstRules(transaction, loaded.rules, {
      includeClosed,
      targetRuleId,
      lockDate: loaded.lockDate,
      matcher: loaded.matcher,
      unresolvedVendorRuleIds: loaded.unresolvedVendorRuleIds,
      now,
    })

    if (!evaluation.inScope) continue
    inspected.push(transaction)
    if (!evaluation.matched) continue

    result.matched += 1
    if (evaluation.protectedByOwner) result.protectedCount += 1
    if (evaluation.vendorUnresolved) result.failed += 1
    if (evaluation.locked) {
      result.locked += 1
      continue
    }

    const plan = evaluation.plan
    if (!plan) continue

    if (plan.vendorChanged) result.vendorIntended += 1
    if (plan.expenseChanged) result.expenseIntended += 1

    if (dryRun) {
      if (plan.statusChanged) result.statusAutoUpdated += 1
      if (plan.vendorChanged || plan.expenseChanged) result.classificationUpdated += 1
      continue
    }

    // Written only if the payment is still as it was read. Someone editing it in between wins.
    const { data: outcome, error } = await (supabase as any).rpc('apply_receipt_rule_change', {
      p_transaction_id: plan.transactionId,
      p_expected_updated_at: plan.expectedUpdatedAt,
      p_after: plan.after,
      p_logs: plan.logs,
      p_performed_by: performedBy,
    })

    if (error) {
      console.error('[receipts] applyAutomationRules failed to persist a change', {
        transactionId: transaction.id,
        error,
      })
      result.failed += 1
      continue
    }

    if (outcome === 'locked') {
      result.locked += 1
      continue
    }
    if (outcome !== 'applied') {
      result.conflicts += 1
      continue
    }

    if (plan.statusChanged) result.statusAutoUpdated += 1
    if (plan.vendorChanged || plan.expenseChanged) result.classificationUpdated += 1
    signals.push(...signalsForRuleChange(transaction, plan, evaluation.winners, performedBy, now))
  }

  await recordReceiptClassificationSignals(supabase, signals)

  if (targetRuleId) {
    logger.debug('[receipts] applyAutomationRules summary', {
      metadata: {
        targetRuleId,
        includeClosed,
        dryRun,
        totalTransactions: transactions.length,
        matched: result.matched,
        statusAutoUpdated: result.statusAutoUpdated,
        classificationUpdated: result.classificationUpdated,
        protectedCount: result.protectedCount,
        conflicts: result.conflicts,
        failed: result.failed,
        locked: result.locked,
      },
    })
  }

  result.samples = inspected.slice(0, 50).map(toSample)
  return result
}

/**
 * Re-runs every active rule over every pending payment, in id order, so a rule that has just
 * been approved or switched on reaches all of them and not an arbitrary first few hundred.
 */
export async function refreshAutomationForPendingTransactions(
  options: { performedBy?: string | null } = {}
): Promise<AutomationResult> {
  const supabase = createAdminClient()
  const rows = await fetchAllRows<{ id: string }>(
    (from, to) =>
      supabase
        .from('receipt_transactions')
        .select('id')
        .eq('status', 'pending')
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'pending transactions for rule refresh' }
  )

  const ids = rows.map((row) => row.id)
  if (!ids.length) return emptyResult()
  return applyAutomationRules(ids, { performedBy: options.performedBy ?? null })
}
