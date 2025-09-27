'use server'

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/lib/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/server'
import { receiptRuleSchema, receiptMarkSchema } from '@/lib/validation'
import type { ReceiptBatch, ReceiptRule, ReceiptTransaction, ReceiptFile, ReceiptTransactionLog } from '@/types/database'
import Papa from 'papaparse'
import { createHash } from 'crypto'
import { z } from 'zod'

const RECEIPT_BUCKET = 'receipts'
const MAX_RECEIPT_UPLOAD_SIZE = 15 * 1024 * 1024 // 15 MB safety limit
const DEFAULT_PAGE_SIZE = 25

type CsvRow = {
  Date: string
  Details: string
  'Transaction Type': string
  In: string
  Out: string
  Balance: string
}

type ParsedTransactionRow = {
  transactionDate: string
  details: string
  transactionType: string | null
  amountIn: number | null
  amountOut: number | null
  balance: number | null
  dedupeHash: string
}

export type ReceiptSortColumn = 'transaction_date' | 'details' | 'amount_in' | 'amount_out'

export type ReceiptWorkspaceFilters = {
  status?: ReceiptTransaction['status'] | 'all'
  direction?: 'in' | 'out' | 'all'
  search?: string
  showOnlyOutstanding?: boolean
  page?: number
  pageSize?: number
  sortBy?: ReceiptSortColumn
  sortDirection?: 'asc' | 'desc'
}

export type ReceiptWorkspaceSummary = {
  totals: {
    pending: number
    completed: number
    autoCompleted: number
    noReceiptRequired: number
  }
  needsAttentionValue: number
  lastImport?: ReceiptBatch | null
}

export type ReceiptWorkspaceData = {
  transactions: (ReceiptTransaction & {
    files: ReceiptFile[]
    autoRule?: Pick<ReceiptRule, 'id' | 'name'> | null
  })[]
  rules: ReceiptRule[]
  summary: ReceiptWorkspaceSummary
  pagination: {
    page: number
    pageSize: number
    total: number
  }
}

const fileSchema = z.instanceof(File, { message: 'Please attach a CSV file' })
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.type === 'text/csv' || file.name.endsWith('.csv'), {
    message: 'Only CSV bank statements are supported'
  })

const receiptFileSchema = z.instanceof(File, { message: 'Please choose a receipt file' })
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.size <= MAX_RECEIPT_UPLOAD_SIZE, {
    message: 'File is too large. Please keep receipts under 15MB.'
  })

function sanitizeText(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
}

function sanitizeForPath(input: string, fallback = 'receipt'): string {
  const cleaned = sanitizeText(input)
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
  return cleaned || fallback
}

function sanitizeDescriptionForFilenameSegment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9\s&\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function composeReceiptFileArtifacts(
  transaction: ReceiptTransaction,
  amount: number,
  extension: string
) {
  const sanitizedDescription = sanitizeDescriptionForFilenameSegment(transaction.details ?? '')
  const descriptionSegment = sanitizedDescription.slice(0, 80) || 'Receipt'
  const amountLabel = amount ? amount.toFixed(2) : '0.00'
  const normalizedExtension = extension.toLowerCase()

  const friendlyName = `${transaction.transaction_date} - ${descriptionSegment} - ${amountLabel}.${normalizedExtension}`

  const storageSafeBase = friendlyName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '_')

  const storagePath = `${transaction.transaction_date.substring(0, 4)}/${storageSafeBase}_${Date.now()}`

  return { friendlyName, storagePath }
}

function parseCsv(buffer: Buffer): ParsedTransactionRow[] {
  const csvText = buffer.toString('utf-8')
  const parsed = Papa.parse<CsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  if (parsed.errors.length) {
    console.warn('CSV parsing encountered issues:', parsed.errors.slice(0, 3))
  }

  const records = parsed.data.filter((record) => record && Object.keys(record).length > 0)
  const rows: ParsedTransactionRow[] = []

  for (const record of records) {
    const details = sanitizeText(record.Details || '')
    if (!details) continue

    const transactionDate = record.Date ? normaliseDate(record.Date) : null
    if (!transactionDate) continue

    const amountIn = parseCurrency(record.In)
    const amountOut = parseCurrency(record.Out)

    if ((amountIn == null || amountIn === 0) && (amountOut == null || amountOut === 0)) {
      continue
    }

    const balance = parseCurrency(record.Balance)
    const transactionType = sanitizeText(record['Transaction Type'] || '') || null

    rows.push({
      transactionDate,
      details,
      transactionType,
      amountIn,
      amountOut,
      balance,
      dedupeHash: createTransactionHash({
        transactionDate,
        details,
        transactionType,
        amountIn,
        amountOut,
        balance,
      }),
    })
  }

  return rows
}

