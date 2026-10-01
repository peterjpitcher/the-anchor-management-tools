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
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { receiptRuleSchema, receiptMarkSchema } from '@/lib/validation'
import { jobQueue } from '@/lib/unified-job-queue'
import { createHash } from 'crypto'
import type {
  ReceiptRule,
  ReceiptTransaction,
  ReceiptExpenseCategory,
  ReceiptClassificationSource,
} from '@/types/database'

import type {
  AdminClient,
  RuleMutationResult,
  BulkStatus,
  ReceiptVendorWatchlistItem,
  ReceiptVendorReviewItem,
  ReceiptVendorReviewStatus,
  ReceiptVendorMovementComparison,
} from './types'
import {
  RECEIPT_BUCKET,
  RECEIPT_AI_JOB_CHUNK_SIZE,
} from './types'
import {
  normalizeVendorInput,
  coerceExpenseCategory,
  chunkArray,
  isIncomingOnlyTransaction,
  buildRuleSuggestion,
  composeReceiptFileArtifacts,
  receiptUploadMetadataSchema,
  receiptUploadedObjectSchema,
  classificationUpdateSchema,
  bulkGroupApplySchema,
  toOptionalNumber,
  BULK_STATUS_OPTIONS,
} from './receiptHelpers'
import { normalizeReceiptVendorKey } from './vendorInsights'
import {
  recordReceiptClassificationSignals,
  resolveReceiptVendorId,
} from './receiptGovernance'
import { applyAutomationRules, refreshAutomationForPendingTransactions } from './receiptAutomation'

// The rule engine lives in receiptAutomation.ts and the statement import in receiptImport.ts.
// Re-exported so existing imports keep working.
export { applyAutomationRules, refreshAutomationForPendingTransactions }
export { performImportReceiptStatement, processReceiptBatchFollowup } from './receiptImport'
export type { ImportStatementResult, ReceiptBatchFollowupStatus } from './receiptImport'

