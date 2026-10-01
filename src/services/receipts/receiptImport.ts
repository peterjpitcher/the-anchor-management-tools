/**
 * Statement import.
 *
 * The file is read strictly, with every record accounted for (statementParsing.ts). The batch,
 * its lines, their history rows and one follow-up job are then written by a single database
 * function (`import_receipt_statement`), so an import is either wholly there or not there at
 * all, and the work that follows it cannot be lost.
 *
 * That follow-up work (rules, then AI classification, invoice matching and the duplicate check)
 * is run straight away so the screen shows classified lines, and it is also sitting in the job
 * queue: if this request dies part-way, the queue finishes it. Every step is safe to repeat.
 *
 * @requires Caller must verify user auth and 'receipts.manage' permission.
 */

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { jobQueue } from '@/lib/unified-job-queue'
import type { ReceiptBatch, ReceiptSourceType } from '@/types/database'

import { RECEIPT_AI_JOB_CHUNK_SIZE } from './types'
import type { ParsedTransactionRow } from './types'
import { chunkArray } from './receiptHelpers'
import {
  parseAmexStatement,
  parseBankStatement,
  type RejectedStatementRecord,
  type StatementParseResult,
} from './statementParsing'
import { applyAutomationRules } from './receiptAutomation'

export type ReceiptBatchFollowupStatus = 'queued' | 'running' | 'done' | 'failed'

export type ImportStatementResult = {
  success?: boolean
  error?: string
  /** New payments stored by this upload. */
  inserted?: number
  /** Lines in the file that were already held. */
  skipped?: number
  /** Data records in the file. Always inserted + skipped + rejected. */
  recordsInFile?: number
  /** Records that could not be read, with the record number and why. */
  rejected?: RejectedStatementRecord[]
  /** Records identical to an earlier one in the same file, kept as separate payments. */
  repeatedInFile?: number
  autoApplied?: number
  autoClassified?: number
  batch?: ReceiptBatch | null
  warning?: string
  /** The file had been imported before. `inserted` says whether this upload still added lines. */
  alreadyImported?: boolean
  followupStatus?: ReceiptBatchFollowupStatus
}

const RECONCILE_JOB_CHUNK_SIZE = 100
/** A follow-up marked running more recently than this is assumed to still be running. */
const FOLLOWUP_RUNNING_GRACE_MS = 2 * 60 * 1000

function toRpcRow(row: ParsedTransactionRow, sourceType: ReceiptSourceType): Record<string, unknown> {
  return {
    source_type: row.sourceType ?? sourceType,
    transaction_date: row.transactionDate,
    details: row.details,
    transaction_type: row.transactionType,
    amount_in: row.amountIn,
    amount_out: row.amountOut,
    balance: row.balance,
    dedupe_hash: row.dedupeHash,
    status: row.status ?? 'pending',
    receipt_required: row.receiptRequired ?? true,
    card_member: row.cardMember ?? null,
    card_account: row.cardAccount ?? null,
    merchant_category: row.merchantCategory ?? null,
    merchant_town: row.merchantTown ?? null,
    external_reference: row.externalReference ?? null,
    vendor_name: row.vendorName ?? null,
    vendor_source: row.vendorSource ?? null,
    expense_category: row.expenseCategory ?? null,
    expense_category_source: row.expenseCategorySource ?? null,
  }
}

function describeRejected(rejected: RejectedStatementRecord[]): string {
  const first = rejected[0]
  const lead = rejected.length === 1 ? '1 record could not be read' : `${rejected.length} records could not be read`
  return `${lead}. Record ${first.record}: ${first.message}.`
}