function normaliseDate(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const parts = trimmed.split('/')
  if (parts.length === 3) {
    const [day, month, year] = parts.map((value) => parseInt(value, 10))
    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null
    const iso = new Date(Date.UTC(year, month - 1, day))
    if (Number.isNaN(iso.getTime())) return null
    return iso.toISOString().slice(0, 10)
  }

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  return null
}

function parseCurrency(value: string | null | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned) return null
  const result = Number.parseFloat(cleaned)
  return Number.isFinite(result) ? Number(result.toFixed(2)) : null
}

function createTransactionHash(input: {
  transactionDate: string
  details: string
  transactionType: string | null
  amountIn: number | null
  amountOut: number | null
  balance: number | null
}): string {
  const hash = createHash('sha256')
  hash.update([input.transactionDate, input.details, input.transactionType ?? '', input.amountIn ?? '', input.amountOut ?? '', input.balance ?? ''].join('|'))
  return hash.digest('hex')
}

function isParsedTransactionRow(tx: ParsedTransactionRow | ReceiptTransaction): tx is ParsedTransactionRow {
  return 'amountIn' in tx
}

function getTransactionDirection(tx: ParsedTransactionRow | ReceiptTransaction): 'in' | 'out' {
  const amountIn = isParsedTransactionRow(tx) ? tx.amountIn : tx.amount_in
  const amountOut = isParsedTransactionRow(tx) ? tx.amountOut : tx.amount_out
  if (amountIn && amountIn > 0) return 'in'
  return 'out'
}

function guessAmountValue(tx: ParsedTransactionRow | ReceiptTransaction): number {
  const amountIn = isParsedTransactionRow(tx) ? tx.amountIn : tx.amount_in
  const amountOut = isParsedTransactionRow(tx) ? tx.amountOut : tx.amount_out
  if (amountIn && amountIn > 0) return amountIn
  if (amountOut && amountOut > 0) return amountOut
  return 0
}

