/**
 * The receipt rule engine: applies the saved rules to payments.
 *
 * It has no auth of its own. It is called by the import, by rule changes and by the run over
 * history, each of which has already checked the user.
 *
 * What it may write is fixed by `@/lib/receipts/field-protection`:
 *  - a vendor or category only where nothing has decided it, or where a rule or the AI set it;
 *  - a status only on a pending payment that no person reopened;
 *  - nothing at all on a payment that changed between the read and the write.
 * A run over history therefore classifies closed payments and never moves them.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { selectBestReceiptRule } from '@/lib/receipts/rule-matching'
import { canAutomationChangeStatus, canRuleWriteField } from '@/lib/receipts/field-protection'
import { logger } from '@/lib/logger'
import type {
  ReceiptExpenseCategory,
  ReceiptRule,
  ReceiptTransaction,
  ReceiptTransactionLog,
} from '@/types/database'

import type { AutomationResult } from './types'
import { getTransactionDirection, guessAmountValue } from './receiptHelpers'
import { recordReceiptClassificationSignals } from './receiptGovernance'
import { resolveReceiptVendor } from './receiptVendors'

export type AutomationOptions = {
  /** Also classify payments that are no longer pending. Their status is never changed. */
  includeClosed?: boolean
  /** Run this one rule instead of every active rule. */
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
    samples: [],
  }
}