export async function performImportReceiptStatement(
  userId: string,
  _userEmail: string,
  receiptFile: File,
  buffer: Buffer,
  sourceType: ReceiptSourceType = 'bank'
): Promise<ImportStatementResult> {
  let parsed: StatementParseResult
  try {
    parsed = sourceType === 'amex' ? parseAmexStatement(buffer) : parseBankStatement(buffer)
  } catch (parseError) {
    return {
      error: parseError instanceof Error ? parseError.message : 'Could not read the CSV file.',
    }
  }

  if (!parsed.rows.length) {
    if (parsed.rejected.length) {
      return {
        error: `Nothing was imported: ${describeRejected(parsed.rejected)}`,
        recordsInFile: parsed.recordsInFile,
        rejected: parsed.rejected,
      }
    }
    return { error: 'No transactions were found in the CSV file.' }
  }

  const supabase = createAdminClient()
  const sourceHash = createHash('sha256').update(buffer).digest('hex')

  const { data, error } = await (supabase as any).rpc('import_receipt_statement', {
    p_batch: {
      source_type: sourceType,
      source_hash: sourceHash,
      original_filename: receiptFile.name,
      uploaded_by: userId,
      records_in_file: parsed.recordsInFile,
      rejected_count: parsed.rejected.length,
      rejected_records: parsed.rejected,
      repeated_in_file: parsed.repeatedInFile,
    },
    p_rows: parsed.rows.map((row) => toRpcRow(row, sourceType)),
  })

  if (error || !data) {
    console.error('Failed to import receipt statement:', error)
    return { error: 'The statement could not be stored. Nothing was imported, so it is safe to upload it again.' }
  }

  const result = data as {
    outcome: 'imported' | 'already_imported'
    batch: ReceiptBatch & { followup_status?: ReceiptBatchFollowupStatus }
    inserted_count: number
    duplicate_count: number
  }

  const inserted = Number(result.inserted_count ?? 0)
  const alreadyImported = result.outcome === 'already_imported'
  const warnings: string[] = []

  if (parsed.rejected.length) {
    warnings.push(describeRejected(parsed.rejected))
  }

  let autoApplied = 0
  let autoClassified = 0
  let followupStatus: ReceiptBatchFollowupStatus = result.batch.followup_status ?? 'done'

  if (followupStatus !== 'done') {
    try {
      const followup = await processReceiptBatchFollowup(result.batch.id, { initiatedBy: userId })
      autoApplied = followup.autoApplied
      autoClassified = followup.autoClassified
      followupStatus = 'done'
    } catch (followupError) {
      // The lines are stored and the same work is queued, so this is a delay, not a loss.
      console.error('Receipt batch follow-up did not finish during the import request:', followupError)
      followupStatus = 'queued'
      warnings.push(
        'The transactions are stored. Rules, AI classification and invoice matching did not finish and will be retried in the background.'
      )
    }
  }

  return {
    success: true,
    inserted,
    skipped: Number(result.duplicate_count ?? 0),
    recordsInFile: parsed.recordsInFile,
    rejected: parsed.rejected,
    repeatedInFile: parsed.repeatedInFile,
    autoApplied,
    autoClassified,
    batch: result.batch,
    alreadyImported,
    followupStatus,
    warning: warnings.join(' ') || undefined,
  }
}

// ---------------------------------------------------------------------------
// The work that follows an import
// ---------------------------------------------------------------------------

type FollowupState = {
  started_at?: string
  rules?: { auto_applied: number; auto_classified: number; conflicts: number; protected: number }
  ai?: { queued_transactions: number }
  reconcile?: { jobs: number }
  duplicates?: boolean
}

export type ReceiptBatchFollowupResult = {
  alreadyDone: boolean
  autoApplied: number
  autoClassified: number
}

async function saveFollowup(
  supabase: ReturnType<typeof createAdminClient>,
  batchId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await (supabase as any).from('receipt_batches').update(patch).eq('id', batchId)
  if (error) {
    throw new Error(`Failed to record receipt batch follow-up state: ${error.message}`)
  }
}

/**
 * Runs, or finishes, the work that follows an import: rules first, then the AI classification,
 * invoice matching and duplicate-check jobs. Called by the import itself and by the queued
 * `process_receipt_batch` job, whichever gets there.
 *
 * Each step records that it is done, so a second run picks up where the first stopped. A step
 * that fails marks the batch `failed`, with the reason, and throws so the queue retries.
 */