async function applyAutomationRules(transactionIds: string[]): Promise<number> {
  if (!transactionIds.length) return 0

  const supabase = createAdminClient()

  const [{ data: rules }, { data: transactions }] = await Promise.all([
    supabase
      .from('receipt_rules')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase
      .from('receipt_transactions')
      .select('*')
      .in('id', transactionIds)
  ])

  if (!rules?.length || !transactions?.length) {
    return 0
  }

  let autoUpdated = 0
  const now = new Date().toISOString()
  const logs: Array<Omit<ReceiptTransactionLog, 'id'>> = []

  for (const transaction of transactions) {
    if (transaction.status !== 'pending') continue

    const direction = getTransactionDirection(transaction)
    const amountValue = guessAmountValue(transaction)
    const detailText = transaction.details.toLowerCase()

    const matchingRule = rules.find((rule) => {
      if (!rule.is_active) return false

      if (rule.match_direction !== 'both' && rule.match_direction !== direction) {
        return false
      }

      if (rule.match_description) {
        const needles = rule.match_description
          .toLowerCase()
          .split(',')
          .map((needle: string) => needle.trim())
          .filter((needle: string) => needle.length > 0)
        const matchesDescription = needles.some((needle: string) => detailText.includes(needle))
        if (!matchesDescription) return false
      }

      if (rule.match_transaction_type) {
        const typeMatch = (transaction.transaction_type ?? '').toLowerCase()
        if (!typeMatch.includes(rule.match_transaction_type.toLowerCase())) {
          return false
        }
      }

      if (rule.match_min_amount != null && amountValue < rule.match_min_amount) {
        return false
      }

      if (rule.match_max_amount != null && amountValue > rule.match_max_amount) {
        return false
      }

      return true
    })

    if (!matchingRule) {
      continue
    }

    const updatePayload = {
      status: matchingRule.auto_status,
      receipt_required: matchingRule.auto_status === 'pending' ? true : false,
      marked_by: null,
      marked_by_email: null,
      marked_by_name: null,
      marked_at: now,
      marked_method: 'rule',
      rule_applied_id: matchingRule.id,
    }

    const { error } = await supabase
      .from('receipt_transactions')
      .update(updatePayload)
      .eq('id', transaction.id)

    if (!error) {
      autoUpdated += 1
      logs.push({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: matchingRule.auto_status,
        action_type: 'rule_auto_mark',
        note: `Auto-marked by rule: ${matchingRule.name}`,
        performed_by: null,
        rule_id: matchingRule.id,
        performed_at: now,
      })
    }
  }

  if (logs.length) {
    await supabase.from('receipt_transaction_logs').insert(logs)
  }

  return autoUpdated
}
export async function importReceiptStatement(formData: FormData) {
  await checkUserPermission('receipts', 'manage')

  const file = formData.get('statement')
  const parsedFile = fileSchema.safeParse(file)
  if (!parsedFile.success) {
    return { error: parsedFile.error.issues[0]?.message ?? 'Invalid file upload' }
  }

  const receiptFile = parsedFile.data
  const buffer = Buffer.from(await receiptFile.arrayBuffer())
  const rows = parseCsv(buffer)

  if (!rows.length) {
    return { error: 'No valid transactions found in the CSV file.' }
  }

  const supabase = createAdminClient()
  const { user_id, user_email } = await getCurrentUser()

  const { data: batch, error: batchError } = await supabase
    .from('receipt_batches')
    .insert({
      original_filename: receiptFile.name,
      source_hash: createHash('sha256').update(buffer).digest('hex'),
      row_count: rows.length,
      uploaded_by: user_id,
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
    return { error: 'Failed to store the transactions.' }
  }

  const insertedIds = inserted?.map((row) => row.id) ?? []

  const autoApplied = await applyAutomationRules(insertedIds)

  if (insertedIds.length) {
    const logs = insertedIds.map<Omit<ReceiptTransactionLog, 'id'>>((transactionId) => ({
      transaction_id: transactionId,
      previous_status: null,
      new_status: 'pending',
      action_type: 'import',
      note: `Imported via ${receiptFile.name}`,
      performed_by: user_id,
      rule_id: null,
      performed_at: now,
    }))

    await supabase.from('receipt_transaction_logs').insert(logs)
  }

  await logAuditEvent({
    action: 'create',
    resource_type: 'receipt_batch',
    resource_id: batch.id,
    details: {
      filename: receiptFile.name,
      rows: rows.length,
      inserted: insertedIds.length,
      skipped: rows.length - insertedIds.length,
    },
  })

  revalidatePath('/receipts')

  return {
    success: true,
    inserted: insertedIds.length,
    skipped: rows.length - insertedIds.length,
    autoApplied,
    batch,
  }
}

export async function markReceiptTransaction(input: {
  transactionId: string
  status: ReceiptTransaction['status']
  note?: string
  receiptRequired?: boolean
}) {
  await checkUserPermission('receipts', 'manage')

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
  const { user_id, user_email } = await getCurrentUser()

  const { data: existing, error: existingError } = await supabase
    .from('receipt_transactions')
    .select('*')
    .eq('id', input.transactionId)
    .single()

  if (existingError || !existing) {
    return { error: 'Transaction not found' }
  }

  const now = new Date().toISOString()

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user_id)
    .single()

  const updatePayload = {
    status: validation.data.status,
    receipt_required: validation.data.receipt_required ?? (validation.data.status === 'pending'),
    marked_by: user_id,
    marked_by_email: user_email,
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
    .single()

  if (updateError || !updated) {
    console.error('Failed to update receipt transaction:', updateError)
    return { error: 'Failed to update the transaction.' }
  }

  await supabase.from('receipt_transaction_logs').insert({
    transaction_id: input.transactionId,
    previous_status: existing.status,
    new_status: updated.status,
    action_type: 'manual_update',
    note: validation.data.note ?? null,
    performed_by: user_id,
    rule_id: null,
    performed_at: now,
  })

  await logAuditEvent({
    action: 'update',
    resource_type: 'receipt_transaction',
    resource_id: input.transactionId,
    details: {
      previous_status: existing.status,
      new_status: updated.status,
      note: validation.data.note ?? null,
    },
  })

  revalidatePath('/receipts')

  return { success: true, transaction: updated }
}

export async function uploadReceiptForTransaction(formData: FormData) {
  await checkUserPermission('receipts', 'manage')

  const transactionId = formData.get('transactionId')
  if (typeof transactionId !== 'string' || !transactionId) {
    return { error: 'Missing transaction reference' }
  }

  const receiptFile = formData.get('receipt')
  const parsedFile = receiptFileSchema.safeParse(receiptFile)
  if (!parsedFile.success) {
    return { error: parsedFile.error.issues[0]?.message ?? 'Invalid receipt upload' }
  }

  const supabase = createAdminClient()
  const { user_id, user_email } = await getCurrentUser()

  const { data: transaction, error: txError } = await supabase
    .from('receipt_transactions')
    .select('*')
    .eq('id', transactionId)
    .single()

  if (txError || !transaction) {
    return { error: 'Transaction not found' }
  }

  const file = parsedFile.data
  const buffer = Buffer.from(await file.arrayBuffer())

  const extension = file.name.includes('.') ? file.name.split('.').pop() || 'pdf' : 'pdf'
  const amount = transaction.amount_out ?? transaction.amount_in ?? 0
  const { friendlyName, storagePath } = composeReceiptFileArtifacts(transaction, amount, extension)

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
      uploaded_by: user_id,
    })
    .select('*')
    .single()

  if (recordError || !receipt) {
    console.error('Failed to record receipt metadata:', recordError)
    // Attempt cleanup
    await supabase.storage.from(RECEIPT_BUCKET).remove([storagePath])
    return { error: 'Failed to store receipt metadata.' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user_id)
    .single()

  const updatePayload = {
    status: 'completed' satisfies ReceiptTransaction['status'],
    receipt_required: false,
    marked_by: user_id,
    marked_by_email: user_email,
    marked_by_name: profile?.full_name ?? null,
    marked_at: now,
    marked_method: 'receipt_upload',
    rule_applied_id: null,
  }

  await supabase
    .from('receipt_transactions')
    .update(updatePayload)
    .eq('id', transactionId)

  await supabase.from('receipt_transaction_logs').insert({
    transaction_id: transactionId,
    previous_status: transaction.status,
    new_status: 'completed',
    action_type: 'receipt_upload',
    note: `Receipt uploaded (${friendlyName})`,
    performed_by: user_id,
    rule_id: null,
    performed_at: now,
  })

  await logAuditEvent({
    action: 'update',
    resource_type: 'receipt_transaction',
    resource_id: transactionId,
    details: {
      status: 'completed',
      file: storagePath,
    },
  })

  revalidatePath('/receipts')

  return { success: true, receipt }
}