/** Queues one receipts background job. Returns false, having logged why, when it could not. */
async function enqueueReceiptSystemJob(
  type: Parameters<typeof jobQueue.enqueue>[0],
  uniqueSuffix: string,
  payload: Record<string, unknown> = {}
): Promise<boolean> {
  const result = await jobQueue.enqueue(
    type,
    payload,
    {
      priority: -10,
      unique: `receipts:${type}:${uniqueSuffix}`,
    }
  )

  if (!result.success) {
    console.error(`Failed to enqueue receipt system job ${type}`, result.error)
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// performSetReceiptVendorWatched
// ---------------------------------------------------------------------------

export async function performSetReceiptVendorWatched(
  userId: string,
  input: {
    vendorLabel: string
    watched: boolean
  },
): Promise<{
  success?: boolean
  watched?: boolean
  item?: ReceiptVendorWatchlistItem
  error?: string
}> {
  const vendorLabel = normalizeVendorInput(input.vendorLabel)
  const vendorKey = normalizeReceiptVendorKey(vendorLabel)

  if (!vendorLabel || !vendorKey) {
    return { error: 'Invalid vendor provided' }
  }

  const supabase = createAdminClient()

  if (!input.watched) {
    const { error } = await supabase
      .from('receipt_vendor_watchlist')
      .delete()
      .eq('user_id', userId)
      .eq('vendor_key', vendorKey)

    if (error) {
      console.error('Failed to remove vendor from watchlist', error)
      return { error: 'Failed to update vendor watchlist.' }
    }

    return { success: true, watched: false }
  }

  const { data, error } = await supabase
    .from('receipt_vendor_watchlist')
    .upsert({
      user_id: userId,
      vendor_key: vendorKey,
      vendor_label: vendorLabel,
    }, { onConflict: 'user_id,vendor_key' })
    .select('user_id, vendor_key, vendor_label, created_at, updated_at')
    .single()

  if (error || !data) {
    console.error('Failed to add vendor to watchlist', error)
    return { error: 'Failed to update vendor watchlist.' }
  }

  return {
    success: true,
    watched: true,
    item: {
      userId: data.user_id,
      vendorKey: data.vendor_key,
      vendorLabel: data.vendor_label,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  }
}

// ---------------------------------------------------------------------------
// performSetReceiptVendorReviewStatus
// ---------------------------------------------------------------------------

export async function performSetReceiptVendorReviewStatus(
  userId: string,
  input: {
    vendorLabel: string
    comparison: ReceiptVendorMovementComparison
    monthStart: string
    status: ReceiptVendorReviewStatus
  },
): Promise<{ success?: boolean; item?: ReceiptVendorReviewItem; error?: string }> {
  const vendorLabel = normalizeVendorInput(input.vendorLabel)
  const vendorKey = normalizeReceiptVendorKey(vendorLabel)
  const validStatuses: ReceiptVendorReviewStatus[] = ['needs_review', 'expected', 'action_required', 'reviewed']
  const validComparisons: ReceiptVendorMovementComparison[] = ['mom', 'yoy', 'rolling_3m']
  const monthStart = /^\d{4}-\d{2}-01$/.test(input.monthStart) ? input.monthStart : null

  if (!vendorLabel || !vendorKey || !monthStart || !validStatuses.includes(input.status) || !validComparisons.includes(input.comparison)) {
    return { error: 'Invalid vendor review provided' }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('receipt_vendor_reviews')
    .upsert({
      user_id: userId,
      vendor_key: vendorKey,
      vendor_label: vendorLabel,
      comparison: input.comparison,
      month_start: monthStart,
      status: input.status,
    }, { onConflict: 'user_id,vendor_key,comparison,month_start' })
    .select('user_id, vendor_key, vendor_label, comparison, month_start, status, created_at, updated_at')
    .single()

  if (error || !data) {
    console.error('Failed to update vendor review status', error)
    return { error: 'Failed to update vendor review status.' }
  }

  return {
    success: true,
    item: {
      userId: data.user_id,
      vendorKey: data.vendor_key,
      vendorLabel: data.vendor_label,
      comparison: data.comparison as ReceiptVendorMovementComparison,
      monthStart: String(data.month_start).slice(0, 10),
      status: data.status as ReceiptVendorReviewStatus,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  }
}

// ---------------------------------------------------------------------------
// enqueueReceiptAiClassificationJobs
// ---------------------------------------------------------------------------

async function enqueueReceiptAiClassificationJobs(
  transactionIds: string[],
  batchId: string
): Promise<{ queued: number; failed: number; queuedTransactions: number }> {
  if (!transactionIds.length) {
    return { queued: 0, failed: 0, queuedTransactions: 0 }
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
  // `queued` counts jobs, each carrying up to RECEIPT_AI_JOB_CHUNK_SIZE transactions.
  // Anything shown to staff as a transaction count needs the transactions inside the
  // jobs that actually queued.
  const queuedTransactions = chunks.reduce(
    (total, chunk, index) => (results[index].success ? total + chunk.length : total),
    0
  )

  if (failed > 0) {
    console.error('Failed to enqueue receipt AI classification jobs', {
      failed,
      total: results.length,
      batchId,
    })
  }

  return { queued: results.length - failed, failed, queuedTransactions }
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
    receipt_required: validation.data.status === 'pending',
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
// updateReceiptNote
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

/**
 * Saves the note on a payment and nothing else. Notes used to be saved through the status
 * change, which rewrote who had marked the payment and dropped its link to the rule that
 * closed it.
 */
export async function performUpdateReceiptNote(
  userId: string,
  input: { transactionId: string; note?: string | null }
): Promise<{ success?: boolean; error?: string; transaction?: ReceiptTransaction }> {
  if (typeof input.transactionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.transactionId)) {
    return { error: 'Transaction reference is invalid' }
  }

  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note.length > 500) {
    return { error: 'Keep the note under 500 characters' }
  }

  const supabase = createAdminClient()
  const { data: updated, error: updateError } = await supabase
    .from('receipt_transactions')
    .update({ notes: note.length ? note : null })
    .eq('id', input.transactionId)
    .select('*')
    .maybeSingle()

  if (updateError) {
    console.error('Failed to update receipt note:', updateError)
    return { error: 'Failed to save the note.' }
  }
  if (!updated) {
    return { error: 'Transaction not found' }
  }

  const { error: noteLogError } = await supabase.from('receipt_transaction_logs').insert({
    transaction_id: input.transactionId,
    previous_status: updated.status,
    new_status: updated.status,
    action_type: 'note_update',
    note: note.length ? note : 'Note cleared',
    performed_by: userId,
    rule_id: null,
    performed_at: new Date().toISOString(),
  })
  if (noteLogError) {
    console.error('Failed to record note update transaction log', noteLogError)
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
      const vendorId = vendorName ? await resolveReceiptVendorId(supabase, vendorName) : null
      updatePayload.vendor_name = vendorName ?? null
      updatePayload.vendor_id = vendorId
      // A value a person clears is still that person's decision, so the source stays manual
      // and no rule or AI run fills it back in.
      updatePayload.vendor_source = 'manual' satisfies ReceiptClassificationSource
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
      updatePayload.expense_category_source = 'manual' satisfies ReceiptClassificationSource
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

  await recordReceiptClassificationSignals(supabase, [{
    transaction_id: transactionId,
    source: 'human',
    signal_type: 'manual_classification',
    prior_vendor_id: transaction.vendor_id ?? null,
    new_vendor_id: (updatePayload.vendor_id as string | null | undefined) ?? transaction.vendor_id ?? null,
    prior_vendor_name: transaction.vendor_name,
    new_vendor_name: (updatePayload.vendor_name as string | null | undefined) ?? transaction.vendor_name,
    prior_expense_category: transaction.expense_category,
    new_expense_category: (updatePayload.expense_category as ReceiptExpenseCategory | null | undefined) ?? transaction.expense_category,
    prior_status: transaction.status,
    new_status: updated.status,
    rule_id: null,
    ai_confidence: null,
    performed_by: userId,
    performed_at: now,
    payload: { note: changeNotes.join(' | ') },
  }])

  await enqueueReceiptSystemJob('suggest_receipt_rules', new Date().toISOString().slice(0, 10))

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

type ReceiptUploadMetadataInput = {
  fileName: string
  fileType: string
  fileSize: number
}

type ReceiptUploadedObjectInput = ReceiptUploadMetadataInput & {
  transactionId: string
  storagePath: string
}

async function getReceiptUploadContext(
  supabase: AdminClient,
  userId: string,
  transactionId: string
): Promise<{
  transaction?: Pick<ReceiptTransaction, 'id' | 'transaction_date' | 'details' | 'amount_in' | 'amount_out' | 'status'>
  profile?: { full_name: string | null } | null
  error?: string
}> {
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

  return { transaction, profile }
}

async function recordUploadedReceiptForTransaction(params: {
  supabase: AdminClient
  userId: string
  userEmail: string
  transactionId: string
  transaction: Pick<ReceiptTransaction, 'status'>
  profile?: { full_name: string | null } | null
  storagePath: string
  fileName: string
  fileType: string
  fileSize: number
  contentHash?: string | null
}): Promise<{ success?: boolean; error?: string; receipt?: any }> {
  const {
    supabase,
    userId,
    userEmail,
    transactionId,
    transaction,
    profile,
    storagePath,
    fileName,
    fileType,
    fileSize,
    contentHash,
  } = params

  const now = new Date().toISOString()

  const { data: receipt, error: recordError } = await supabase
    .from('receipt_files')
    .insert({
      transaction_id: transactionId,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: fileType || null,
      file_size_bytes: fileSize,
      content_hash: contentHash ?? null,
      hash_verified_at: contentHash ? now : null,
      uploaded_by: userId,
    })
    .select('*')
    .single()

  if (recordError || !receipt) {
    console.error('Failed to record receipt metadata:', recordError)
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
    note: `Receipt uploaded (${fileName})`,
    performed_by: userId,
    rule_id: null,
    performed_at: now,
  })

  if (uploadLogError) {
    console.error('Failed to record receipt upload transaction log:', uploadLogError)
  }

  await recordReceiptClassificationSignals(supabase, [{
    transaction_id: transactionId,
    source: 'human',
    signal_type: 'receipt_upload',
    prior_vendor_id: null,
    new_vendor_id: null,
    prior_vendor_name: null,
    new_vendor_name: null,
    prior_expense_category: null,
    new_expense_category: null,
    prior_status: transaction.status,
    new_status: 'completed',
    rule_id: null,
    ai_confidence: null,
    performed_by: userId,
    performed_at: now,
    payload: { file_name: fileName, content_hash: contentHash ?? null },
  }])

  return { success: true, receipt }
}

export async function performCreateReceiptUploadUrl(
  userId: string,
  transactionId: string,
  metadata: ReceiptUploadMetadataInput
): Promise<{ success?: boolean; error?: string; path?: string; token?: string; friendlyName?: string }> {
  const validation = receiptUploadMetadataSchema.safeParse(metadata)
  if (!validation.success) {
    return { error: validation.error.issues[0]?.message ?? 'Invalid receipt upload' }
  }

  const supabase = createAdminClient()

  const { transaction, error } = await getReceiptUploadContext(supabase, userId, transactionId)
  if (error || !transaction) {
    return { error: error ?? 'Transaction not found' }
  }

  const extension = validation.data.fileName.includes('.')
    ? validation.data.fileName.split('.').pop() || 'pdf'
    : 'pdf'
  const amount = transaction.amount_out ?? transaction.amount_in ?? 0
  const { friendlyName, storagePath } = composeReceiptFileArtifacts(transaction as ReceiptTransaction, amount, extension)

  const { data, error: signedUploadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false })

  if (signedUploadError || !data?.token) {
    console.error('Failed to create receipt signed upload URL:', signedUploadError)
    return { error: signedUploadError?.message || 'Failed to prepare receipt upload.' }
  }

  const issuedPath = data.path ?? storagePath
  const { error: intentError } = await (supabase as any)
    .from('receipt_upload_intents')
    .insert({
      transaction_id: transactionId,
      storage_path: issuedPath,
      issued_to: userId,
      original_file_name: validation.data.fileName,
      file_type: validation.data.fileType,
      file_size_bytes: validation.data.fileSize,
    })

  if (intentError) {
    console.error('Failed to record receipt upload intent:', intentError)
    await supabase.storage.from(RECEIPT_BUCKET).remove([issuedPath])
    return { error: 'Failed to prepare receipt upload.' }
  }

  return {
    success: true,
    path: issuedPath,
    token: data.token,
    friendlyName,
  }
}

export async function performCompleteReceiptUpload(
  userId: string,
  userEmail: string,
  input: ReceiptUploadedObjectInput
): Promise<{ success?: boolean; error?: string; receipt?: any }> {
  const validation = receiptUploadedObjectSchema.safeParse({
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.fileSize,
    storagePath: input.storagePath,
  })

  if (!validation.success) {
    return { error: validation.error.issues[0]?.message ?? 'Invalid receipt upload' }
  }

  const supabase = createAdminClient()
  const storagePath = validation.data.storagePath

  // Nothing below removes a stored object on the strength of the path alone. The path comes
  // from the browser, and it has the same shape as every receipt already stored.
  const { transaction, profile, error } = await getReceiptUploadContext(supabase, userId, input.transactionId)
  if (error || !transaction) {
    return { error: error ?? 'Transaction not found' }
  }

  const expectedYearPrefix = `${transaction.transaction_date.substring(0, 4)}/`
  if (!storagePath.startsWith(expectedYearPrefix)) {
    await releaseUnattachedReceiptUpload(supabase, input.transactionId, storagePath, userId)
    return { error: 'Uploaded receipt path is invalid' }
  }

  let contentHash: string | null = null
  const { data: storedFile, error: downloadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .download(storagePath)
  if (!downloadError && storedFile) {
    contentHash = createHash('sha256')
      .update(Buffer.from(await storedFile.arrayBuffer()))
      .digest('hex')
  }

  // One locked transaction: file row, payment, log and intent move together, and a second call
  // for the same upload is answered with the file the first one stored.
  const { data: rpcResult, error: rpcError } = await (supabase as any).rpc('complete_receipt_upload', {
    p_transaction_id: input.transactionId,
    p_storage_path: storagePath,
    p_user_id: userId,
    p_user_email: userEmail,
    p_user_name: profile?.full_name ?? null,
    p_file_name: validation.data.fileName,
    p_mime_type: validation.data.fileType,
    p_file_size_bytes: validation.data.fileSize,
    p_content_hash: contentHash,
  })

  if (rpcError) {
    console.error('Failed to complete receipt upload:', rpcError)
    await releaseUnattachedReceiptUpload(supabase, input.transactionId, storagePath, userId)
    return { error: 'Failed to store receipt metadata.' }
  }

  const outcome = (rpcResult as { outcome?: string } | null)?.outcome
  const receipt = (rpcResult as { receipt?: Record<string, unknown> } | null)?.receipt ?? null

  if (outcome === 'replayed' && receipt) {
    return { success: true, receipt }
  }

  if (outcome === 'completed' && receipt) {
    const previousStatus = ((rpcResult as { previous_status?: string }).previous_status ??
      transaction.status) as ReceiptTransaction['status']
    await recordReceiptClassificationSignals(supabase, [{
      transaction_id: input.transactionId,
      source: 'human',
      signal_type: 'receipt_upload',
      prior_vendor_id: null,
      new_vendor_id: null,
      prior_vendor_name: null,
      new_vendor_name: null,
      prior_expense_category: null,
      new_expense_category: null,
      prior_status: previousStatus,
      new_status: 'completed',
      rule_id: null,
      ai_confidence: null,
      performed_by: userId,
      performed_at: new Date().toISOString(),
      payload: { file_name: validation.data.fileName, content_hash: contentHash },
    }])
    return { success: true, receipt }
  }

  if (outcome === 'transaction_not_found') {
    return { error: 'Transaction not found' }
  }

  if (outcome === 'already_completed') {
    return { error: 'This upload was already completed and its file has since been removed. Upload the receipt again.' }
  }

  // not_issued, or anything unexpected: the path was never issued to this user for this
  // payment, so it is not ours to touch.
  return { error: 'Uploaded receipt path was not issued for this transaction' }
}

/**
 * Removes a stored object that will never be attached. The database decides, under the same
 * lock a completion takes, whether the caller still holds an open intent for a path no file
 * row references. Only then is the object removed, so a file that was attached can never lose
 * its object, however the calls interleave.
 */
async function releaseUnattachedReceiptUpload(
  supabase: AdminClient,
  transactionId: string,
  storagePath: string,
  userId: string
): Promise<void> {
  const { data: released, error: releaseError } = await (supabase as any).rpc('release_receipt_upload_intent', {
    p_transaction_id: transactionId,
    p_storage_path: storagePath,
    p_user_id: userId,
  })

  if (releaseError) {
    console.error('Failed to release receipt upload intent:', releaseError)
    return
  }

  if (released !== 'released') {
    return
  }

  const { error: removeError } = await supabase.storage.from(RECEIPT_BUCKET).remove([storagePath])
  if (removeError) {
    // The intent is gone and the object is still there. It is referenced by nothing, so the
    // storage sweep will find it; say so loudly in the meantime.
    console.error('Released a receipt upload but could not remove its stored object', {
      storagePath,
      transactionId,
      removeError,
    })
  }
}

export async function performUploadReceiptForTransaction(
  userId: string,
  userEmail: string,
  transactionId: string,
  file: File
): Promise<{ success?: boolean; error?: string; receipt?: any }> {
  const supabase = createAdminClient()

  const { transaction, profile, error } = await getReceiptUploadContext(supabase, userId, transactionId)
  if (error || !transaction) {
    return { error: error ?? 'Transaction not found' }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const contentHash = createHash('sha256').update(buffer).digest('hex')

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

  return recordUploadedReceiptForTransaction({
    supabase,
    userId,
    userEmail,
    transactionId,
    transaction,
    profile,
    storagePath,
    fileName: friendlyName,
    fileType: file.type || 'application/octet-stream',
    fileSize: file.size,
    contentHash,
  })
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

function optionalRuleText(input: FormDataEntryValue | null): string | undefined {
  return typeof input === 'string' && input.trim().length ? input.trim() : undefined
}

function optionalRuleInteger(input: FormDataEntryValue | null): number | undefined {
  if (typeof input !== 'string') return undefined
  const cleaned = input.trim()
  if (!cleaned) return undefined
  const value = Number.parseInt(cleaned, 10)
  return Number.isFinite(value) ? value : undefined
}

/**
 * What the form is asking us to do with the description: the trimmed text, null when the field
 * is there but blank (a deliberate clear), and undefined when the form carries no description
 * field at all, which means leave the stored one alone. The rule edit screen has no description
 * input, so every edit used to blank the descriptions written by the approve-suggestion RPC,
 * the group-rule path and the seed migrations.
 */
function getRuleDescription(formData: FormData): string | null | undefined {
  if (!formData.has('description')) return undefined
  return optionalRuleText(formData.get('description')) ?? null
}

function getRuleFormData(formData: FormData) {
  return {
    name: formData.get('name'),
    description: getRuleDescription(formData),
    priority: optionalRuleInteger(formData.get('priority')),
    kind: optionalRuleText(formData.get('kind')) ?? 'standard',
    reviewed: formData.get('reviewed') === 'on',
    match_description: optionalRuleText(formData.get('match_description')),
    match_transaction_type: optionalRuleText(formData.get('match_transaction_type')),
    match_direction: formData.get('match_direction') || 'both',
    match_min_amount: toOptionalNumber(formData.get('match_min_amount')),
    match_max_amount: toOptionalNumber(formData.get('match_max_amount')),
    // No outcome chosen means the rule only classifies. Closing a payment has to be asked for.
    auto_status: formData.get('auto_status') || 'pending',
    set_vendor_name: optionalRuleText(formData.get('set_vendor_name')),
    set_expense_category: optionalRuleText(formData.get('set_expense_category')),
  }
}

/**
 * The columns to write for a rule insert or update.
 *
 * `isInsert` also decides what an absent description means: a new rule starts with none, while
 * an update leaves the stored one alone (see getRuleDescription). Every other optional column
 * below IS on the rule edit form, prefilled, so a blank one there is a deliberate clear.
 */
function buildRuleWritePayload(
  data: {
    name: string
    description?: string | null
    priority?: number
    kind?: ReceiptRule['kind']
    reviewed?: boolean
    match_description?: string
    match_transaction_type?: string
    match_direction: ReceiptRule['match_direction']
    match_min_amount?: number
    match_max_amount?: number
    auto_status: ReceiptRule['auto_status']
    set_vendor_name?: string
    set_expense_category?: ReceiptRule['set_expense_category']
  },
  userId: string,
  isInsert = false,
  options: {
    canGovernRules?: boolean
    vendorId?: string | null
  } = {}
) {
  const payload: Record<string, unknown> = {
    name: data.name,
    match_description: data.match_description ?? null,
    match_transaction_type: data.match_transaction_type ?? null,
    match_direction: data.match_direction,
    match_min_amount: data.match_min_amount ?? null,
    match_max_amount: data.match_max_amount ?? null,
    auto_status: data.auto_status,
    set_vendor_name: data.set_vendor_name ?? null,
    set_expense_category: data.set_expense_category ?? null,
    vendor_id: options.vendorId ?? null,
    updated_by: userId,
  }

  if (data.description !== undefined) {
    payload.description = data.description
  } else if (isInsert) {
    payload.description = null
  }

  if (options.canGovernRules) {
    payload.priority = data.priority ?? 1000
    payload.kind = data.kind ?? 'standard'
    if (data.reviewed) {
      payload.reviewed_at = new Date().toISOString()
      payload.reviewed_by = userId
    }
  }

  if (isInsert) {
    payload.created_by = userId
  }

  return payload
}

export async function performCreateReceiptRule(
  userId: string,
  formData: FormData,
  options: { canGovernRules?: boolean } = {}
): Promise<RuleMutationResult> {
  const rawData = getRuleFormData(formData)

  const parsed = receiptRuleSchema.safeParse(rawData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid rule details' }
  }
  if (parsed.data.set_expense_category && parsed.data.match_direction !== 'out') {
    return { error: 'Expense auto-tagging rules must use outgoing direction' }
  }

  const supabase = createAdminClient()
  const vendorId = await resolveReceiptVendorId(supabase, parsed.data.set_vendor_name)

  const { data: rule, error } = await supabase
    .from('receipt_rules')
    .insert(buildRuleWritePayload(parsed.data, userId, true, {
      canGovernRules: options.canGovernRules,
      vendorId,
    }))
    .select('*')
    .single()

  if (error || !rule) {
    console.error('Failed to create rule:', error)
    return { error: 'Failed to create rule.' }
  }

  await enqueueReceiptSystemJob('detect_receipt_rule_conflicts', rule.id)

  return { success: true, rule, canPromptRetro: true }
}

// ---------------------------------------------------------------------------
// updateReceiptRule
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performUpdateReceiptRule(
  userId: string,
  ruleId: string,
  formData: FormData,
  options: { canGovernRules?: boolean } = {}
): Promise<RuleMutationResult> {
  const rawData = getRuleFormData(formData)

  const parsed = receiptRuleSchema.safeParse(rawData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid rule details' }
  }
  if (parsed.data.set_expense_category && parsed.data.match_direction !== 'out') {
    return { error: 'Expense auto-tagging rules must use outgoing direction' }
  }

  const supabase = createAdminClient()
  const vendorId = await resolveReceiptVendorId(supabase, parsed.data.set_vendor_name)

  const { data: updated, error } = await supabase
    .from('receipt_rules')
    .update(buildRuleWritePayload(parsed.data, userId, false, {
      canGovernRules: options.canGovernRules,
      vendorId,
    }))
    .eq('id', ruleId)
    .select('*')
    .maybeSingle()

  if (error) {
    return { error: 'Failed to update rule.' }
  }
  if (!updated) {
    return { error: 'Rule not found' }
  }

  await enqueueReceiptSystemJob('detect_receipt_rule_conflicts', updated.id)

  return { success: true, rule: updated, canPromptRetro: true }
}

// ---------------------------------------------------------------------------
// toggleReceiptRule
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performToggleReceiptRule(
  ruleId: string,
  isActive: boolean,
  userId?: string
): Promise<{ success?: boolean; error?: string; rule?: ReceiptRule; warning?: string }> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()
  const { data: updated, error } = await supabase
    .from('receipt_rules')
    .update({
      is_active: isActive,
      deactivated_at: isActive ? null : now,
      deactivated_by: isActive ? null : userId ?? null,
    })
    .eq('id', ruleId)
    .select('*')
    .maybeSingle()

  if (error) {
    return { error: 'Failed to update rule status.' }
  }
  if (!updated) {
    return { error: 'Rule not found' }
  }

  let warning: string | undefined
  if (isActive) {
    // The rule is switched on whatever happens next, so a failed re-run is a warning, not an error.
    try {
      await refreshAutomationForPendingTransactions({ performedBy: userId ?? null })
    } catch (refreshError) {
      console.error('Failed to re-run rules after enabling a rule', refreshError)
      warning = 'The rule is on, but it could not be run over the pending transactions. Run it from the rules list.'
    }
  }

  await enqueueReceiptSystemJob('detect_receipt_rule_conflicts', updated.id)

  return { success: true, rule: updated, warning }
}

// ---------------------------------------------------------------------------
// deleteReceiptRule
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

export async function performDeleteReceiptRule(
  ruleId: string,
  userId?: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = createAdminClient()
  const { data: updated, error } = await supabase
    .from('receipt_rules')
    .update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
      deactivated_by: userId ?? null,
    })
    .eq('id', ruleId)
    .select('id')
    .maybeSingle()

  if (error) {
    return { error: 'Failed to deactivate rule.' }
  }

  if (!updated) {
    return { error: 'Rule not found' }
  }

  await enqueueReceiptSystemJob('detect_receipt_rule_conflicts', ruleId)

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

  let bulkVendorId: string | null = null
  if (vendorProvided) {
    bulkVendorId = normalizedVendor ? await resolveReceiptVendorId(supabase, normalizedVendor) : null
  }

  const summaryParts: string[] = []
  if (vendorProvided) {
    summaryParts.push(normalizedVendor ? `Vendor → ${normalizedVendor}` : 'Vendor cleared')
  }
  if (expenseProvided) {
    summaryParts.push(normalizedExpense ? `Expense → ${normalizedExpense}` : 'Expense cleared')
  }

  const note = `Bulk classification: ${summaryParts.join(' | ')}`

  const { data: rpcResult, error: rpcError } = await supabase.rpc('apply_receipt_group_classification_atomic', {
    p_details: parsed.data.details,
    p_statuses: statuses,
    p_vendor_provided: vendorProvided,
    p_vendor_id: bulkVendorId,
    p_vendor_name: normalizedVendor ?? null,
    p_expense_provided: expenseProvided,
    p_expense_category: normalizedExpense ?? null,
    p_user_id: userId,
    p_note: note,
  })

  if (rpcError) {
    console.error('Failed to apply bulk classification atomically', rpcError)
    return { error: 'Failed to apply changes' }
  }

  const updated = Number((rpcResult as any)?.updated ?? 0)
  const skippedIncomingCount = Number((rpcResult as any)?.skippedIncomingCount ?? 0)

  if (updated > 0) {
    await enqueueReceiptSystemJob('suggest_receipt_rules', new Date().toISOString().slice(0, 10))
  }

  return { success: true, updated, skippedIncomingCount }
}

// ---------------------------------------------------------------------------
// requeueUnclassifiedTransactions
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

type UnclassifiedTransactionRow = { id: string; batch_id: string | null }

export async function performRequeueUnclassifiedTransactions(): Promise<{ success: boolean; queued?: number; error?: string }> {
  const supabase = createAdminClient()

  let vendorMissing: UnclassifiedTransactionRow[]
  let expenseMissing: UnclassifiedTransactionRow[]

  // Both reads page in 1,000s and order by id: Supabase caps a single request at
  // 1,000 rows without saying so, and an unordered read would re-queue the same
  // rows on every click instead of working through the backlog.
  try {
    // Query 1: transactions with no vendor classification at all
    vendorMissing = await fetchAllRows<UnclassifiedTransactionRow>(
      (from, to) =>
        supabase
          .from('receipt_transactions')
          .select('id, batch_id')
          .is('vendor_name', null)
          .is('vendor_source', null)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'vendor-unclassified transactions for requeue' }
    )

    // Query 2: outgoing transactions that have a vendor but no expense category
    expenseMissing = await fetchAllRows<UnclassifiedTransactionRow>(
      (from, to) =>
        supabase
          .from('receipt_transactions')
          .select('id, batch_id')
          .is('expense_category', null)
          .is('expense_category_source', null)
          .not('amount_out', 'is', null)
          .gt('amount_out', 0)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'expense-unclassified transactions for requeue' }
    )
  } catch (err) {
    console.error('Failed to load unclassified transactions for requeue', err)
    return { success: false, error: 'Failed to load transactions' }
  }

  // Merge and de-duplicate by ID
  const seenIds = new Set<string>()
  const rows: Array<{ id: string; batch_id: string | null }> = []
  for (const row of [...vendorMissing, ...expenseMissing]) {
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
    // The button reports this as a number of transactions, so return transactions,
    // not the ten-transaction jobs they travel in.
    return { success: true, queued: result.queuedTransactions }
  } catch (err) {
    console.error('Failed to enqueue requeue jobs', err)
    return { success: false, error: 'Failed to queue classification jobs' }
  }
}