function toSample(transaction: ReceiptTransaction): AutomationResult['samples'][number] {
  return {
    id: transaction.id,
    status: transaction.status,
    direction: getTransactionDirection(transaction),
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

export async function applyAutomationRules(
  transactionIds: string[],
  options: AutomationOptions = {}
): Promise<AutomationResult> {
  if (!transactionIds.length) {
    return emptyResult()
  }

  const { includeClosed = false, targetRuleId = null, dryRun = false, performedBy = null } = options
  const supabase = createAdminClient()

  let rulesQuery = supabase
    .from('receipt_rules')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })

  if (targetRuleId) {
    rulesQuery = rulesQuery.eq('id', targetRuleId)
  }

  const { data: rules, error: rulesError } = await rulesQuery

  // A failed load used to be reported as "0 auto-matched". It is a failure, and the caller says so.
  if (rulesError) {
    console.error('[receipts] applyAutomationRules could not load rules', rulesError)
    throw new Error('Failed to load receipt rules')
  }

  const activeRules = ((rules ?? []) as ReceiptRule[]).filter((rule) => rule.is_active)
  if (!activeRules.length) {
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
  const logs: Array<Omit<ReceiptTransactionLog, 'id'>> = []
  const signals: Array<Parameters<typeof recordReceiptClassificationSignals>[1][number]> = []
  const now = new Date().toISOString()
  const inspected: ReceiptTransaction[] = []
  const resolvedNameOnlyRules = new Set<string>()

  for (const transaction of transactions) {
    const isPending = transaction.status === 'pending'
    if (!includeClosed && !isPending) continue

    const direction = getTransactionDirection(transaction)
    const amountValue = guessAmountValue(transaction)
    inspected.push(transaction)

    const matchingRule = selectBestReceiptRule(
      activeRules,
      { details: transaction.details, transaction_type: transaction.transaction_type },
      { direction, amountValue }
    )

    if (!matchingRule) continue

    result.matched += 1

    // A rule that names its vendor in text only is tied to the vendor list, once per run, so the
    // payment gets the vendor's own id and name and not the rule's spelling of it. A dry run
    // looks the vendor up and creates nothing.
    if (matchingRule.set_vendor_name && !matchingRule.vendor_id && !resolvedNameOnlyRules.has(matchingRule.id)) {
      try {
        const vendor = await resolveReceiptVendor(
          supabase,
          { name: matchingRule.set_vendor_name },
          { create: !dryRun, origin: 'rule' }
        )
        if (vendor) {
          matchingRule.vendor_id = vendor.id
          matchingRule.set_vendor_name = vendor.canonicalName
        }
        resolvedNameOnlyRules.add(matchingRule.id)
      } catch (vendorError) {
        console.error('[receipts] applyAutomationRules could not resolve a rule vendor', {
          ruleId: matchingRule.id,
          error: vendorError,
        })
        result.failed += 1
        continue
      }
    }

    const setsVendor = Boolean(matchingRule.set_vendor_name)
    const setsExpense = Boolean(matchingRule.set_expense_category) && direction === 'out'
    const vendorValueDiffers = setsVendor && transaction.vendor_name !== matchingRule.set_vendor_name
    const expenseValueDiffers = setsExpense && transaction.expense_category !== matchingRule.set_expense_category
    // Same value, but not yet recorded as this rule's: the rule takes it over from the AI or an older rule.
    const vendorOwnerDiffers =
      setsVendor && (transaction.vendor_source !== 'rule' || transaction.vendor_rule_id !== matchingRule.id)
    const expenseOwnerDiffers =
      setsExpense &&
      (transaction.expense_category_source !== 'rule' || transaction.expense_rule_id !== matchingRule.id)

    const targetStatus = matchingRule.auto_status
    const wantsStatus = isPending && targetStatus !== transaction.status

    const vendorWritable = canRuleWriteField(transaction.vendor_source)
    const expenseWritable = canRuleWriteField(transaction.expense_category_source)
    const shouldUpdateVendor = (vendorValueDiffers || vendorOwnerDiffers) && vendorWritable
    const shouldUpdateExpense = (expenseValueDiffers || expenseOwnerDiffers) && expenseWritable
    const statusChanged = wantsStatus && canAutomationChangeStatus(transaction)

    // A different value the rule would have set was decided by a person, the import or invoice pairing.
    if (
      (vendorValueDiffers && !vendorWritable) ||
      (expenseValueDiffers && !expenseWritable) ||
      (wantsStatus && !statusChanged)
    ) {
      result.protectedCount += 1
    }

    if (!shouldUpdateVendor && !shouldUpdateExpense && !statusChanged) {
      continue
    }

    const updatePayload: Record<string, unknown> = {}
    const classificationNotes: string[] = []

    if (statusChanged) {
      updatePayload.status = targetStatus
      updatePayload.receipt_required = targetStatus === 'pending'
      updatePayload.marked_by = null
      updatePayload.marked_by_email = null
      updatePayload.marked_by_name = null
      updatePayload.marked_at = now
      updatePayload.marked_method = 'rule'
      if (targetStatus === 'auto_completed') {
        updatePayload.auto_completed_reason = `trusted_rule:${matchingRule.id}`
      }
    }

    if (shouldUpdateVendor) {
      result.vendorIntended += 1
      classificationNotes.push(`Vendor → ${matchingRule.set_vendor_name}`)
      if (!dryRun) {
        updatePayload.vendor_name = matchingRule.set_vendor_name
        updatePayload.vendor_id = matchingRule.vendor_id ?? null
        updatePayload.vendor_source = 'rule'
        updatePayload.vendor_rule_id = matchingRule.id
        updatePayload.vendor_updated_at = now
      }
    }

    if (shouldUpdateExpense) {
      result.expenseIntended += 1
      classificationNotes.push(`Expense → ${matchingRule.set_expense_category}`)
      updatePayload.expense_category = matchingRule.set_expense_category
      updatePayload.expense_category_source = 'rule'
      updatePayload.expense_rule_id = matchingRule.id
      updatePayload.expense_updated_at = now
    }

    if (dryRun) {
      if (statusChanged) result.statusAutoUpdated += 1
      if (classificationNotes.length) result.classificationUpdated += 1
      continue
    }

    // The rule that last acted on a pending payment. A closed payment keeps whatever it had:
    // its vendor_rule_id and expense_rule_id already say which rule classified it.
    if (isPending) {
      updatePayload.rule_applied_id = matchingRule.id
    }
    updatePayload.updated_at = now

    // Write only if the payment is still as it was read. Someone editing it in between wins.
    const { data: updatedTransaction, error } = await supabase
      .from('receipt_transactions')
      .update(updatePayload)
      .eq('id', transaction.id)
      .eq('updated_at', transaction.updated_at)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[receipts] applyAutomationRules failed to persist transaction update', {
        transactionId: transaction.id,
        ruleId: matchingRule.id,
        error,
      })
      result.failed += 1
      continue
    }

    if (!updatedTransaction) {
      result.conflicts += 1
      continue
    }

    const newStatus = statusChanged ? targetStatus : transaction.status

    if (statusChanged) {
      result.statusAutoUpdated += 1
      logs.push({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: targetStatus,
        action_type: 'rule_auto_mark',
        note: `Auto-marked by rule: ${matchingRule.name}`,
        performed_by: performedBy,
        rule_id: matchingRule.id,
        performed_at: now,
      })
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
        new_status: targetStatus,
        rule_id: matchingRule.id,
        ai_confidence: null,
        performed_by: performedBy,
        performed_at: now,
        payload: { rule_name: matchingRule.name },
      })
    }

    if (classificationNotes.length) {
      result.classificationUpdated += 1
      logs.push({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: newStatus,
        action_type: 'rule_classification',
        note: `Classification updated by rule ${matchingRule.name}: ${classificationNotes.join(' | ')}`,
        performed_by: performedBy,
        rule_id: matchingRule.id,
        performed_at: now,
      })
      signals.push({
        transaction_id: transaction.id,
        source: 'rule',
        signal_type: 'rule_classification',
        prior_vendor_id: transaction.vendor_id ?? null,
        new_vendor_id: (updatePayload.vendor_id as string | null | undefined) ?? transaction.vendor_id ?? null,
        prior_vendor_name: transaction.vendor_name,
        new_vendor_name: (updatePayload.vendor_name as string | null | undefined) ?? transaction.vendor_name,
        prior_expense_category: transaction.expense_category,
        new_expense_category:
          (updatePayload.expense_category as ReceiptExpenseCategory | null | undefined) ?? transaction.expense_category,
        prior_status: transaction.status,
        new_status: newStatus,
        rule_id: matchingRule.id,
        ai_confidence: null,
        performed_by: performedBy,
        performed_at: now,
        payload: {
          note: classificationNotes.join(' | '),
          rule_name: matchingRule.name,
          prior_vendor_source: transaction.vendor_source,
          prior_expense_category_source: transaction.expense_category_source,
        },
      })
    }
  }

  if (logs.length) {
    const { error: logError } = await supabase.from('receipt_transaction_logs').insert(logs)
    if (logError) {
      console.error('Failed to record automation classification logs', logError)
    }
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