export async function deleteReceiptFile(fileId: string) {
  await checkUserPermission('receipts', 'manage')

  const supabase = createAdminClient()
  const { user_id } = await getCurrentUser()

  const { data: receipt, error } = await supabase
    .from('receipt_files')
    .select('*')
    .eq('id', fileId)
    .single()

  if (error || !receipt) {
    return { error: 'Receipt not found' }
  }

  const { data: transaction } = await supabase
    .from('receipt_transactions')
    .select('*')
    .eq('id', receipt.transaction_id)
    .single()

  await supabase.storage.from(RECEIPT_BUCKET).remove([receipt.storage_path])
  await supabase.from('receipt_files').delete().eq('id', fileId)

  const now = new Date().toISOString()

  await supabase.from('receipt_transaction_logs').insert({
    transaction_id: receipt.transaction_id,
    previous_status: transaction?.status ?? null,
    new_status: 'pending',
    action_type: 'receipt_deleted',
    note: 'Receipt removed by user',
    performed_by: user_id,
    rule_id: null,
    performed_at: now,
  })

  // If there are no receipts left, revert to pending
  const { data: remaining } = await supabase
    .from('receipt_files')
    .select('id')
    .eq('transaction_id', receipt.transaction_id)

  if (!remaining?.length) {
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
  }

  await logAuditEvent({
    action: 'delete',
    resource_type: 'receipt_file',
    resource_id: fileId,
    details: {
      transaction_id: receipt.transaction_id,
    },
  })

  revalidatePath('/receipts')

  return { success: true }
}

