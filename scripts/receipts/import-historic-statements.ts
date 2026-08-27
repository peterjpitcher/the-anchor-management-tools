import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { createAdminClient } from '@/lib/supabase/admin'
import { parseCsv } from '@/services/receipts/receiptHelpers'

const DEFAULT_STATEMENT_DIR =
  '/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/1. The Anchor/Financials and Accounting/Full Account Download/Statements'
const CUTOFF_DATE = '2026-01-01'
const IMPORTER_EMAIL = 'peter@orangejelly.co.uk'
const CHUNK_SIZE = 200

type ParsedRow = ReturnType<typeof parseCsv>[number]

type SourceRow = ParsedRow & {
  fileName: string
}

type ExistingRow = {
  id: string
  dedupe_hash: string
  transaction_date: string
  details: string
  transaction_type: string | null
  amount_in: number | null
  amount_out: number | null
  balance: number | null
  status: string
  receipt_required: boolean
}

function chunks<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function naturalKey(row: SourceRow | ExistingRow): string {
  const transactionDate = 'transactionDate' in row ? row.transactionDate : row.transaction_date
  const transactionType = 'transactionType' in row ? row.transactionType : row.transaction_type
  const amountIn = 'amountIn' in row ? row.amountIn : row.amount_in
  const amountOut = 'amountOut' in row ? row.amountOut : row.amount_out

  return [
    transactionDate,
    row.details.trim().replace(/\s+/g, ' '),
    transactionType ?? '',
    Number(amountIn ?? 0).toFixed(2),
    Number(amountOut ?? 0).toFixed(2),
    row.balance == null ? '' : Number(row.balance).toFixed(2),
  ].join('|')
}

