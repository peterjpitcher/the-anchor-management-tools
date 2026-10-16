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
import type { ReceiptBatch, ReceiptSourceType, ReceiptTransactionStatus } from '@/types/database'

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
import { checkBalanceContinuity, describeBalanceContinuity } from '@/lib/receipts/statement-continuity'
import { formatDateInLondon } from '@/lib/dateUtils'
import { formatCurrency } from '@/lib/format'

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

  let offered = parsed.rows
  let heldFromAnotherDownload = 0
  let referencesAdded = 0
  if (sourceType === 'amex') {
    try {
      const matched = await matchAmexLinesHeldFromAnotherDownload(supabase, parsed.rows, receiptFile.name, userId)
      offered = matched.toOffer
      heldFromAnotherDownload = matched.alreadyHeld
      referencesAdded = matched.referencesAdded
    } catch (matchError) {
      // Storing the lines unchecked is how one purchase came to be held twice, so refuse instead.
      console.error(
        'Amex lines could not be checked against the payments already held:',
        matchError instanceof Error ? matchError.message : String(matchError)
      )
      return {
        error:
          'The statement could not be checked against the payments already held, so nothing was imported. It is safe to upload it again.',
      }
    }
  }

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
    p_rows: offered.map((row) => toRpcRow(row, sourceType)),
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
    inserted_ids?: string[]
  }

  const inserted = Number(result.inserted_count ?? 0)
  const alreadyImported = result.outcome === 'already_imported'
  const warnings: string[] = []

  if (parsed.rejected.length) {
    warnings.push(describeRejected(parsed.rejected))
  }

  if (heldFromAnotherDownload) {
    const one = heldFromAnotherDownload === 1
    warnings.push(
      `${heldFromAnotherDownload} ${one ? 'line was' : 'lines were'} already held from another download of this statement, so ${
        one ? 'it was' : 'they were'
      } not added again${referencesAdded ? ` (Amex reference numbers added to ${referencesAdded} of them)` : ''}.`
    )
    if (!alreadyImported) {
      // The database function counts only the lines it was offered; keep the batch's own sums whole.
      const { error: countError } = await (supabase as any)
        .from('receipt_batches')
        .update({ duplicate_count: Number(result.batch.duplicate_count ?? 0) + heldFromAnotherDownload })
        .eq('id', result.batch.id)
      if (countError) {
        console.error('Failed to add lines held from another download to the batch count:', countError.message)
      }
    }
  }

  if (sourceType === 'amex' && result.inserted_ids?.length) {
    try {
      const lookalikes = await describeAmexLookalikes(supabase, result.inserted_ids)
      if (lookalikes) warnings.push(lookalikes)
    } catch (lookalikeError) {
      console.error(
        'Amex duplicate check after an import failed:',
        lookalikeError instanceof Error ? lookalikeError.message : String(lookalikeError)
      )
      warnings.push('The new lines could not be checked for duplicates this time.')
    }
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

  if (sourceType === 'bank') {
    try {
      const balanceWarning = await checkBankBalanceAround(supabase, parsed.rows)
      if (balanceWarning) warnings.push(balanceWarning)
    } catch (balanceError) {
      // The statement is stored either way. Saying the check did not run is better than
      // silence, which would read as "the balance joins up".
      console.error(
        'Bank balance check after a statement import failed:',
        balanceError instanceof Error ? balanceError.message : String(balanceError)
      )
      warnings.push('The bank balance could not be checked this time, so missing payments would not have been spotted.')
    }
  }

  return {
    success: true,
    inserted,
    skipped: Number(result.duplicate_count ?? 0) + heldFromAnotherDownload,
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

type HeldAmexRow = {
  id: string
  transaction_date: string
  amount_in: number | null
  amount_out: number | null
  card_account: string | null
  card_member: string | null
  details: string
  external_reference: string | null
  dedupe_hash: string
  status: ReceiptTransactionStatus
}

function pence(value: number | null | undefined): number {
  return Math.round(Number(value ?? 0) * 100)
}

/** An Amex purchase apart from its reference number: the same whichever download it came from. */
function amexIdentity(line: {
  date: string
  amountIn: number | null
  amountOut: number | null
  cardAccount: string | null
  cardMember: string | null
  details: string
}): string {
  return [
    line.date,
    pence(line.amountIn),
    pence(line.amountOut),
    line.cardAccount ?? '',
    (line.cardMember ?? '').trim().toUpperCase(),
    line.details.trim().replace(/\s+/g, ' ').toUpperCase(),
  ].join('|')
}

function heldAmexIdentity(row: HeldAmexRow): string {
  return amexIdentity({
    date: row.transaction_date,
    amountIn: row.amount_in,
    amountOut: row.amount_out,
    cardAccount: row.card_account,
    cardMember: row.card_member,
    details: row.details,
  })
}

/**
 * Amex lines already held from another download of the same statement.
 *
 * An Amex line is recognised by its details including Amex's reference number. A download
 * without reference numbers gives the same purchase different details, so it would be stored a
 * second time: 84 lines were, on 14 October 2026. A line here is the same purchase as a held
 * line when the date, amount, card, card member and description all agree and only one of the
 * two has a reference. When the new line brings the reference, the held line takes it, with the
 * new line's identity, so the next upload of either kind matches it straight away. Identical
 * lines pair one for one, so two genuine purchases of the same thing stay two.
 */
async function matchAmexLinesHeldFromAnotherDownload(
  supabase: ReturnType<typeof createAdminClient>,
  rows: ParsedTransactionRow[],
  filename: string,
  userId: string | null
): Promise<{ toOffer: ParsedTransactionRow[]; alreadyHeld: number; referencesAdded: number }> {
  const hashes = rows.map((row) => row.dedupeHash)
  const heldHashes = new Set<string>()
  for (const chunk of chunkArray(hashes, 100)) {
    // The import hash is unique, so a chunk of hashes matches at most that many lines.
    const { data, error } = await supabase
      .from('receipt_transactions')
      .select('dedupe_hash')
      .in('dedupe_hash', chunk)
      .limit(chunk.length)
    if (error) throw new Error(`Failed to read the lines already held: ${error.message}`)
    for (const row of (data ?? []) as Array<{ dedupe_hash: string }>) heldHashes.add(row.dedupe_hash)
  }

  // Lines held under their own identity are skipped by the import itself.
  const unheld = rows.filter((row) => !heldHashes.has(row.dedupeHash))
  if (!unheld.length) return { toOffer: rows, alreadyHeld: 0, referencesAdded: 0 }

  const dates = unheld.map((row) => row.transactionDate).sort()
  const held = await fetchAllRows<HeldAmexRow>(
    (from, to) =>
      supabase
        .from('receipt_transactions')
        .select('id, transaction_date, amount_in, amount_out, card_account, card_member, details, external_reference, dedupe_hash, status')
        .eq('source_type', 'amex')
        .gte('transaction_date', dates[0])
        .lte('transaction_date', dates[dates.length - 1])
        .order('transaction_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'Amex lines held for the same dates' }
  )

  // A held line that one of this file's own lines already matches cannot stand for another.
  const incoming = new Set(hashes)
  const pool = new Map<string, HeldAmexRow[]>()
  for (const row of held) {
    if (incoming.has(row.dedupe_hash)) continue
    const key = heldAmexIdentity(row)
    pool.set(key, [...(pool.get(key) ?? []), row])
  }

  const alreadyHeld = new Set<ParsedTransactionRow>()
  const adopt: Array<{ row: HeldAmexRow; line: ParsedTransactionRow }> = []
  for (const line of unheld) {
    const candidates = pool.get(
      amexIdentity({
        date: line.transactionDate,
        amountIn: line.amountIn,
        amountOut: line.amountOut,
        cardAccount: line.cardAccount ?? null,
        cardMember: line.cardMember ?? null,
        details: line.details,
      })
    )
    if (!candidates?.length) continue
    const hasReference = Boolean(line.externalReference)
    const index = candidates.findIndex((row) => (hasReference ? !row.external_reference : Boolean(row.external_reference)))
    if (index === -1) continue
    const [row] = candidates.splice(index, 1)
    alreadyHeld.add(line)
    if (hasReference) adopt.push({ row, line })
  }

  let referencesAdded = 0
  for (const { row, line } of adopt) {
    const { data, error } = await supabase
      .from('receipt_transactions')
      .update({ external_reference: line.externalReference, dedupe_hash: line.dedupeHash })
      .eq('id', row.id)
      .is('external_reference', null)
      .select('id')
    if (error || !data?.length) {
      // Someone else's upload got there first, or the held line changed: offer the line to the
      // import as normal, which skips it if it is now held under this identity.
      alreadyHeld.delete(line)
      continue
    }
    referencesAdded += 1
    const { error: logError } = await supabase.from('receipt_transaction_logs').insert({
      transaction_id: row.id,
      previous_status: row.status,
      new_status: row.status,
      action_type: 'reference_added',
      note: `Amex reference ${line.externalReference} added from ${filename}. The line was already held from a download without reference numbers, so it was not stored again.`,
      performed_by: userId,
    })
    if (logError) console.error('Failed to record the Amex reference added to a held line:', logError.message)
  }

  return {
    toOffer: rows.filter((row) => !alreadyHeld.has(row)),
    alreadyHeld: alreadyHeld.size,
    referencesAdded,
  }
}

/** The first letters of a description: enough to tell one shop from another. */
function merchantStem(details: string): string {
  return details.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)
}

/**
 * New Amex lines that look like payments already held: the same date, amount and card, and a
 * description that starts the same way, whatever the held line's status or direction (credits
 * and closed lines included). A statement period appears in one Amex statement only, so a match
 * across uploads is almost always the same purchase downloaded twice.
 */
async function describeAmexLookalikes(
  supabase: ReturnType<typeof createAdminClient>,
  insertedIds: string[]
): Promise<string | null> {
  const fresh: HeldAmexRow[] = []
  for (const chunk of chunkArray(insertedIds, 100)) {
    const { data, error } = await supabase
      .from('receipt_transactions')
      .select('id, transaction_date, amount_in, amount_out, card_account, card_member, details, external_reference, dedupe_hash, status')
      .in('id', chunk)
    if (error) throw new Error(`Failed to read the new lines: ${error.message}`)
    fresh.push(...((data ?? []) as HeldAmexRow[]))
  }
  if (!fresh.length) return null

  const freshIds = new Set(insertedIds)
  const dates = fresh.map((row) => row.transaction_date).sort()
  const others = (
    await fetchAllRows<HeldAmexRow>(
      (from, to) =>
        supabase
          .from('receipt_transactions')
          .select('id, transaction_date, amount_in, amount_out, card_account, card_member, details, external_reference, dedupe_hash, status')
          .eq('source_type', 'amex')
          .gte('transaction_date', dates[0])
          .lte('transaction_date', dates[dates.length - 1])
          .order('transaction_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'Amex lines held for the same dates' }
    )
  ).filter((row) => !freshIds.has(row.id))

  const key = (row: HeldAmexRow) =>
    [row.transaction_date, pence(row.amount_in), pence(row.amount_out), row.card_account ?? '', merchantStem(row.details)].join('|')
  const heldKeys = new Set(others.map(key))
  const lookalikes = fresh.filter((row) => heldKeys.has(key(row)))
  if (!lookalikes.length) return null

  const first = lookalikes[0]
  const amount = formatCurrency(Number(first.amount_out ?? first.amount_in ?? 0))
  const when = formatDateInLondon(first.transaction_date, { day: 'numeric', month: 'long', year: 'numeric' })
  const one = lookalikes.length === 1
  return `${lookalikes.length} new ${one ? 'line looks' : 'lines look'} like ${
    one ? 'a payment' : 'payments'
  } already held, with the same date, amount and card (for example ${first.details}, ${amount} on ${when}). Check for a duplicate before claiming ${
    one ? 'it' : 'them'
  }.`
}

type BankBalanceRow = {
  transaction_date: string
  amount_in: number | null
  amount_out: number | null
  balance: number | null
}

/**
 * Whether the bank balance joins up where this statement meets the lines already held: the last
 * day held before it, its own dates and the first day held after it. A break means lines are
 * missing, such as a line an older importer skipped, a download that stopped part way through a
 * month, or a statement never uploaded. Returns the message to show, or null when it joins up.
 */
async function checkBankBalanceAround(
  supabase: ReturnType<typeof createAdminClient>,
  rows: ParsedTransactionRow[]
): Promise<string | null> {
  const dates = rows.map((row) => row.transactionDate).sort()
  const first = dates[0]
  const last = dates[dates.length - 1]
  if (!first || !last) return null

  const neighbour = async (side: 'before' | 'after'): Promise<string | null> => {
    const base = supabase
      .from('receipt_transactions')
      .select('transaction_date')
      .eq('source_type', 'bank')
      .not('balance', 'is', null)
    const { data, error } =
      side === 'before'
        ? await base.lt('transaction_date', first).order('transaction_date', { ascending: false }).limit(1)
        : await base.gt('transaction_date', last).order('transaction_date', { ascending: true }).limit(1)
    if (error) throw new Error(`Failed to find the bank lines ${side} the statement: ${error.message}`)
    return (data?.[0] as { transaction_date: string } | undefined)?.transaction_date ?? null
  }

  const [from, to] = await Promise.all([neighbour('before'), neighbour('after')])
  const lines = await fetchAllRows<BankBalanceRow>(
    (fromRow, toRow) =>
      supabase
        .from('receipt_transactions')
        .select('id, transaction_date, amount_in, amount_out, balance')
        .eq('source_type', 'bank')
        .gte('transaction_date', from ?? first)
        .lte('transaction_date', to ?? last)
        .order('transaction_date', { ascending: true })
        .order('id', { ascending: true })
        .range(fromRow, toRow),
    { label: 'bank lines for the balance check' }
  )

  return describeBalanceContinuity(
    checkBalanceContinuity(
      lines.map((line) => ({
        date: line.transaction_date,
        amountIn: line.amount_in,
        amountOut: line.amount_out,
        balance: line.balance,
      }))
    )
  )
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