export async function createReceiptRule(formData: FormData) {
  await checkUserPermission('receipts', 'manage')

  const rawData = {
    name: formData.get('name'),
    description: formData.get('description') || undefined,
    match_description: formData.get('match_description') || undefined,
    match_transaction_type: formData.get('match_transaction_type') || undefined,
    match_direction: formData.get('match_direction') || 'both',
    match_min_amount: toOptionalNumber(formData.get('match_min_amount')),
    match_max_amount: toOptionalNumber(formData.get('match_max_amount')),
    auto_status: formData.get('auto_status') || 'no_receipt_required',
  }

  const parsed = receiptRuleSchema.safeParse(rawData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid rule details' }
  }

  const supabase = createAdminClient()
  const { user_id } = await getCurrentUser()

  const { data: rule, error } = await supabase
    .from('receipt_rules')
    .insert({
      ...parsed.data,
      created_by: user_id,
      updated_by: user_id,
    })
    .select('*')
    .single()

  if (error || !rule) {
    console.error('Failed to create rule:', error)
    return { error: 'Failed to create rule.' }
  }

  await logAuditEvent({
    action: 'create',
    resource_type: 'receipt_rule',
    resource_id: rule.id,
    details: parsed.data,
  })

  // Re-run automation on pending transactions after creating a new rule
  await refreshAutomationForPendingTransactions()

  revalidatePath('/receipts')

  return { success: true, rule }
}

export async function updateReceiptRule(ruleId: string, formData: FormData) {
  await checkUserPermission('receipts', 'manage')

  const rawData = {
    name: formData.get('name'),
    description: formData.get('description') || undefined,
    match_description: formData.get('match_description') || undefined,
    match_transaction_type: formData.get('match_transaction_type') || undefined,
    match_direction: formData.get('match_direction') || 'both',
    match_min_amount: toOptionalNumber(formData.get('match_min_amount')),
    match_max_amount: toOptionalNumber(formData.get('match_max_amount')),
    auto_status: formData.get('auto_status') || 'no_receipt_required',
  }

  const parsed = receiptRuleSchema.safeParse(rawData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid rule details' }
  }

  const supabase = createAdminClient()
  const { user_id } = await getCurrentUser()

  const { data: updated, error } = await supabase
    .from('receipt_rules')
    .update({
      ...parsed.data,
      updated_by: user_id,
    })
    .eq('id', ruleId)
    .select('*')
    .single()

  if (error || !updated) {
    return { error: 'Failed to update rule.' }
  }

  await logAuditEvent({
    action: 'update',
    resource_type: 'receipt_rule',
    resource_id: ruleId,
    details: parsed.data,
  })

  await refreshAutomationForPendingTransactions()

  revalidatePath('/receipts')

  return { success: true, rule: updated }
}

export async function toggleReceiptRule(ruleId: string, isActive: boolean) {
  await checkUserPermission('receipts', 'manage')

  const supabase = createAdminClient()
  const { data: updated, error } = await supabase
    .from('receipt_rules')
    .update({ is_active: isActive })
    .eq('id', ruleId)
    .select('*')
    .single()

  if (error || !updated) {
    return { error: 'Failed to update rule status.' }
  }

  await logAuditEvent({
    action: 'update',
    resource_type: 'receipt_rule',
    resource_id: ruleId,
    details: { is_active: isActive },
  })

  if (isActive) {
    await refreshAutomationForPendingTransactions()
  }

  revalidatePath('/receipts')

  return { success: true, rule: updated }
}

export async function deleteReceiptRule(ruleId: string) {
  await checkUserPermission('receipts', 'manage')

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('receipt_rules')
    .delete()
    .eq('id', ruleId)

  if (error) {
    return { error: 'Failed to delete rule.' }
  }

  await logAuditEvent({
    action: 'delete',
    resource_type: 'receipt_rule',
    resource_id: ruleId,
    details: {},
  })

  revalidatePath('/receipts')

  return { success: true }
}