async function fetchAll<T>(buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = []

  for (let from = 0; ; from += 1_000) {
    const { data, error } = await buildQuery(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1_000) return rows
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const statementDirectory = process.argv.find((argument) => argument.startsWith('--dir='))?.slice(6)
    ?? DEFAULT_STATEMENT_DIR

  const fileNames = fs.readdirSync(statementDirectory)
    .filter((fileName) => fileName.toLowerCase().endsWith('.csv'))
    .sort()

  if (!fileNames.length) throw new Error(`No CSV statements found in ${statementDirectory}`)

  const rowsByFile = new Map<string, SourceRow[]>()
  const fileHashes = new Map<string, string>()
  const allSourceRows: SourceRow[] = []

  for (const fileName of fileNames) {
    const buffer = fs.readFileSync(path.join(statementDirectory, fileName))
    const rows = parseCsv(buffer).map((row) => ({ ...row, fileName }))
    rowsByFile.set(fileName, rows)
    fileHashes.set(fileName, crypto.createHash('sha256').update(buffer).digest('hex'))
    allSourceRows.push(...rows)
  }

  const sourceHashes = new Set<string>()
  const sourceNaturalKeys = new Set<string>()
  for (const row of allSourceRows) {
    if (sourceHashes.has(row.dedupeHash)) {
      throw new Error(`Duplicate source hash found in ${row.fileName}`)
    }
    const key = naturalKey(row)
    if (sourceNaturalKeys.has(key)) {
      throw new Error(`Duplicate source transaction found in ${row.fileName}`)
    }
    sourceHashes.add(row.dedupeHash)
    sourceNaturalKeys.add(key)
  }

  const supabase = createAdminClient()
  const [{ data: profile, error: profileError }, existingRows, existingBatches] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email').eq('email', IMPORTER_EMAIL).single(),
    fetchAll<ExistingRow>((from, to) =>
      supabase
        .from('receipt_transactions')
        .select('id, dedupe_hash, transaction_date, details, transaction_type, amount_in, amount_out, balance, status, receipt_required')
        .lt('transaction_date', CUTOFF_DATE)
        .order('id')
        .range(from, to),
    ),
    fetchAll<{ id: string; source_hash: string | null }>((from, to) =>
      supabase.from('receipt_batches').select('id, source_hash').order('id').range(from, to),
    ),
  ])

  if (profileError || !profile) throw profileError ?? new Error(`Profile not found for ${IMPORTER_EMAIL}`)

  const existingHashes = new Set(existingRows.map((row) => row.dedupe_hash))
  const existingNaturalKeys = new Set(existingRows.map(naturalKey))
  const existingBatchByHash = new Map(
    existingBatches
      .filter((batch): batch is { id: string; source_hash: string } => Boolean(batch.source_hash))
      .map((batch) => [batch.source_hash, batch.id]),
  )

  const newRowsByFile = new Map<string, SourceRow[]>()
  for (const [fileName, rows] of rowsByFile) {
    const missing = rows.filter(
      (row) => !existingHashes.has(row.dedupeHash) && !existingNaturalKeys.has(naturalKey(row)),
    )
    if (missing.length) newRowsByFile.set(fileName, missing)
  }

  const completionChanges = existingRows.filter(
    (row) => row.status !== 'completed' || row.receipt_required,
  )
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    statementFiles: fileNames.length,
    sourceRows: allSourceRows.length,
    sourceDateMin: allSourceRows.map((row) => row.transactionDate).sort()[0],
    sourceDateMax: allSourceRows.map((row) => row.transactionDate).sort().at(-1),
    alreadyPresent: allSourceRows.length - [...newRowsByFile.values()].flat().length,
    rowsToInsert: [...newRowsByFile.values()].flat().length,
    filesWithRowsToInsert: newRowsByFile.size,
    existingRowsToNormalizeCompleted: completionChanges.length,
  }

  console.log(JSON.stringify(report, null, 2))
  if (!apply) return

  const now = new Date().toISOString()
  let insertedCount = 0
  let importLogCount = 0
  const createdBatchIds: string[] = []

  for (const [fileName, rows] of newRowsByFile) {
    const sourceHash = fileHashes.get(fileName)
    if (!sourceHash) throw new Error(`Missing source hash for ${fileName}`)

    let batchId = existingBatchByHash.get(sourceHash)
    let createdBatch = false

    if (!batchId) {
      const { data: batch, error: batchError } = await supabase
        .from('receipt_batches')
        .insert({
          original_filename: fileName,
          source_hash: sourceHash,
          source_type: 'bank',
          row_count: rowsByFile.get(fileName)?.length ?? rows.length,
          uploaded_by: profile.id,
          notes: `Historical bank statement import; transactions before ${CUTOFF_DATE} marked completed.`,
        })
        .select('id')
        .single()

      if (batchError || !batch) throw batchError ?? new Error(`Could not create batch for ${fileName}`)
      batchId = batch.id
      createdBatch = true
      createdBatchIds.push(batchId)
    }

    const payload = rows.map((row) => ({
      batch_id: batchId,
      source_type: 'bank',
      transaction_date: row.transactionDate,
      details: row.details,
      transaction_type: row.transactionType,
      amount_in: row.amountIn,
      amount_out: row.amountOut,
      balance: row.balance,
      dedupe_hash: row.dedupeHash,
      status: 'completed',
      receipt_required: false,
      marked_by: profile.id,
      marked_by_email: IMPORTER_EMAIL,
      marked_by_name: profile.full_name ?? 'Peter Pitcher',
      marked_at: now,
      marked_method: 'historic_statement_import',
      notes: 'Historical transaction before 2026; marked done during statement import.',
      created_at: now,
      updated_at: now,
    }))

    const { data: inserted, error: insertError } = await supabase
      .from('receipt_transactions')
      .upsert(payload, { onConflict: 'dedupe_hash', ignoreDuplicates: true })
      .select('id')

    if (insertError) {
      if (createdBatch) await supabase.from('receipt_batches').delete().eq('id', batchId)
      throw insertError
    }

    const insertedRows = inserted ?? []
    insertedCount += insertedRows.length

    if (!insertedRows.length && createdBatch) {
      await supabase.from('receipt_batches').delete().eq('id', batchId)
      continue
    }

    for (const logChunk of chunks(insertedRows)) {
      const { error: logError } = await supabase.from('receipt_transaction_logs').insert(
        logChunk.map((row) => ({
          transaction_id: row.id,
          previous_status: null,
          new_status: 'completed',
          action_type: 'import',
          note: `Imported via ${fileName}; historical pre-2026 transaction marked done.`,
          performed_by: profile.id,
          performed_at: now,
        })),
      )
      if (logError) throw logError
      importLogCount += logChunk.length
    }
  }

  let updatedCount = 0
  let statusLogCount = 0

  for (const rowChunk of chunks(completionChanges)) {
    const previousStatusById = new Map(rowChunk.map((row) => [row.id, row.status]))
    const { data: updated, error: updateError } = await supabase
      .from('receipt_transactions')
      .update({
        status: 'completed',
        receipt_required: false,
        marked_by: profile.id,
        marked_by_email: IMPORTER_EMAIL,
        marked_by_name: profile.full_name ?? 'Peter Pitcher',
        marked_at: now,
        marked_method: 'historic_statement_import',
        rule_applied_id: null,
        updated_at: now,
      })
      .in('id', rowChunk.map((row) => row.id))
      .select('id')

    if (updateError) throw updateError
    const updatedRows = updated ?? []
    updatedCount += updatedRows.length

    if (updatedRows.length) {
      const { error: logError } = await supabase.from('receipt_transaction_logs').insert(
        updatedRows.map((row) => ({
          transaction_id: row.id,
          previous_status: previousStatusById.get(row.id),
          new_status: 'completed',
          action_type: 'historic_import_status',
          note: 'Marked done because the transaction date is before 1 January 2026.',
          performed_by: profile.id,
          performed_at: now,
        })),
      )
      if (logError) throw logError
      statusLogCount += updatedRows.length
    }
  }

  console.log(JSON.stringify({
    applied: true,
    insertedCount,
    createdBatchCount: createdBatchIds.length,
    importLogCount,
    updatedExistingCount: updatedCount,
    statusLogCount,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
