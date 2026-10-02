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
  chunkArray,
  isIncomingOnlyTransaction,
  buildRuleSuggestion,
  composeReceiptFileArtifacts,
  receiptUploadMetadataSchema,
  receiptUploadedObjectSchema,
  classificationUpdateSchema,
  toOptionalNumber,
} from './receiptHelpers'
import { normalizeReceiptVendorKey } from './vendorInsights'
import { recordReceiptClassificationSignals } from './receiptGovernance'
import {
  resolveVendorForPersonWrite,
  type ResolvedReceiptVendor,
  type VendorConfirmation,
} from './receiptVendors'
import { applyAutomationRules, refreshAutomationForPendingTransactions } from './receiptAutomation'
import { findDuplicateRule, ruleBehaviourChanged } from '@/lib/receipts/rule-identity'
import { NO_CATEGORY_VALUE } from '@/lib/receipts/no-category'
import { RECEIPT_AI_PROMPT_VERSION } from '@/lib/receipts/ai-client'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { sniffReceiptMimeType } from '@/lib/receipts/upload-constraints'

// The rule engine lives in receiptAutomation.ts and the statement import in receiptImport.ts.
// Re-exported so existing imports keep working.
export { applyAutomationRules, refreshAutomationForPendingTransactions }
export { performImportReceiptStatement, processReceiptBatchFollowup } from './receiptImport'
export type { ImportStatementResult, ReceiptBatchFollowupStatus } from './receiptImport'