export async function getReceiptWorkspaceData(filters: ReceiptWorkspaceFilters = {}): Promise<ReceiptWorkspaceData> {
  await checkUserPermission('receipts', 'view')

  const supabase = createAdminClient()

  const pageSize = Math.min(filters.pageSize ?? DEFAULT_PAGE_SIZE, 100)
  const page = Math.max(filters.page ?? 1, 1)
  const offset = (page - 1) * pageSize

  const sortColumn: ReceiptSortColumn = filters.sortBy ?? 'transaction_date'
  const sortDirection: 'asc' | 'desc' = filters.sortDirection === 'asc' ? 'asc' : 'desc'

  const orderDefinitions: Array<{ column: ReceiptSortColumn; ascending: boolean }> = []

  const isAscending = sortDirection === 'asc'
  orderDefinitions.push({ column: sortColumn, ascending: isAscending })

  if (!orderDefinitions.some((order) => order.column === 'transaction_date')) {
    orderDefinitions.push({ column: 'transaction_date', ascending: false })
  }

  if (!orderDefinitions.some((order) => order.column === 'details')) {
    orderDefinitions.push({ column: 'details', ascending: true })
  }

  let baseQuery = supabase
    .from('receipt_transactions')
    .select('*, receipt_files(*), receipt_rules!receipt_transactions_rule_applied_id_fkey(id, name)', { count: 'exact' })

  orderDefinitions.forEach((order) => {
    baseQuery = baseQuery.order(order.column, { ascending: order.ascending })
  })

  if (filters.status && filters.status !== 'all') {
    baseQuery = baseQuery.eq('status', filters.status)
  }

  if (filters.showOnlyOutstanding) {
    baseQuery = baseQuery.in('status', ['pending'])
  }

  if (filters.direction && filters.direction !== 'all') {
    if (filters.direction === 'in') {
      baseQuery = baseQuery.not('amount_in', 'is', null)
    } else {
      baseQuery = baseQuery.not('amount_out', 'is', null)
    }
  }

  if (filters.search) {
    const qs = `%${filters.search.toLowerCase()}%`
    baseQuery = baseQuery.or(`details.ilike.${qs},transaction_type.ilike.${qs}`)
  }

  baseQuery = baseQuery.range(offset, offset + pageSize - 1)

  const [{ data: transactions, count, error }, { data: rules }, summary] = await Promise.all([
    baseQuery,
    supabase
      .from('receipt_rules')
      .select('*')
      .order('created_at', { ascending: true }),
    fetchSummary(),
  ])

  if (error) {
    console.error('Failed to load receipts workspace:', error)
    throw error
  }

  const shapedTransactions = (transactions ?? []).map((tx) => ({
    ...tx,
    files: tx.receipt_files ?? [],
    autoRule: tx.receipt_rules?.[0] ?? null,
  }))

  return {
    transactions: shapedTransactions,
    rules: rules ?? [],
    summary,
    pagination: {
      page,
      pageSize,
      total: count ?? 0,
    },
  }
}

async function fetchSummary(): Promise<ReceiptWorkspaceSummary> {
  const supabase = createAdminClient()
  const [{ data: statusCounts }, { data: lastBatch }] = await Promise.all([
    supabase.rpc('count_receipt_statuses'),
    supabase
      .from('receipt_batches')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const counts = Array.isArray(statusCounts) ? statusCounts[0] : statusCounts

  const pending = Number(counts?.pending ?? 0)
  const completed = Number(counts?.completed ?? 0)
  const autoCompleted = Number(counts?.auto_completed ?? 0)
  const noReceiptRequired = Number(counts?.no_receipt_required ?? 0)

  return {
    totals: {
      pending,
      completed,
      autoCompleted,
      noReceiptRequired,
    },
    needsAttentionValue: pending,
    lastImport: lastBatch ?? null,
  }
}

async function refreshAutomationForPendingTransactions() {
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

function toOptionalNumber(input: FormDataEntryValue | null): number | undefined {
  if (typeof input !== 'string') return undefined
  const cleaned = input.trim()
  if (!cleaned) return undefined
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? Number(value.toFixed(2)) : undefined
}

export async function getReceiptSignedUrl(fileId: string) {
  await checkUserPermission('receipts', 'view')
  const supabase = createAdminClient()

  const { data: receipt, error } = await supabase
    .from('receipt_files')
    .select('*')
    .eq('id', fileId)
    .single()

  if (error || !receipt) {
    return { error: 'Receipt not found' }
  }

  const { data: urlData, error: urlError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(receipt.storage_path, 60 * 5)

  if (urlError || !urlData?.signedUrl) {
    return { error: 'Unable to create download link' }
  }

  return { success: true, url: urlData.signedUrl }
}
