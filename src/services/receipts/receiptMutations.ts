/**
 * Receipt mutation operations (INSERT / UPDATE / DELETE).
 *
 * IMPORTANT: Every function that writes data via the admin client accepts
 * a `userId` parameter (or equivalent auth context). The caller (server
 * action layer) MUST verify authentication and permissions before invoking
 * these functions.
 *
 * @requires Caller must verify user auth and permissions before calling
 * any function in this module.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { selectBestReceiptRule } from '@/lib/receipts/rule-matching'
import { logger } from '@/lib/logger'
import { receiptRuleSchema, receiptMarkSchema } from '@/lib/validation'
import { jobQueue } from '@/lib/unified-job-queue'
import { createHash } from 'crypto'
import type {
  ReceiptRule,
  ReceiptTransaction,
  ReceiptTransactionLog,
  ReceiptExpenseCategory,
  ReceiptClassificationSource,
} from '@/types/database'

import type {
  AutomationResult,
  ParsedTransactionRow,
  RuleMutationResult,
  BulkStatus,
} from './types'
import {
  RECEIPT_BUCKET,
  RECEIPT_AI_JOB_CHUNK_SIZE,
  RETRO_CHUNK_SIZE,
} from './types'
import {
  parseCsv,
  normalizeVendorInput,
  coerceExpenseCategory,
  hashDetails,
  chunkArray,
  getTransactionDirection,
  guessAmountValue,
  isIncomingOnlyTransaction,
  buildRuleSuggestion,
  composeReceiptFileArtifacts,
  fileSchema,
  receiptFileSchema,
  classificationUpdateSchema,
  bulkGroupApplySchema,
  groupRuleInputSchema,
  toOptionalNumber,
  BULK_STATUS_OPTIONS,
} from './receiptHelpers'

// ---------------------------------------------------------------------------
// applyAutomationRules — internal rule engine (no direct auth needed; called
// by import and retro-run which already check auth)
// ---------------------------------------------------------------------------

export async function applyAutomationRules(
  transactionIds: string[],
  options: {
    includeClosed?: boolean
    targetRuleId?: string | null
    overrideManual?: boolean
    allowClosedStatusUpdates?: boolean
  } = {}
): Promise<AutomationResult> {
  logger.debug('[retro] applyAutomationRules start', {
    metadata: { transactionCount: transactionIds.length, ...options },
  })

  if (!transactionIds.length) {
    console.warn('[retro] applyAutomationRules called with empty transactionIds', options)
    return {
      statusAutoUpdated: 0,
      classificationUpdated: 0,
      matched: 0,
      vendorIntended: 0,
      expenseIntended: 0,
      samples: [],
    }
  }

  const supabase = createAdminClient()

  const {
    includeClosed = false,
    targetRuleId = null,
    overrideManual = false,
    allowClosedStatusUpdates = false,
  } = options

  let rulesQuery = supabase
    .from('receipt_rules')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (targetRuleId) {
    rulesQuery = rulesQuery.eq('id', targetRuleId)
  }

  const { data: rules, error: rulesError } = await rulesQuery

  const chunkSize = 100
  const idChunks: string[][] = []
  for (let index = 0; index < transactionIds.length; index += chunkSize) {
    idChunks.push(transactionIds.slice(index, index + chunkSize))
  }

  const chunkResults = await Promise.all(
    idChunks.map(async (chunk, chunkIndex) => {
      const { data, error } = await supabase
        .from('receipt_transactions')
        .select('*')
        .in('id', chunk)
      if (error) {
        console.error('[retro] applyAutomationRules chunk error', {
          chunkIndex,
          chunkSize: chunk.length,
          error,
        })
      }
      return { data: data ?? [], error, chunkIndex }
    })
  )

  const transactions = chunkResults.flatMap((result) => result.data)

  if (rulesError) {
    console.error('[retro] applyAutomationRules rules query error', rulesError)
  }

  if (!rules?.length) {
    console.warn('[retro] applyAutomationRules no active rules found', {
      targetRuleId,
      includeClosed,
    })
  }

  if (!transactions?.length) {
    console.warn('[retro] applyAutomationRules no transactions fetched', {
      transactionIdsLength: transactionIds.length,
      sampleIds: transactionIds.slice(0, 20),
    })
  }

  if (!rules?.length || !transactions?.length) {
    return {
      statusAutoUpdated: 0,
      classificationUpdated: 0,
      matched: 0,
      vendorIntended: 0,
      expenseIntended: 0,
      samples: [],
    }
  }

  const ruleList = targetRuleId ? rules.filter((rule) => rule.id === targetRuleId) : rules
  if (!ruleList.length) {
    console.warn('[retro] applyAutomationRules ruleList empty after filtering', {
      targetRuleId,
      availableRules: rules.map((rule) => rule.id),
    })
    return {
      statusAutoUpdated: 0,
      classificationUpdated: 0,
      matched: 0,
      vendorIntended: 0,
      expenseIntended: 0,
      samples: [],
    }
  }

  const activeRules = ruleList.filter((rule) => rule.is_active)

  let statusAutoUpdated = 0
  let classificationUpdated = 0
  let matchedCount = 0
  let vendorIntended = 0
  let expenseIntended = 0
  const classificationLogs: Array<Omit<ReceiptTransactionLog, 'id'>> = []
  const now = new Date().toISOString()
  const inspectedTransactions: ReceiptTransaction[] = []
  const unmatchedSamples: Array<AutomationResult['samples'][number]> = []

  for (const transaction of transactions) {
    const isPending = transaction.status === 'pending'
    if (!includeClosed && !isPending) continue

    const direction = getTransactionDirection(transaction)
    const amountValue = guessAmountValue(transaction)
    inspectedTransactions.push(transaction)

    const matchingRule = selectBestReceiptRule(
      activeRules,
      {
        details: transaction.details,
        transaction_type: transaction.transaction_type,
      },
      { direction, amountValue }
    )

    if (!matchingRule) {
      if (unmatchedSamples.length < 20) {
        unmatchedSamples.push({
          id: transaction.id,
          status: transaction.status,
          direction,
          details: transaction.details,
          transaction_type: transaction.transaction_type,
          amount_in: transaction.amount_in,
          amount_out: transaction.amount_out,
          vendor_name: transaction.vendor_name,
          vendor_source: transaction.vendor_source,
          expense_category: transaction.expense_category,
          expense_source: transaction.expense_category_source,
        })
      }
      continue
    }

    matchedCount += 1

    const vendorLocked = !overrideManual && transaction.vendor_source === 'manual'
    const expenseLocked = !overrideManual && transaction.expense_category_source === 'manual'

    const shouldUpdateVendor = Boolean(
      matchingRule.set_vendor_name &&
        !vendorLocked &&
        (
          transaction.vendor_name !== matchingRule.set_vendor_name ||
          transaction.vendor_source !== 'rule' ||
          transaction.vendor_rule_id !== matchingRule.id
        )
    )

    const shouldUpdateExpense = Boolean(
      matchingRule.set_expense_category &&
        direction === 'out' &&
        !expenseLocked &&
        (
          transaction.expense_category !== matchingRule.set_expense_category ||
          transaction.expense_category_source !== 'rule' ||
          transaction.expense_rule_id !== matchingRule.id
        )
    )

    const updatePayload: Record<string, unknown> = {}
    const classificationNotes: string[] = []
    const targetStatus = matchingRule.auto_status
    const allowStatusUpdates = isPending || allowClosedStatusUpdates
    const statusChanged = allowStatusUpdates && targetStatus !== transaction.status

    if (allowStatusUpdates) {
      if (statusChanged) {
        updatePayload.status = targetStatus
        updatePayload.receipt_required = targetStatus === 'pending'
        updatePayload.marked_by = null
        updatePayload.marked_by_email = null
        updatePayload.marked_by_name = null
        updatePayload.marked_at = now
        updatePayload.marked_method = 'rule'
        updatePayload.rule_applied_id = matchingRule.id
      } else if (targetStatus !== 'pending') {
        updatePayload.receipt_required = false
        updatePayload.marked_by = null
        updatePayload.marked_by_email = null
        updatePayload.marked_by_name = null
        updatePayload.marked_at = now
        updatePayload.marked_method = 'rule'
        updatePayload.rule_applied_id = matchingRule.id
      }
    }

    if (shouldUpdateVendor) {
      vendorIntended += 1
      updatePayload.vendor_name = matchingRule.set_vendor_name
      updatePayload.vendor_source = 'rule'
      updatePayload.vendor_rule_id = matchingRule.id
      updatePayload.vendor_updated_at = now
      classificationNotes.push(`Vendor → ${matchingRule.set_vendor_name}`)
    }

    if (shouldUpdateExpense) {
      expenseIntended += 1
      updatePayload.expense_category = matchingRule.set_expense_category
      updatePayload.expense_category_source = 'rule'
      updatePayload.expense_rule_id = matchingRule.id
      updatePayload.expense_updated_at = now
      classificationNotes.push(`Expense → ${matchingRule.set_expense_category}`)
    }

    // Ensure rule_applied_id is always set when the rule causes any change,
    // even if the status doesn't change (e.g. auto_status='pending' classification-only rules)
    if ((shouldUpdateVendor || shouldUpdateExpense) && !('rule_applied_id' in updatePayload)) {
      updatePayload.rule_applied_id = matchingRule.id
    }

    if (!Object.keys(updatePayload).length && classificationNotes.length === 0) {
      continue
    }

    updatePayload.updated_at = now

    const { data: updatedTransaction, error } = await supabase
      .from('receipt_transactions')
      .update(updatePayload)
      .eq('id', transaction.id)
      .select('id')
      .maybeSingle()

    if (error) {
      console.warn('[receipts] applyAutomationRules failed to persist transaction update', {
        transactionId: transaction.id,
        ruleId: matchingRule.id,
        error,
      })
      continue
    }

    if (!updatedTransaction) {
      console.warn('[receipts] applyAutomationRules update affected no transaction rows', {
        transactionId: transaction.id,
        ruleId: matchingRule.id,
      })
      continue
    }

    if (statusChanged) {
      statusAutoUpdated += 1
      classificationLogs.push({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: targetStatus,
        action_type: 'rule_auto_mark',
        note: `Auto-marked by rule: ${matchingRule.name}`,
        performed_by: null,
        rule_id: matchingRule.id,
        performed_at: now,
      })
    }

    if (classificationNotes.length) {
      classificationLogs.push({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: statusChanged ? targetStatus : transaction.status,
        action_type: 'rule_classification',
        note: `Classification updated by rule ${matchingRule.name}: ${classificationNotes.join(' | ')}`,
        performed_by: null,
        rule_id: matchingRule.id,
        performed_at: now,
      })
      classificationUpdated += 1
    }
  }

  if (classificationLogs.length) {
    const { error: classificationLogError } = await supabase.from('receipt_transaction_logs').insert(classificationLogs)
    if (classificationLogError) {
      console.error('Failed to record automation classification logs', classificationLogError)
    }
  }

  if (targetRuleId) {
    const summary = {
      targetRuleId,
      includeClosed,
      overrideManual,
      allowClosedStatusUpdates,
      totalTransactions: transactions.length,
      matchedCount,
      statusAutoUpdated,
      classificationUpdated,
      vendorIntended,
      expenseIntended,
    }
    logger.debug('[receipts] applyAutomationRules summary', { metadata: summary })

    if (matchedCount === 0) {
      console.warn('[receipts] applyAutomationRules sample transactions', unmatchedSamples.slice(0, 10))
    }
  }

  return {
    statusAutoUpdated,
    classificationUpdated,
    matched: matchedCount,
    vendorIntended,
    expenseIntended,
    samples: inspectedTransactions.slice(0, 50).map((tx) => ({
      id: tx.id,
      status: tx.status,
      direction: getTransactionDirection(tx),
      details: tx.details,
      transaction_type: tx.transaction_type,
      amount_in: tx.amount_in,
      amount_out: tx.amount_out,
      vendor_name: tx.vendor_name,
      vendor_source: tx.vendor_source,
      expense_category: tx.expense_category,
      expense_source: tx.expense_category_source,
    })),
  }
}

// ---------------------------------------------------------------------------
// enqueueReceiptAiClassificationJobs
// ---------------------------------------------------------------------------

export async function enqueueReceiptAiClassificationJobs(transactionIds: string[], batchId: string): Promise<{ queued: number; failed: number }> {
  if (!transactionIds.length) {
    return { queued: 0, failed: 0 }
  }

  const chunks = chunkArray(transactionIds, RECEIPT_AI_JOB_CHUNK_SIZE)
  const results = await Promise.all(
    chunks.map((chunk) =>
      jobQueue.enqueue('classify_receipt_transactions', {
        transactionIds: chunk,
        batchId,
      })
    )
  )

  const failed = results.filter((result) => !result.success).length

  if (failed > 0) {
    console.error('Failed to enqueue receipt AI classification jobs', {
      failed,
      total: results.length,
      batchId,
    })
  }

  return { queued: results.length - failed, failed }
}

// ---------------------------------------------------------------------------
// refreshAutomationForPendingTransactions
// ---------------------------------------------------------------------------

export async function refreshAutomationForPendingTransactions(): Promise<void> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('receipt_transactions')
    .select('id')
    .eq('status', 'pending')
    .limit(500)

  const ids = data?.map((row) => row.id) ?? []
  if (!ids.length) return
  await applyAutomationRules(ids)
}

// ---------------------------------------------------------------------------
// importReceiptStatement
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performImportReceiptStatement(
  userId: string,
  userEmail: string,
  receiptFile: File,
  buffer: Buffer
): Promise<{
  success?: boolean
  error?: string
  inserted?: number
  skipped?: number
  autoApplied?: number
  autoClassified?: number
  batch?: any
  warning?: string
}> {
  const rows = parseCsv(buffer)

  if (!rows.length) {
    return { error: 'No valid transactions found in the CSV file.' }
  }

  const supabase = createAdminClient()

  const { data: batch, error: batchError } = await supabase
    .from('receipt_batches')
    .insert({
      original_filename: receiptFile.name,
      source_hash: createHash('sha256').update(buffer).digest('hex'),
      row_count: rows.length,
      uploaded_by: userId,
    })
    .select('*')
    .single()

  if (batchError || !batch) {
    console.error('Failed to record receipt batch:', batchError)
    return { error: 'Failed to record the upload. Please try again.' }
  }

  const now = new Date().toISOString()

  const payload = rows.map((row) => ({
    batch_id: batch.id,
    transaction_date: row.transactionDate,
    details: row.details,
    transaction_type: row.transactionType,
    amount_in: row.amountIn,
    amount_out: row.amountOut,
    balance: row.balance,
    dedupe_hash: row.dedupeHash,
    status: 'pending' satisfies ReceiptTransaction['status'],
    receipt_required: true,
    marked_by: null,
    marked_by_email: null,
    marked_by_name: null,
    marked_at: null,
    marked_method: null,
    rule_applied_id: null,
    notes: null,
    created_at: now,
    updated_at: now,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('receipt_transactions')
    .upsert(payload, {
      onConflict: 'dedupe_hash',
      ignoreDuplicates: true,
    })
    .select('id, status')

  if (insertError) {
    console.error('Failed to insert receipt transactions:', insertError)
    // Attempt to clean up the orphaned batch record
    const { error: batchDeleteError } = await supabase
      .from('receipt_batches')
      .delete()
      .eq('id', batch.id)
    if (batchDeleteError) {
      console.error('Failed to clean up orphaned receipt batch after transaction insert failure:', batchDeleteError)
    }
    return { error: 'Failed to store the transactions.' }
  }

  const insertedIds = inserted?.map((row) => row.id) ?? []

  let autoApplied = 0
  let autoClassified = 0
  let automationWarning: string | undefined

  try {
    const automationResult = await applyAutomationRules(insertedIds)
    autoApplied = automationResult.statusAutoUpdated ?? 0
    autoClassified = automationResult.classificationUpdated ?? 0
  } catch (automationError) {
    console.error('applyAutomationRules failed during import:', automationError)
    automationWarning =
      'Automation rules could not be applied — you can re-run them manually from the rules page.'
  }

  let aiJobsQueued = 0
  let aiJobsFailed = 0
  let aiEnqueueWarning: string | undefined

  try {
    const queuedResult = await enqueueReceiptAiClassificationJobs(insertedIds, batch.id)
    aiJobsQueued = queuedResult.queued
    aiJobsFailed = queuedResult.failed
  } catch (enqueueError) {
    console.error('Failed to enqueue AI classification jobs:', enqueueError)
    aiEnqueueWarning = 'AI classification could not be queued — use the re-queue button to retry.'
  }

  if (insertedIds.length) {
    const logs = insertedIds.map<Omit<ReceiptTransactionLog, 'id'>>((transactionId) => ({
      transaction_id: transactionId,
      previous_status: null,
      new_status: 'pending',
      action_type: 'import',
      note: `Imported via ${receiptFile.name}`,
      performed_by: userId,
      rule_id: null,
      performed_at: now,
    }))

    const { error: importLogError } = await supabase.from('receipt_transaction_logs').insert(logs)
    if (importLogError) {
      console.error('Failed to record import transaction logs', importLogError)
    }
  }

  return {
    success: true,
    inserted: insertedIds.length,
    skipped: rows.length - insertedIds.length,
    autoApplied,
    autoClassified,
    batch,
    warning: automationWarning ?? aiEnqueueWarning,
  }
}

// ---------------------------------------------------------------------------
// markReceiptTransaction
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performMarkReceiptTransaction(
  userId: string,
  userEmail: string,
  input: {
    transactionId: string
    status: ReceiptTransaction['status']
    note?: string
    receiptRequired?: boolean
  }
): Promise<{ success?: boolean; error?: string; transaction?: ReceiptTransaction }> {
  const validation = receiptMarkSchema.safeParse({
    transaction_id: input.transactionId,
    status: input.status,
    note: input.note,
    receipt_required: input.receiptRequired,
  })

  if (!validation.success) {
    return { error: validation.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = createAdminClient()

  const [{ data: existing, error: existingError }, { data: profile }] = await Promise.all([
    supabase
      .from('receipt_transactions')
      .select('id, status')
      .eq('id', input.transactionId)
      .single(),
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single(),
  ])

  if (existingError || !existing) {
    return { error: 'Transaction not found' }
  }

  const now = new Date().toISOString()

  const updatePayload = {
    status: validation.data.status,
    receipt_required: validation.data.receipt_required ?? (validation.data.status === 'pending'),
    marked_by: userId,
    marked_by_email: userEmail,
    marked_by_name: profile?.full_name ?? null,
    marked_at: now,
    marked_method: 'manual',
    rule_applied_id: null,
    notes: validation.data.note ?? null,
  }

  const { data: updated, error: updateError } = await supabase
    .from('receipt_transactions')
    .update(updatePayload)
    .eq('id', input.transactionId)
    .select('*')
    .maybeSingle()

  if (updateError) {
    console.error('Failed to update receipt transaction:', updateError)
    return { error: 'Failed to update the transaction.' }
  }
  if (!updated) {
    return { error: 'Transaction not found' }
  }

  const { error: manualUpdateLogError } = await supabase.from('receipt_transaction_logs').insert({
    transaction_id: input.transactionId,
    previous_status: existing.status,
    new_status: updated.status,
    action_type: 'manual_update',
    note: validation.data.note ?? null,
    performed_by: userId,
    rule_id: null,
    performed_at: now,
  })
  if (manualUpdateLogError) {
    console.error('Failed to record manual update transaction log', manualUpdateLogError)
  }

  return { success: true, transaction: updated }
}

// ---------------------------------------------------------------------------
// updateReceiptClassification
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performUpdateReceiptClassification(
  userId: string,
  input: {
    transactionId: string
    vendorName?: string | null
    expenseCategory?: ReceiptExpenseCategory | null
  }
): Promise<{
  success?: boolean
  changed?: boolean
  error?: string
  transaction?: ReceiptTransaction
  ruleSuggestion?: any
}> {
  const hasVendorField = Object.prototype.hasOwnProperty.call(input, 'vendorName')
  const hasExpenseField = Object.prototype.hasOwnProperty.call(input, 'expenseCategory')

  if (!hasVendorField && !hasExpenseField) {
    return { error: 'Nothing to update' }
  }

  const normalizedVendor = hasVendorField
    ? (typeof input.vendorName === 'string' ? input.vendorName.trim() : null)
    : undefined

  const validation = classificationUpdateSchema.safeParse({
    transactionId: input.transactionId,
    vendorName: hasVendorField ? (normalizedVendor ? normalizedVendor : null) : undefined,
    expenseCategory: hasExpenseField ? (input.expenseCategory ?? null) : undefined,
  })

  if (!validation.success) {
    return { error: validation.error.issues[0]?.message ?? 'Invalid classification data' }
  }

  const { transactionId, vendorName, expenseCategory } = validation.data

  const supabase = createAdminClient()

  const { data: transaction, error: fetchError } = await supabase
    .from('receipt_transactions')
    .select('*')
    .eq('id', transactionId)
    .single()

  if (fetchError || !transaction) {
    return { error: 'Transaction not found' }
  }

  if (hasExpenseField && expenseCategory && isIncomingOnlyTransaction(transaction)) {
    return { error: 'Expense categories can only be set on outgoing transactions' }
  }

  const updatePayload: Record<string, unknown> = {}
  const changeNotes: string[] = []
  const now = new Date().toISOString()
  let vendorChanged = false
  let expenseChanged = false

  if (hasVendorField) {
    const currentVendor = transaction.vendor_name ?? null
    if (currentVendor !== (vendorName ?? null)) {
      updatePayload.vendor_name = vendorName ?? null
      updatePayload.vendor_source = (vendorName ? 'manual' : null) as ReceiptClassificationSource | null
      updatePayload.vendor_rule_id = null
      updatePayload.vendor_updated_at = now
      changeNotes.push(vendorName ? `Vendor → ${vendorName}` : 'Vendor cleared')
      vendorChanged = true
    }
  }

  if (hasExpenseField) {
    const currentExpense = transaction.expense_category ?? null
    if (currentExpense !== (expenseCategory ?? null)) {
      updatePayload.expense_category = expenseCategory ?? null
      updatePayload.expense_category_source = (expenseCategory ? 'manual' : null) as ReceiptClassificationSource | null
      updatePayload.expense_rule_id = null
      updatePayload.expense_updated_at = now
      changeNotes.push(expenseCategory ? `Expense → ${expenseCategory}` : 'Expense cleared')
      expenseChanged = true
    }
  }

  if (!vendorChanged && !expenseChanged) {
    return { success: true, changed: false, transaction, ruleSuggestion: null }
  }

  updatePayload.updated_at = now

  const { data: updated, error: updateError } = await supabase
    .from('receipt_transactions')
    .update(updatePayload)
    .eq('id', transactionId)
    .select('*')
    .maybeSingle()

  if (updateError) {
    console.error('Failed to update receipt classification:', updateError)
    return { error: 'Failed to update classification.' }
  }
  if (!updated) {
    return { error: 'Transaction not found' }
  }

  const { error: classifyLogError } = await supabase.from('receipt_transaction_logs').insert({
    transaction_id: transactionId,
    previous_status: transaction.status,
    new_status: updated.status,
    action_type: 'manual_classification',
    note: changeNotes.join(' | '),
    performed_by: userId,
    rule_id: null,
    performed_at: now,
  })
  if (classifyLogError) {
    console.error('Failed to record manual classification transaction log', classifyLogError)
  }

  const ruleSuggestion = buildRuleSuggestion(updated, {
    vendorName: vendorChanged ? vendorName ?? null : undefined,
    expenseCategory: expenseChanged ? expenseCategory ?? null : undefined,
  })

  return {
    success: true,
    changed: true,
    transaction: updated,
    ruleSuggestion,
  }
}

// ---------------------------------------------------------------------------
// uploadReceiptForTransaction
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performUploadReceiptForTransaction(
  userId: string,
  userEmail: string,
  transactionId: string,
  file: File
): Promise<{ success?: boolean; error?: string; receipt?: any }> {
  const supabase = createAdminClient()

  const [{ data: transaction, error: txError }, { data: profile }] = await Promise.all([
    supabase
      .from('receipt_transactions')
      .select('id, transaction_date, details, amount_in, amount_out, status')
      .eq('id', transactionId)
      .single(),
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single(),
  ])

  if (txError || !transaction) {
    return { error: 'Transaction not found' }
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  const extension = file.name.includes('.') ? file.name.split('.').pop() || 'pdf' : 'pdf'
  const amount = transaction.amount_out ?? transaction.amount_in ?? 0
  const { friendlyName, storagePath } = composeReceiptFileArtifacts(transaction as ReceiptTransaction, amount, extension)

  const { error: uploadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(storagePath, buffer, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

  if (uploadError) {
    console.error('Failed to upload receipt:', uploadError)
    return { error: 'Failed to upload receipt file.' }
  }

  const now = new Date().toISOString()

  const { data: receipt, error: recordError } = await supabase
    .from('receipt_files')
    .insert({
      transaction_id: transactionId,
      storage_path: storagePath,
      file_name: friendlyName,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      uploaded_by: userId,
    })
    .select('*')
    .single()

  if (recordError || !receipt) {
    console.error('Failed to record receipt metadata:', recordError)
    // Attempt cleanup
    const { error: cleanupStorageError } = await supabase.storage.from(RECEIPT_BUCKET).remove([storagePath])
    if (cleanupStorageError) {
      console.error('Failed to cleanup receipt storage after metadata insert error:', cleanupStorageError)
      return { error: 'Failed to store receipt metadata. Uploaded file cleanup requires manual reconciliation.' }
    }

    return { error: 'Failed to store receipt metadata.' }
  }

  const updatePayload = {
    status: 'completed' satisfies ReceiptTransaction['status'],
    receipt_required: false,
    marked_by: userId,
    marked_by_email: userEmail,
    marked_by_name: profile?.full_name ?? null,
    marked_at: now,
    marked_method: 'receipt_upload',
    rule_applied_id: null,
  }

  const { data: updatedTransaction, error: transactionUpdateError } = await supabase
    .from('receipt_transactions')
    .update(updatePayload)
    .eq('id', transactionId)
    .select('id')
    .maybeSingle()

  if (transactionUpdateError || !updatedTransaction) {
    console.error('Failed to update receipt transaction after upload:', transactionUpdateError)
    const { error: rollbackReceiptError } = await supabase.from('receipt_files').delete().eq('id', receipt.id)
    if (rollbackReceiptError) {
      console.error('Failed to rollback receipt file record after transaction update error:', rollbackReceiptError)
    }

    const { error: rollbackStorageError } = await supabase.storage.from(RECEIPT_BUCKET).remove([storagePath])
    if (rollbackStorageError) {
      console.error('Failed to rollback receipt file storage after transaction update error:', rollbackStorageError)
    }

    if (rollbackReceiptError || rollbackStorageError) {
      return { error: 'Failed to update transaction status after receipt upload. Receipt cleanup requires manual reconciliation.' }
    }

    if (!updatedTransaction) {
      return { error: 'Transaction not found' }
    }

    return { error: 'Failed to update transaction status after receipt upload.' }
  }

  const { error: uploadLogError } = await supabase.from('receipt_transaction_logs').insert({
    transaction_id: transactionId,
    previous_status: transaction.status,
    new_status: 'completed',
    action_type: 'receipt_upload',
    note: `Receipt uploaded (${friendlyName})`,
    performed_by: userId,
    rule_id: null,
    performed_at: now,
  })

  if (uploadLogError) {
    console.error('Failed to record receipt upload transaction log:', uploadLogError)
  }

  return { success: true, receipt }
}

// ---------------------------------------------------------------------------
// deleteReceiptFile
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performDeleteReceiptFile(
  userId: string,
  fileId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = createAdminClient()

  const { data: receipt, error } = await supabase
    .from('receipt_files')
    .select('*')
    .eq('id', fileId)
    .single()

  if (error || !receipt) {
    return { error: 'Receipt not found' }
  }

  const { data: transaction, error: transactionError } = await supabase
    .from('receipt_transactions')
    .select('id, status')
    .eq('id', receipt.transaction_id)
    .single()

  if (transactionError) {
    console.error('Failed to load receipt transaction before delete:', transactionError)
  }

  const { error: deleteFileError } = await supabase.from('receipt_files').delete().eq('id', fileId)
  if (deleteFileError) {
    console.error('Failed to delete receipt file record:', deleteFileError)
    return { error: 'Failed to remove receipt record.' }
  }

  const { error: storageRemoveError } = await supabase.storage.from(RECEIPT_BUCKET).remove([receipt.storage_path])
  if (storageRemoveError) {
    console.error('Failed to remove receipt file from storage:', storageRemoveError)

    const { error: rollbackError } = await supabase.from('receipt_files').insert({
      id: receipt.id,
      transaction_id: receipt.transaction_id,
      storage_path: receipt.storage_path,
      file_name: receipt.file_name,
      mime_type: receipt.mime_type,
      file_size_bytes: receipt.file_size_bytes,
      uploaded_by: receipt.uploaded_by,
      uploaded_at: receipt.uploaded_at,
    })

    if (rollbackError) {
      console.error('Failed to rollback receipt file record after storage delete failure:', rollbackError)
    }

    return { error: 'Failed to remove stored receipt file.' }
  }

  // If there are no receipts left, revert to pending
  const { data: remaining, error: remainingError } = await supabase
    .from('receipt_files')
    .select('id')
    .eq('transaction_id', receipt.transaction_id)

  if (remainingError) {
    console.error('Failed to check for remaining receipts:', remainingError)
    await supabase
      .from('receipt_transactions')
      .update({
        status: 'pending',
        receipt_required: true,
        marked_by: null,
        marked_by_email: null,
        marked_by_name: null,
        marked_at: null,
        marked_method: null,
        rule_applied_id: null,
      })
      .eq('id', receipt.transaction_id)
    return { error: 'Receipt was removed, but failed to verify remaining receipt files.' }
  }

  const newStatus = remaining?.length ? (transaction?.status ?? 'pending') : 'pending'

  if (!remaining?.length) {
    const { data: updatedTransaction, error: transactionUpdateError } = await supabase
      .from('receipt_transactions')
      .update({
        status: 'pending',
        receipt_required: true,
        marked_by: null,
        marked_by_email: null,
        marked_by_name: null,
        marked_at: null,
        marked_method: null,
        rule_applied_id: null,
      })
      .eq('id', receipt.transaction_id)
      .select('id')
      .maybeSingle()

    if (transactionUpdateError) {
      console.error('Failed to reset receipt transaction status after delete:', transactionUpdateError)
      return { error: 'Receipt was removed, but failed to reset transaction status.' }
    }

    if (!updatedTransaction) {
      return { error: 'Receipt was removed, but transaction no longer exists.' }
    }
  }

  const now = new Date().toISOString()

  const { error: deleteLogError } = await supabase.from('receipt_transaction_logs').insert({
    transaction_id: receipt.transaction_id,
    previous_status: transaction?.status ?? null,
    new_status: newStatus,
    action_type: 'receipt_deleted',
    note: 'Receipt removed by user',
    performed_by: userId,
    rule_id: null,
    performed_at: now,
  })

  if (deleteLogError) {
    console.error('Failed to record receipt deletion transaction log:', deleteLogError)
  }

  return { success: true }
}

// ---------------------------------------------------------------------------
// createReceiptRule
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performCreateReceiptRule(
  userId: string,
  formData: FormData
): Promise<RuleMutationResult> {
  const rawVendor = formData.get('set_vendor_name')
  const rawExpense = formData.get('set_expense_category')

  const rawData = {
    name: formData.get('name'),
    description: formData.get('description') || undefined,
    match_description: formData.get('match_description') || undefined,
    match_transaction_type: formData.get('match_transaction_type') || undefined,
    match_direction: formData.get('match_direction') || 'both',
    match_min_amount: toOptionalNumber(formData.get('match_min_amount')),
    match_max_amount: toOptionalNumber(formData.get('match_max_amount')),
    auto_status: formData.get('auto_status') || 'no_receipt_required',
    set_vendor_name:
      typeof rawVendor === 'string' && rawVendor.trim().length ? rawVendor.trim() : undefined,
    set_expense_category:
      typeof rawExpense === 'string' && rawExpense.trim().length ? rawExpense.trim() : undefined,
  }

  const parsed = receiptRuleSchema.safeParse(rawData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid rule details' }
  }
  if (parsed.data.set_expense_category && parsed.data.match_direction !== 'out') {
    return { error: 'Expense auto-tagging rules must use outgoing direction' }
  }

  const supabase = createAdminClient()

  const { data: rule, error } = await supabase
    .from('receipt_rules')
    .insert({
      ...parsed.data,
      created_by: userId,
      updated_by: userId,
    })
    .select('*')
    .single()

  if (error || !rule) {
    console.error('Failed to create rule:', error)
    return { error: 'Failed to create rule.' }
  }

  return { success: true, rule, canPromptRetro: true }
}

// ---------------------------------------------------------------------------
// updateReceiptRule
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performUpdateReceiptRule(
  userId: string,
  ruleId: string,
  formData: FormData
): Promise<RuleMutationResult> {
  const rawVendor = formData.get('set_vendor_name')
  const rawExpense = formData.get('set_expense_category')

  const rawData = {
    name: formData.get('name'),
    description: formData.get('description') || undefined,
    match_description: formData.get('match_description') || undefined,
    match_transaction_type: formData.get('match_transaction_type') || undefined,
    match_direction: formData.get('match_direction') || 'both',
    match_min_amount: toOptionalNumber(formData.get('match_min_amount')),
    match_max_amount: toOptionalNumber(formData.get('match_max_amount')),
    auto_status: formData.get('auto_status') || 'no_receipt_required',
    set_vendor_name:
      typeof rawVendor === 'string' && rawVendor.trim().length ? rawVendor.trim() : undefined,
    set_expense_category:
      typeof rawExpense === 'string' && rawExpense.trim().length ? rawExpense.trim() : undefined,
  }

  const parsed = receiptRuleSchema.safeParse(rawData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid rule details' }
  }
  if (parsed.data.set_expense_category && parsed.data.match_direction !== 'out') {
    return { error: 'Expense auto-tagging rules must use outgoing direction' }
  }

  const supabase = createAdminClient()

  const { data: updated, error } = await supabase
    .from('receipt_rules')
    .update({
      ...parsed.data,
      updated_by: userId,
    })
    .eq('id', ruleId)
    .select('*')
    .maybeSingle()

  if (error) {
    return { error: 'Failed to update rule.' }
  }
  if (!updated) {
    return { error: 'Rule not found' }
  }

  return { success: true, rule: updated, canPromptRetro: true }
}

// ---------------------------------------------------------------------------
// toggleReceiptRule
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performToggleReceiptRule(
  ruleId: string,
  isActive: boolean
): Promise<{ success?: boolean; error?: string; rule?: ReceiptRule }> {
  const supabase = createAdminClient()
  const { data: updated, error } = await supabase
    .from('receipt_rules')
    .update({ is_active: isActive })
    .eq('id', ruleId)
    .select('*')
    .maybeSingle()

  if (error) {
    return { error: 'Failed to update rule status.' }
  }
  if (!updated) {
    return { error: 'Rule not found' }
  }

  if (isActive) {
    await refreshAutomationForPendingTransactions()
  }

  return { success: true, rule: updated }
}

// ---------------------------------------------------------------------------
// deleteReceiptRule
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performDeleteReceiptRule(
  ruleId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('receipt_rules')
    .delete()
    .eq('id', ruleId)

  if (error) {
    return { error: 'Failed to delete rule.' }
  }

  return { success: true }
}

// ---------------------------------------------------------------------------
// applyReceiptGroupClassification
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performApplyReceiptGroupClassification(
  userId: string,
  input: {
    details: string
    vendorName?: string | null
    expenseCategory?: ReceiptExpenseCategory | null
    statuses?: BulkStatus[]
  }
): Promise<{ success?: boolean; error?: string; updated?: number; skippedIncomingCount?: number }> {
  const vendorProvided = Object.prototype.hasOwnProperty.call(input, 'vendorName')
  const expenseProvided = Object.prototype.hasOwnProperty.call(input, 'expenseCategory')

  if (!vendorProvided && !expenseProvided) {
    return { error: 'Nothing to update' }
  }

  const parsed = bulkGroupApplySchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }

  const supabase = createAdminClient()

  const statuses = parsed.data.statuses && parsed.data.statuses.length
    ? (Array.from(new Set(parsed.data.statuses)) as BulkStatus[])
    : (BULK_STATUS_OPTIONS as BulkStatus[])

  const normalizedVendor = vendorProvided ? normalizeVendorInput(parsed.data.vendorName ?? null) : undefined
  const normalizedExpense = expenseProvided ? coerceExpenseCategory(parsed.data.expenseCategory ?? null) : undefined

  if (vendorProvided && parsed.data.vendorName && !normalizedVendor) {
    return { error: 'Vendor name must be between 1 and 120 characters' }
  }

  if (expenseProvided && parsed.data.expenseCategory && !normalizedExpense) {
    return { error: 'Expense category is not recognised' }
  }

  const selection = supabase
    .from('receipt_transactions')
    .select('id, status, amount_in, amount_out, vendor_name, vendor_source, vendor_rule_id, vendor_updated_at')
    .eq('details', parsed.data.details)
    .in('status', statuses)

  const { data: matches, error: selectError } = await selection

  if (selectError) {
    console.error('Failed to load transactions for bulk classification', selectError)
    return { error: 'Failed to load matching transactions' }
  }

  const matchRows = (matches ?? []) as Array<Pick<ReceiptTransaction, 'id' | 'status' | 'amount_in' | 'amount_out'> & {
    vendor_name: string | null
    vendor_source: string | null
    vendor_rule_id: string | null
    vendor_updated_at: string | null
  }>

  if (!matchRows.length) {
    return { success: true, updated: 0, skippedIncomingCount: 0 }
  }

  const now = new Date().toISOString()
  const allIds = matchRows.map((row) => row.id)
  const incomingOnlyIds = new Set(
    matchRows
      .filter((row) => isIncomingOnlyTransaction(row))
      .map((row) => row.id)
  )
  const skippedIncomingCount = expenseProvided
    ? Array.from(incomingOnlyIds).length
    : 0

  const updatedIdSet = new Set<string>()

  // Capture previous vendor values so rollback can restore originals (not null them).
  const previousVendorValues = new Map<string, {
    vendor_name: string | null
    vendor_source: string | null
    vendor_rule_id: string | null
    vendor_updated_at: string | null
  }>()
  for (const row of matchRows) {
    previousVendorValues.set(row.id, {
      vendor_name: row.vendor_name,
      vendor_source: row.vendor_source,
      vendor_rule_id: row.vendor_rule_id,
      vendor_updated_at: row.vendor_updated_at,
    })
  }

  // NOTE: Vendor applies to allIds; expense applies to expenseEligibleIds (excludes incoming-only rows).
  // Because the row sets differ, these cannot be merged into a single UPDATE call.
  // True atomicity would require a DB-level transaction (RPC) — tracked as tech debt (DEF-007).

  if (vendorProvided) {
    const vendorPayload: Record<string, unknown> = {
      updated_at: now,
      vendor_name: normalizedVendor,
      vendor_source: normalizedVendor ? 'manual' : null,
      vendor_rule_id: null,
      vendor_updated_at: now,
    }

    const { error: vendorUpdateError } = await supabase
      .from('receipt_transactions')
      .update(vendorPayload)
      .in('id', allIds)

    if (vendorUpdateError) {
      console.error('Failed to apply vendor bulk classification', vendorUpdateError)
      return { error: 'Failed to apply changes' }
    }

    allIds.forEach((id) => updatedIdSet.add(id))
  }

  if (expenseProvided) {
    const expenseEligibleIds = matchRows
      .filter((row) => !incomingOnlyIds.has(row.id))
      .map((row) => row.id)

    if (expenseEligibleIds.length > 0) {
      const expensePayload: Record<string, unknown> = {
        updated_at: now,
        expense_category: normalizedExpense ?? null,
        expense_category_source: normalizedExpense ? 'manual' : null,
        expense_rule_id: null,
        expense_updated_at: now,
      }

      const { error: expenseUpdateError } = await supabase
        .from('receipt_transactions')
        .update(expensePayload)
        .in('id', expenseEligibleIds)

      if (expenseUpdateError) {
        console.error('Failed to apply expense bulk classification', expenseUpdateError)

        // Compensating revert: if vendor was already committed, attempt to roll it back
        if (vendorProvided && allIds.length > 0) {
          const revertErrors: string[] = []
          for (const id of allIds) {
            const prev = previousVendorValues.get(id)
            const { error: revertError } = await supabase
              .from('receipt_transactions')
              .update({
                vendor_name: prev?.vendor_name ?? null,
                vendor_source: prev?.vendor_source ?? null,
                vendor_rule_id: prev?.vendor_rule_id ?? null,
                vendor_updated_at: prev?.vendor_updated_at ?? now,
                updated_at: now,
              })
              .eq('id', id)
            if (revertError) {
              revertErrors.push(`${id}: ${revertError.message}`)
            }
          }
          if (revertErrors.length > 0) {
            console.error('Failed to revert vendor update after expense failure — transactions may be in partial state', revertErrors)
          }
        }

        return { error: 'Failed to apply changes' }
      }

      expenseEligibleIds.forEach((id) => updatedIdSet.add(id))
    }
  }

  const summaryParts: string[] = []
  if (vendorProvided) {
    summaryParts.push(normalizedVendor ? `Vendor → ${normalizedVendor}` : 'Vendor cleared')
  }
  if (expenseProvided) {
    summaryParts.push(normalizedExpense ? `Expense → ${normalizedExpense}` : 'Expense cleared')
    if (skippedIncomingCount > 0) {
      summaryParts.push(`Skipped incoming-only rows: ${skippedIncomingCount}`)
    }
  }

  const note = `Bulk classification: ${summaryParts.join(' | ')}`
  const statusMap = new Map(matchRows.map((row) => [row.id, row.status]))
  const updatedIds = Array.from(updatedIdSet)

  const logs = updatedIds.map((id) => ({
    transaction_id: id,
    previous_status: statusMap.get(id) ?? 'pending',
    new_status: statusMap.get(id) ?? 'pending',
    action_type: 'bulk_classification' as const,
    note,
    performed_by: userId,
    rule_id: null,
    performed_at: now,
  }))

  if (logs.length) {
    const { error: logError } = await supabase.from('receipt_transaction_logs').insert(logs)
    if (logError) {
      console.error('Failed to record bulk classification logs', logError)
    }
  }

  return { success: true, updated: updatedIds.length, skippedIncomingCount }
}

// ---------------------------------------------------------------------------
// requeueUnclassifiedTransactions
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performRequeueUnclassifiedTransactions(): Promise<{ success: boolean; queued?: number; error?: string }> {
  const supabase = createAdminClient()

  // Query 1: transactions with no vendor classification at all
  const { data: vendorMissing, error: vendorError } = await supabase
    .from('receipt_transactions')
    .select('id, batch_id')
    .is('vendor_name', null)
    .is('vendor_source', null)
    .limit(5000)

  if (vendorError) {
    console.error('Failed to load vendor-unclassified transactions for requeue', vendorError)
    return { success: false, error: 'Failed to load transactions' }
  }

  // Query 2: outgoing transactions that have a vendor but no expense category
  const { data: expenseMissing, error: expenseError } = await supabase
    .from('receipt_transactions')
    .select('id, batch_id')
    .is('expense_category', null)
    .is('expense_category_source', null)
    .not('amount_out', 'is', null)
    .gt('amount_out', 0)
    .limit(5000)

  if (expenseError) {
    console.error('Failed to load expense-unclassified transactions for requeue', expenseError)
    return { success: false, error: 'Failed to load transactions' }
  }

  // Merge and de-duplicate by ID
  const seenIds = new Set<string>()
  const rows: Array<{ id: string; batch_id: string | null }> = []
  for (const row of [...(vendorMissing ?? []), ...(expenseMissing ?? [])]) {
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id)
      rows.push(row)
    }
  }

  if (!rows.length) {
    return { success: true, queued: 0 }
  }

  const ids = rows.map((row) => row.id)
  const batchId = rows[0]?.batch_id ?? 'requeue'

  try {
    const result = await enqueueReceiptAiClassificationJobs(ids, batchId)
    return { success: true, queued: result.queued }
  } catch (err) {
    console.error('Failed to enqueue requeue jobs', err)
    return { success: false, error: 'Failed to queue classification jobs' }
  }
}