/** Queues one receipts background job. Returns false, having logged why, when it could not. */
export async function enqueueReceiptSystemJob(
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
  batchId: string,
  options: { retryFinalFailures?: boolean } = {}
): Promise<{ queued: number; failed: number; queuedTransactions: number }> {
  if (!transactionIds.length) {
    return { queued: 0, failed: 0, queuedTransactions: 0 }
  }

  const chunks = chunkArray(transactionIds, RECEIPT_AI_JOB_CHUNK_SIZE)
  const results = await Promise.all(
    chunks.map((chunk) =>
      jobQueue.enqueue(
        'classify_receipt_transactions',
        {
          transactionIds: chunk,
          batchId,
          ...(options.retryFinalFailures ? { retryFinalFailures: true } : {}),
        },
        // Below messages in the queue, and keyed on the payments so a second click while the
        // first is still waiting does not queue them twice.
        { priority: -10, unique: `receipts:classify:${chunk[0]}:${chunk.length}:${chunk[chunk.length - 1]}` }
      )
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

/** Why a payment is completed with no file on it. Kept to what the column holds. */
const COMPLETED_REASON_MAX = 500

/**
 * Changes a payment's status by hand. Completing a payment needs a file on it, or a reason: the
 * check, the change and the history row are one database transaction
 * (`mark_receipt_transaction`). The note is not touched: it has its own action.
 */
export async function performMarkReceiptTransaction(
  userId: string,
  userEmail: string,
  input: {
    transactionId: string
    status: ReceiptTransaction['status']
    /** Why it is complete without a receipt. Ignored for any other status. */
    reason?: string | null
  }
): Promise<{
  success?: boolean
  error?: string
  /** Nothing was changed: the payment has no file, so a reason is needed to complete it. */
  reasonRequired?: boolean
  transaction?: ReceiptTransaction
}> {
  const validation = receiptMarkSchema.safeParse({
    transaction_id: input.transactionId,
    status: input.status,
  })

  if (!validation.success) {
    return { error: validation.error.issues[0]?.message ?? 'Invalid data' }
  }

  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason.length > COMPLETED_REASON_MAX) {
    return { error: `Keep the reason under ${COMPLETED_REASON_MAX} characters.` }
  }

  const supabase = createAdminClient()

  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single()

  const { data, error } = await (supabase as any).rpc('mark_receipt_transaction', {
    p_transaction_id: input.transactionId,
    p_status: validation.data.status,
    p_reason: reason || null,
    p_user_id: userId,
    p_user_email: userEmail,
    p_user_name: profile?.full_name ?? null,
  })

  if (error || !data) {
    console.error('Failed to update receipt transaction:', error)
    return { error: 'Failed to update the transaction.' }
  }

  const outcome = (data as { outcome?: string }).outcome
  if (outcome === 'reason_required') {
    return {
      error: 'This transaction has no receipt. Add one, or say why there is none.',
      reasonRequired: true,
    }
  }
  if (outcome === 'not_found') {
    return { error: 'Transaction not found' }
  }
  if (outcome !== 'updated') {
    return { error: 'Failed to update the transaction.' }
  }

  return { success: true, transaction: (data as { transaction: ReceiptTransaction }).transaction }
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
    /** With no category: the person has decided this payment takes none. */
    noCategoryApplies?: boolean
    /** The person has confirmed that a name not on the vendor list is a new vendor. */
    createVendor?: boolean
  }
): Promise<{
  success?: boolean
  changed?: boolean
  error?: string
  transaction?: ReceiptTransaction
  ruleSuggestion?: any
  /** The name is not on the vendor list. Nothing was saved; ask, then send again. */
  vendorConfirmation?: VendorConfirmation
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
    noCategoryApplies: hasExpenseField ? Boolean(input.noCategoryApplies) : undefined,
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

  // "No category applies" is the absence of a category, decided. A category given with it wins.
  const noCategoryApplies = hasExpenseField && !expenseCategory && Boolean(validation.data.noCategoryApplies)

  if (hasExpenseField && (expenseCategory || noCategoryApplies) && isIncomingOnlyTransaction(transaction)) {
    return { error: 'Expense categories can only be set on outgoing transactions' }
  }

  const updatePayload: Record<string, unknown> = {}
  const changeNotes: string[] = []
  const now = new Date().toISOString()
  let vendorChanged = false
  let expenseChanged = false

  // The name saved on the payment is the vendor's own, whatever spelling was typed.
  let resolvedVendor: ResolvedReceiptVendor | null = null
  if (hasVendorField && vendorName) {
    try {
      const resolution = await resolveVendorForPersonWrite(supabase, vendorName, { createVendor: input.createVendor })
      if (resolution.outcome === 'unknown') {
        return { vendorConfirmation: resolution.confirmation }
      }
      resolvedVendor = resolution.vendor
    } catch (vendorError) {
      console.error('Failed to resolve vendor for a manual classification', vendorError)
      return { error: 'The vendor could not be looked up. Nothing was changed.' }
    }
  }
  const nextVendorName = resolvedVendor?.canonicalName ?? null
  const nextVendorId = resolvedVendor?.id ?? null

  if (hasVendorField) {
    const currentVendor = transaction.vendor_name ?? null
    if (currentVendor !== nextVendorName || (transaction.vendor_id ?? null) !== nextVendorId) {
      updatePayload.vendor_name = nextVendorName
      updatePayload.vendor_id = nextVendorId
      // A value a person clears is still that person's decision, so the source stays manual
      // and no rule or AI run fills it back in.
      updatePayload.vendor_source = 'manual' satisfies ReceiptClassificationSource
      updatePayload.vendor_rule_id = null
      updatePayload.vendor_updated_at = now
      changeNotes.push(nextVendorName ? `Vendor → ${nextVendorName}` : 'Vendor cleared')
      vendorChanged = true
    }
  }

  if (hasExpenseField) {
    const currentExpense = transaction.expense_category ?? null
    const currentNoCategory = Boolean(transaction.no_category_applies)
    if (currentExpense !== (expenseCategory ?? null) || currentNoCategory !== noCategoryApplies) {
      updatePayload.expense_category = expenseCategory ?? null
      // The flag is written only when it is being set or cleared, so a payment that never had it
      // is saved exactly as before.
      if (noCategoryApplies || currentNoCategory) {
        updatePayload.no_category_applies = noCategoryApplies
      }
      updatePayload.expense_category_source = 'manual' satisfies ReceiptClassificationSource
      updatePayload.expense_rule_id = null
      updatePayload.expense_updated_at = now
      changeNotes.push(
        expenseCategory ? `Expense → ${expenseCategory}` : noCategoryApplies ? 'Expense → no category applies' : 'Expense cleared'
      )
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

  await enqueueReceiptSystemJob('suggest_receipt_rules', getTodayIsoDate())

  const ruleSuggestion = buildRuleSuggestion(updated, {
    vendorName: vendorChanged ? nextVendorName : undefined,
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
// Receipt uploads: issue a place to upload to, then attach what was stored
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

/** Another payment that already carries the same file. */
export type DuplicateReceiptPayment = {
  transactionId: string
  transactionDate: string
  details: string
  amount: number | null
  fileName: string | null
}

export type DuplicateReceiptWarning = {
  /** How many other payments carry this file. The list holds the ten most recent. */
  count: number
  payments: DuplicateReceiptPayment[]
}

export async function performCompleteReceiptUpload(
  userId: string,
  userEmail: string,
  input: ReceiptUploadedObjectInput & {
    /** The person has seen the duplicate warning and wants the file attached anyway. */
    confirmDuplicate?: boolean
  }
): Promise<{
  success?: boolean
  error?: string
  receipt?: any
  /** The same file is already on other payments. Nothing was written; confirm or cancel. */
  duplicate?: DuplicateReceiptWarning
}> {
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

  // The stored bytes are read back: the hash is what the duplicate check compares, and the size
  // recorded is the size of what was stored, not what the browser said it would send.
  let contentHash: string | null = null
  let storedSize: number | null = null
  let storedType: string | null = null
  const { data: storedFile, error: downloadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .download(storagePath)
  if (!downloadError && storedFile) {
    const bytes = Buffer.from(await storedFile.arrayBuffer())
    if (bytes.length > 0) {
      storedSize = bytes.length
      storedType = sniffReceiptMimeType(bytes)
      contentHash = createHash('sha256').update(bytes).digest('hex')
    }
  }

  if (storedType === 'image/heic') {
    // The browser turns an iPhone photo into a JPEG before sending it. One that arrives as it
    // was cannot be opened by everyone who needs to see it, so it is not kept.
    await releaseUnattachedReceiptUpload(supabase, input.transactionId, storagePath, userId)
    return {
      error:
        'This iPhone photo (HEIC) was not converted before it was sent. Reload the page and upload it again, or upload a screenshot of it.',
    }
  }

  if (!contentHash) {
    // A file that cannot be read cannot be checked against the others, and may not be there at
    // all. Nothing is attached.
    console.error('Uploaded receipt could not be read back', { storagePath, downloadError })
    await releaseUnattachedReceiptUpload(supabase, input.transactionId, storagePath, userId)
    return { error: 'The uploaded file could not be read. Nothing was attached. Please upload it again.' }
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
    // What the bytes say the file is, where they say anything; otherwise what the browser said.
    p_mime_type: storedType ?? validation.data.fileType,
    p_file_size_bytes: storedSize ?? validation.data.fileSize,
    p_content_hash: contentHash,
    p_duplicate: input.confirmDuplicate ? 'confirmed' : 'check',
  })

  if (rpcError) {
    console.error('Failed to complete receipt upload:', rpcError)
    await releaseUnattachedReceiptUpload(supabase, input.transactionId, storagePath, userId)
    return { error: 'Failed to store receipt metadata.' }
  }

  const outcome = (rpcResult as { outcome?: string } | null)?.outcome
  const receipt = (rpcResult as { receipt?: Record<string, unknown> } | null)?.receipt ?? null

  if (outcome === 'duplicate') {
    // Nothing was written and the upload is still open. The person decides: attach it anyway
    // (the same call again, confirmed) or cancel, which removes the stored object.
    const payments = Array.isArray((rpcResult as { payments?: unknown }).payments)
      ? ((rpcResult as { payments: Array<Record<string, unknown>> }).payments)
      : []
    return {
      duplicate: {
        count: Number((rpcResult as { count?: number }).count ?? payments.length),
        payments: payments.map((payment) => ({
          transactionId: String(payment.transaction_id ?? ''),
          transactionDate: String(payment.transaction_date ?? ''),
          details: String(payment.details ?? ''),
          amount: payment.amount === null || payment.amount === undefined ? null : Number(payment.amount),
          fileName: typeof payment.file_name === 'string' ? payment.file_name : null,
        })),
      },
    }
  }

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
 * Cancels an upload that was warned about as a duplicate: the open upload is released and its
 * stored object removed. Safe to call for a path that was never issued, or already attached:
 * the database decides, and nothing is removed unless it says the upload was the caller's and
 * still open.
 */
export async function performCancelReceiptUpload(
  userId: string,
  input: { transactionId: string; storagePath: string }
): Promise<{ success: boolean }> {
  if (typeof input.storagePath !== 'string' || !input.storagePath || typeof input.transactionId !== 'string') {
    return { success: false }
  }
  const supabase = createAdminClient()
  await releaseUnattachedReceiptUpload(supabase, input.transactionId, input.storagePath, userId)
  return { success: true }
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

// ---------------------------------------------------------------------------
// deleteReceiptFile
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

/**
 * Removes a file from a payment. The file row, the payment's status and its history move
 * together in the database (`delete_receipt_file`); the stored object is removed afterwards.
 *
 * It used to be the other way round, step by step: a failure part-way could leave a payment
 * marked completed with nothing behind it. If the object cannot be removed now, nothing
 * references it any longer and the storage sweep collects it.
 */
export async function performDeleteReceiptFile(
  userId: string,
  fileId: string
): Promise<{
  success?: boolean
  error?: string
  transactionId?: string
  /** The payment's status after the file went. */
  newStatus?: ReceiptTransaction['status']
  remainingFiles?: number
}> {
  const supabase = createAdminClient()

  const { data, error } = await (supabase as any).rpc('delete_receipt_file', {
    p_file_id: fileId,
    p_user_id: userId,
  })

  if (error || !data) {
    console.error('Failed to delete receipt file:', error)
    return { error: 'Failed to remove the receipt. Nothing was changed.' }
  }

  if (data.outcome === 'not_found') {
    return { error: 'Receipt not found' }
  }
  if (data.outcome !== 'deleted') {
    return { error: 'Failed to remove the receipt. Nothing was changed.' }
  }

  if (data.remove_object && typeof data.storage_path === 'string' && data.storage_path) {
    const { error: storageRemoveError } = await supabase.storage.from(RECEIPT_BUCKET).remove([data.storage_path])
    if (storageRemoveError) {
      console.error('Removed a receipt file but could not remove its stored object', {
        storagePath: data.storage_path,
        storageRemoveError,
      })
    }
  }

  return {
    success: true,
    transactionId: data.transaction_id as string,
    newStatus: data.new_status as ReceiptTransaction['status'],
    remainingFiles: Number(data.remaining_files ?? 0),
  }
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
  const setsNoCategory = formData.get('set_expense_category') === NO_CATEGORY_VALUE
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
    // "No category applies" travels in the category field and is stored as a flag.
    set_expense_category: setsNoCategory ? undefined : optionalRuleText(formData.get('set_expense_category')),
    set_no_category: setsNoCategory,
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
    match_description?: string
    match_transaction_type?: string
    match_direction: ReceiptRule['match_direction']
    match_min_amount?: number
    match_max_amount?: number
    auto_status: ReceiptRule['auto_status']
    set_vendor_name?: string
    set_expense_category?: ReceiptRule['set_expense_category']
    set_no_category?: boolean
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
    set_no_category: Boolean(data.set_no_category),
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
  }

  if (isInsert) {
    payload.created_by = userId
  }

  return payload
}

/**
 * What a save does to a rule's review mark: the columns to add to the write, or nothing to
 * leave the mark as it is.
 *
 * Only someone who governs rules is shown the "Mark reviewed" box, and for them the box is the
 * answer. Ticked marks the rule reviewed by them now, unless it is already reviewed and still
 * matches and does the same thing, in which case the earlier review stands. Unticked clears it.
 *
 * Anyone else cannot set the mark, whatever their form sends. A review covers what the rule
 * matched and did when it was reviewed, though, so their change to either still clears it.
 */
function ruleReviewWrite(input: {
  ticked: boolean
  canGovernRules: boolean
  userId: string
  /** The stored rule on an update. A new rule has none. */
  current?: Pick<ReceiptRule, 'reviewed_at'>
  behaviourChanged?: boolean
}): { reviewed_at?: string | null; reviewed_by?: string | null } {
  const cleared = { reviewed_at: null, reviewed_by: null }

  if (!input.canGovernRules) {
    return input.behaviourChanged ? cleared : {}
  }
  if (!input.ticked) {
    return input.current ? cleared : {}
  }
  if (input.current?.reviewed_at && !input.behaviourChanged) {
    return {}
  }
  return { reviewed_at: new Date().toISOString(), reviewed_by: input.userId }
}

/**
 * The vendor a rule sets, tied to the vendor list. A name that is not on the list is created
 * only when the form carries `create_vendor=true`, which the screen sends after asking.
 */
async function resolveRuleVendor(
  supabase: ReturnType<typeof createAdminClient>,
  vendorName: string | undefined,
  formData: FormData
): Promise<
  | { vendorId: string | null; vendorName: string | null }
  | { error: string }
  | { vendorConfirmation: VendorConfirmation }
> {
  const name = typeof vendorName === 'string' ? vendorName.trim() : ''
  if (!name) return { vendorId: null, vendorName: null }

  try {
    const resolution = await resolveVendorForPersonWrite(supabase, name, {
      createVendor: formData.get('create_vendor') === 'true',
    })
    if (resolution.outcome === 'unknown') {
      return { vendorConfirmation: resolution.confirmation }
    }
    return { vendorId: resolution.vendor.id, vendorName: resolution.vendor.canonicalName }
  } catch (vendorError) {
    console.error('Failed to resolve vendor for a receipt rule', vendorError)
    return { error: 'The vendor could not be looked up. The rule was not saved.' }
  }
}

/** Every rule, on or off: a duplicate of a switched-off rule is still a duplicate. */
async function loadRulesForDuplicateCheck(supabase: ReturnType<typeof createAdminClient>): Promise<ReceiptRule[] | null> {
  const { data, error } = await supabase.from('receipt_rules').select('*')
  if (error) {
    console.error('Failed to load rules for the duplicate check', error)
    return null
  }
  return (data ?? []) as ReceiptRule[]
}

function duplicateRuleMessage(existing: ReceiptRule): string {
  return existing.is_active
    ? `A rule with the same match and result already exists: "${existing.name}".`
    : `A rule with the same match and result already exists but is switched off: "${existing.name}". Switch that one on instead.`
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
  if ((parsed.data.set_expense_category || parsed.data.set_no_category) && parsed.data.match_direction !== 'out') {
    return { error: 'Expense auto-tagging rules must use outgoing direction' }
  }

  const supabase = createAdminClient()
  const ruleVendor = await resolveRuleVendor(supabase, parsed.data.set_vendor_name, formData)
  if ('error' in ruleVendor || 'vendorConfirmation' in ruleVendor) {
    return ruleVendor
  }
  const vendorId = ruleVendor.vendorId
  const ruleData = { ...parsed.data, set_vendor_name: ruleVendor.vendorName ?? undefined }

  const existingRules = await loadRulesForDuplicateCheck(supabase)
  if (!existingRules) {
    return { error: 'The existing rules could not be checked. The rule was not saved.' }
  }
  const duplicate = findDuplicateRule(existingRules, { ...ruleData, vendor_id: vendorId })
  if (duplicate) {
    return { error: duplicateRuleMessage(duplicate) }
  }

  const { data: rule, error } = await supabase
    .from('receipt_rules')
    .insert({
      ...buildRuleWritePayload(ruleData, userId, true, {
        canGovernRules: options.canGovernRules,
        vendorId,
      }),
      ...ruleReviewWrite({
        ticked: Boolean(ruleData.reviewed),
        canGovernRules: Boolean(options.canGovernRules),
        userId,
      }),
    })
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
  if ((parsed.data.set_expense_category || parsed.data.set_no_category) && parsed.data.match_direction !== 'out') {
    return { error: 'Expense auto-tagging rules must use outgoing direction' }
  }

  const supabase = createAdminClient()
  const ruleVendor = await resolveRuleVendor(supabase, parsed.data.set_vendor_name, formData)
  if ('error' in ruleVendor || 'vendorConfirmation' in ruleVendor) {
    return ruleVendor
  }
  const vendorId = ruleVendor.vendorId
  const ruleData = { ...parsed.data, set_vendor_name: ruleVendor.vendorName ?? undefined }

  const existingRules = await loadRulesForDuplicateCheck(supabase)
  if (!existingRules) {
    return { error: 'The existing rules could not be checked. The rule was not saved.' }
  }
  const current = existingRules.find((rule) => rule.id === ruleId)
  if (!current) {
    return { error: 'Rule not found' }
  }
  const duplicate = findDuplicateRule(existingRules, { ...ruleData, vendor_id: vendorId }, ruleId)
  if (duplicate) {
    return { error: duplicateRuleMessage(duplicate) }
  }

  const payload = {
    ...buildRuleWritePayload(ruleData, userId, false, {
      canGovernRules: options.canGovernRules,
      vendorId,
    }),
    ...ruleReviewWrite({
      ticked: Boolean(ruleData.reviewed),
      canGovernRules: Boolean(options.canGovernRules),
      userId,
      current,
      behaviourChanged: ruleBehaviourChanged(current, { ...ruleData, vendor_id: vendorId }),
    }),
  }

  const { data: updated, error } = await supabase
    .from('receipt_rules')
    .update(payload)
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
// applyReceiptGroupClassification
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// requeueUnclassifiedTransactions
// @requires Caller must verify user auth and 'receipts.manage' permission
// ---------------------------------------------------------------------------

type UnclassifiedTransactionRow = { id: string; batch_id: string | null }

/**
 * Queues AI classification for payments that still need a vendor or a category and have not
 * been asked about under the current prompt. A payment the AI has already answered for, found
 * nothing for, or that a person must check, is not sent again: the button used to re-send every
 * unclassified payment on every click, about 5,000 of them.
 *
 * `retryFinalFailures` also re-sends payments whose last try failed for good, for when the cause
 * (a bad API key, say) has been put right.
 */
export async function performRequeueUnclassifiedTransactions(
  options: { retryFinalFailures?: boolean } = {}
): Promise<{ success: boolean; queued?: number; alreadyAsked?: number; error?: string }> {
  const supabase = createAdminClient()

  let vendorMissing: UnclassifiedTransactionRow[]
  let expenseMissing: UnclassifiedTransactionRow[]
  let attempts: Array<{ transaction_id: string; outcome: string }>

  // The reads page in 1,000s and order by id: Supabase caps a single request at
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

    // Query 2: outgoing transactions with no expense category, and not marked as taking none
    expenseMissing = await fetchAllRows<UnclassifiedTransactionRow>(
      (from, to) =>
        supabase
          .from('receipt_transactions')
          .select('id, batch_id')
          .is('expense_category', null)
          .is('expense_category_source', null)
          .eq('no_category_applies', false)
          .not('amount_out', 'is', null)
          .gt('amount_out', 0)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'expense-unclassified transactions for requeue' }
    )

    attempts = await fetchAllRows<{ transaction_id: string; outcome: string }>(
      (from, to) =>
        (supabase as any)
          .from('receipt_ai_attempts')
          .select('transaction_id, outcome')
          .eq('prompt_version', RECEIPT_AI_PROMPT_VERSION)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'AI attempts for requeue' }
    )
  } catch (err) {
    console.error('Failed to load unclassified transactions for requeue', err)
    return { success: false, error: 'Failed to load transactions' }
  }

  const attemptByTransaction = new Map(attempts.map((attempt) => [attempt.transaction_id, attempt.outcome]))
  const mayAsk = (id: string): boolean => {
    const outcome = attemptByTransaction.get(id)
    if (!outcome) return true
    if (outcome === 'failed_retryable') return true
    return outcome === 'failed_final' && Boolean(options.retryFinalFailures)
  }

  // Merge and de-duplicate by ID
  const seenIds = new Set<string>()
  const rows: Array<{ id: string; batch_id: string | null }> = []
  let alreadyAsked = 0
  for (const row of [...vendorMissing, ...expenseMissing]) {
    if (seenIds.has(row.id)) continue
    seenIds.add(row.id)
    if (mayAsk(row.id)) {
      rows.push(row)
    } else {
      alreadyAsked += 1
    }
  }

  if (!rows.length) {
    return { success: true, queued: 0, alreadyAsked }
  }

  const ids = rows.map((row) => row.id)
  const batchId = rows[0]?.batch_id ?? 'requeue'

  try {
    const result = await enqueueReceiptAiClassificationJobs(ids, batchId, {
      retryFinalFailures: options.retryFinalFailures,
    })
    // The button reports this as a number of transactions, so return transactions,
    // not the ten-transaction jobs they travel in.
    return { success: true, queued: result.queuedTransactions, alreadyAsked }
  } catch (err) {
    console.error('Failed to enqueue requeue jobs', err)
    return { success: false, error: 'Failed to queue classification jobs' }
  }
}