export async function processReceiptBatchFollowup(
  batchId: string,
  options: { initiatedBy?: string | null } = {}
): Promise<ReceiptBatchFollowupResult> {
  const supabase = createAdminClient()

  const { data: batch, error: batchError } = await (supabase as any)
    .from('receipt_batches')
    .select('id, uploaded_by, followup_status, followup_state')
    .eq('id', batchId)
    .maybeSingle()

  if (batchError) {
    throw new Error(`Failed to load receipt batch ${batchId}: ${batchError.message}`)
  }
  if (!batch) {
    throw new Error(`Receipt batch ${batchId} not found`)
  }

  const state: FollowupState = { ...((batch.followup_state as FollowupState | null) ?? {}) }
  const summary = (): ReceiptBatchFollowupResult => ({
    alreadyDone: false,
    autoApplied: state.rules?.auto_applied ?? 0,
    autoClassified: state.rules?.auto_classified ?? 0,
  })

  if (batch.followup_status === 'done') {
    return { ...summary(), alreadyDone: true }
  }

  // The import request and the queued job can both arrive. The second one waits its turn.
  if (batch.followup_status === 'running' && state.started_at) {
    const age = Date.now() - new Date(state.started_at).getTime()
    if (Number.isFinite(age) && age < FOLLOWUP_RUNNING_GRACE_MS) {
      throw new Error('Receipt batch follow-up is already running')
    }
  }

  const performedBy = options.initiatedBy ?? (batch.uploaded_by as string | null) ?? null
  state.started_at = new Date().toISOString()
  await saveFollowup(supabase, batchId, { followup_status: 'running', followup_state: state, followup_error: null })

  try {
    const rows = await fetchAllRows<{ id: string }>(
      (from, to) =>
        supabase
          .from('receipt_transactions')
          .select('id')
          .eq('batch_id', batchId)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'receipt batch transactions for follow-up' }
    )
    const ids = rows.map((row) => row.id)

    // Rules always finish before the AI is asked: it only looks at what the rules left blank.
    if (!state.rules) {
      const result = await applyAutomationRules(ids, { performedBy })
      if (result.failed > 0) {
        throw new Error(`Rules could not be applied to ${result.failed} transactions`)
      }
      state.rules = {
        auto_applied: result.statusAutoUpdated,
        auto_classified: result.classificationUpdated,
        conflicts: result.conflicts,
        protected: result.protectedCount,
      }
      await saveFollowup(supabase, batchId, { followup_state: state })
    }

    if (!state.ai) {
      const chunks = chunkArray(ids, RECEIPT_AI_JOB_CHUNK_SIZE)
      const results = await Promise.all(
        chunks.map((chunk, index) =>
          jobQueue.enqueue(
            'classify_receipt_transactions',
            { transactionIds: chunk, batchId },
            // Below SMS, and keyed so a retry of this follow-up cannot queue the chunk twice.
            { priority: -10, unique: `receipts:classify:${batchId}:${index}` }
          )
        )
      )
      const failed = results.filter((result) => !result.success).length
      if (failed > 0) {
        throw new Error(`AI classification could not be queued for ${failed} of ${chunks.length} groups of transactions`)
      }
      state.ai = { queued_transactions: ids.length }
      await saveFollowup(supabase, batchId, { followup_state: state })
    }

    if (!state.reconcile) {
      // In hundreds: one job carrying every id put them all into a single URL filter.
      const chunks = chunkArray(ids, RECONCILE_JOB_CHUNK_SIZE)
      const results = await Promise.all(
        chunks.map((chunk, index) =>
          jobQueue.enqueue(
            'reconcile_receipt_invoice_payments',
            { transaction_ids: chunk, initiated_by: performedBy },
            { priority: -10, unique: `receipts:reconcile_receipt_invoice_payments:${batchId}:${index}` }
          )
        )
      )
      if (results.some((result) => !result.success)) {
        throw new Error('Invoice matching could not be queued')
      }
      state.reconcile = { jobs: chunks.length }
      await saveFollowup(supabase, batchId, { followup_state: state })
    }

    if (!state.duplicates) {
      const result = await jobQueue.enqueue(
        'refresh_receipt_duplicate_candidates',
        {},
        { priority: -10, unique: `receipts:refresh_receipt_duplicate_candidates:${batchId}` }
      )
      if (!result.success) {
        throw new Error('The duplicate check could not be queued')
      }
      state.duplicates = true
    }

    await saveFollowup(supabase, batchId, {
      followup_status: 'done',
      followup_state: state,
      followup_error: null,
      followup_completed_at: new Date().toISOString(),
    })

    return summary()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Follow-up failed'
    try {
      await saveFollowup(supabase, batchId, { followup_status: 'failed', followup_state: state, followup_error: message })
    } catch (saveError) {
      console.error('Failed to record a failed receipt batch follow-up', saveError)
    }
    throw error
  }
}
