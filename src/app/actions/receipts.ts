'use server'

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/server'
import {
  receiptRuleSchema,
  receiptMarkSchema,
  receiptExpenseCategorySchema,
  receiptRuleDirectionSchema,
  receiptTransactionStatusSchema,
} from '@/lib/validation'
import type {
  ReceiptBatch,
  ReceiptRule,
  ReceiptTransaction,
  ReceiptFile,
  ReceiptTransactionLog,
  ReceiptExpenseCategory,
  ReceiptClassificationSource,
  Database,
} from '@/types/database'
import Papa from 'papaparse'
import { createHash } from 'crypto'
import { z } from 'zod'
import { classifyReceiptTransaction, type ClassificationUsage } from '@/lib/openai'

const RECEIPT_BUCKET = 'receipts'
const MAX_RECEIPT_UPLOAD_SIZE = 15 * 1024 * 1024 // 15 MB safety limit
const DEFAULT_PAGE_SIZE = 25
const EXPENSE_CATEGORY_OPTIONS = receiptExpenseCategorySchema.options
const BULK_STATUS_OPTIONS = receiptTransactionStatusSchema.options
type BulkStatus = (typeof BULK_STATUS_OPTIONS)[number]

const bulkGroupQuerySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  statuses: z.array(receiptTransactionStatusSchema).optional(),
  onlyUnclassified: z.boolean().optional(),
})

const bulkGroupApplySchema = z.object({
  details: z.string().min(1),
  statuses: z.array(receiptTransactionStatusSchema).optional(),
  vendorName: z.union([z.string(), z.null()]).optional(),
  expenseCategory: z.union([z.string(), z.null()]).optional(),
})

const groupRuleInputSchema = z.object({
  name: z.string().min(1).max(120),
  details: z.string().min(1),
  matchDescription: z.string().trim().max(300).optional(),
  description: z.string().trim().max(500).optional(),
  direction: receiptRuleDirectionSchema.default('both'),
  autoStatus: receiptTransactionStatusSchema.default('no_receipt_required'),
  vendorName: z.union([z.string(), z.null()]).optional(),
  expenseCategory: z.union([z.string(), z.null()]).optional(),
})
type AdminClient = ReturnType<typeof createAdminClient>

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
  missingVendorOnly?: boolean
  missingExpenseOnly?: boolean
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
  openAICost: number
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
  knownVendors: string[]
}

export type ReceiptMonthlySummaryItem = {
  monthStart: string
  totalIncome: number
  totalOutgoing: number
  topIncome: Array<{ label: string; amount: number }>
  topOutgoing: Array<{ label: string; amount: number }>
}

export type ReceiptVendorTrendMonth = {
  monthStart: string
  totalOutgoing: number
  totalIncome: number
  transactionCount: number
}

export type ReceiptVendorSummary = {
  vendorLabel: string
  months: ReceiptVendorTrendMonth[]
  totalOutgoing: number
  totalIncome: number
  recentAverageOutgoing: number
  previousAverageOutgoing: number
  changePercentage: number
}

export type ReceiptDetailGroupSuggestion = {
  vendorName: string | null
  expenseCategory: ReceiptExpenseCategory | null
  reasoning: string | null
  source: 'ai' | 'existing' | 'none'
  model?: string | null
}

export type ReceiptDetailGroup = {
  details: string
  transactionIds: string[]
  transactionCount: number
  needsVendorCount: number
  needsExpenseCount: number
  totalIn: number
  totalOut: number
  firstDate: string | null
  lastDate: string | null
  dominantVendor: string | null
  dominantExpense: ReceiptExpenseCategory | null
  sampleTransaction: {
    id: string
    transactionDate: string | null
    transactionType: string | null
    amountIn: number | null
    amountOut: number | null
    vendorName: string | null
    vendorSource: ReceiptClassificationSource | null
    expenseCategory: ReceiptExpenseCategory | null
    expenseCategorySource: ReceiptClassificationSource | null
  } | null
  suggestion: ReceiptDetailGroupSuggestion
}

export type ReceiptBulkReviewData = {
  groups: ReceiptDetailGroup[]
  generatedAt: string
  config: {
    limit: number
    statuses: ReceiptTransaction['status'][]
    onlyUnclassified: boolean
    openAIEnabled: boolean
  }
}

type RpcDetailGroupRow = {
  details: string
  transaction_ids: string[]
  transaction_count: number
  needs_vendor_count: number
  needs_expense_count: number
  total_in: number | string | null
  total_out: number | string | null
  first_date: string | null
  last_date: string | null
  dominant_vendor: string | null
  dominant_expense: string | null
  sample_transaction: unknown
}

type NormalizedDetailGroupRow = {
  details: string
  transactionIds: string[]
  transactionCount: number
  needsVendorCount: number
  needsExpenseCount: number
  totalIn: number
  totalOut: number
  firstDate: string | null
  lastDate: string | null
  dominantVendor: string | null
  dominantExpense: ReceiptExpenseCategory | null
  sampleTransaction: GroupSample
}

function normalizeDetailGroupRow(row: RpcDetailGroupRow): NormalizedDetailGroupRow {
  const transactionIds = Array.isArray(row.transaction_ids) ? row.transaction_ids : []
  const transactionCount = Number(row.transaction_count ?? transactionIds.length ?? 0)
  return {
    details: row.details,
    transactionIds,
    transactionCount,
    needsVendorCount: Number(row.needs_vendor_count ?? 0),
    needsExpenseCount: Number(row.needs_expense_count ?? 0),
    totalIn: parseNumeric(row.total_in),
    totalOut: parseNumeric(row.total_out),
    firstDate: row.first_date,
    lastDate: row.last_date,
    dominantVendor: normalizeVendorInput(row.dominant_vendor) ?? null,
    dominantExpense: coerceExpenseCategory(row.dominant_expense),
    sampleTransaction: parseSampleTransaction(row.sample_transaction),
  }
}

async function buildGroupSuggestion(
  supabase: AdminClient,
  group: NormalizedDetailGroupRow,
  openAIEnabled: boolean
): Promise<ReceiptDetailGroupSuggestion> {
  const existingVendor = group.dominantVendor
  const existingExpense = group.dominantExpense

  let suggestion: ReceiptDetailGroupSuggestion = {
    vendorName: existingVendor,
    expenseCategory: existingExpense ?? null,
    reasoning: null,
    source: existingVendor || existingExpense ? 'existing' : 'none',
  }

  const needsAI = group.needsVendorCount > 0 || group.needsExpenseCount > 0 || (!existingVendor && !existingExpense)

  if (!openAIEnabled || !needsAI) {
    return suggestion
  }

  const sample = group.sampleTransaction
  const averageIn = group.transactionCount ? group.totalIn / group.transactionCount : 0
  const averageOut = group.transactionCount ? group.totalOut / group.transactionCount : 0
  const amountIn = sample?.amountIn && sample.amountIn > 0 ? sample.amountIn : averageIn || null
  const amountOut = sample?.amountOut && sample.amountOut > 0 ? sample.amountOut : averageOut || null
  const direction = deriveDirection(amountIn, amountOut)

  const outcome = await classifyReceiptTransaction({
    details: group.details,
    amountIn,
    amountOut,
    transactionType: sample?.transactionType ?? null,
    categories: EXPENSE_CATEGORY_OPTIONS,
    direction,
    existingVendor: existingVendor ?? undefined,
    existingExpenseCategory: existingExpense ?? undefined,
  })

  if (outcome?.result) {
    const vendorName = normalizeVendorInput(outcome.result.vendorName) ?? existingVendor ?? null
    const expenseCategory = coerceExpenseCategory(outcome.result.expenseCategory) ?? existingExpense ?? null
    suggestion = {
      vendorName,
      expenseCategory,
      reasoning: outcome.result.reasoning,
      source: 'ai',
      model: outcome.usage?.model,
    }
    if (outcome.usage) {
      await recordAIUsage(supabase, outcome.usage, `receipt_group:${hashDetails(group.details)}`)
    }
  }

  return suggestion
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

const classificationUpdateSchema = z.object({
  transactionId: z.string().uuid('Transaction reference is invalid'),
  vendorName: z
    .string()
    .trim()
    .max(120, 'Keep the vendor name under 120 characters')
    .nullable()
    .optional(),
  expenseCategory: receiptExpenseCategorySchema.nullable().optional(),
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

function normalizeVendorInput(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 120)
}

function coerceExpenseCategory(value: unknown): ReceiptExpenseCategory | null {
  const parsed = receiptExpenseCategorySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function hashDetails(details: string): string {
  return createHash('sha256').update(details).digest('hex').slice(0, 24)
}

function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function roundToCurrency(value: number): number {
  return Number(value.toFixed(2))
}

type GroupSample = ReceiptDetailGroup['sampleTransaction']

function parseSampleTransaction(value: unknown): GroupSample {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : null
  if (!id) return null
  return {
    id,
    transactionDate: typeof record.transaction_date === 'string' ? record.transaction_date : null,
    transactionType: typeof record.transaction_type === 'string' ? record.transaction_type : null,
    amountIn: parseNumeric(record.amount_in) || null,
    amountOut: parseNumeric(record.amount_out) || null,
    vendorName: normalizeVendorInput(record.vendor_name) ?? null,
    vendorSource: typeof record.vendor_source === 'string' ? (record.vendor_source as ReceiptClassificationSource) : null,
    expenseCategory: coerceExpenseCategory(record.expense_category) ?? null,
    expenseCategorySource: typeof record.expense_category_source === 'string'
      ? (record.expense_category_source as ReceiptClassificationSource)
      : null,
  }
}

function deriveDirection(amountIn: number | null, amountOut: number | null): 'in' | 'out' {
  const inValue = amountIn ?? 0
  const outValue = amountOut ?? 0
  if (outValue > 0 && outValue >= inValue) return 'out'
  if (inValue > 0) return 'in'
  return outValue > inValue ? 'out' : 'in'
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

type AutomationResult = {
  statusAutoUpdated: number
  classificationUpdated: number
  matched: number
  vendorIntended: number
  expenseIntended: number
  samples: Array<{
    id: string
    status: ReceiptTransaction['status']
    details: string
    transaction_type: string | null
    amount_in: number | null
    amount_out: number | null
    direction: 'in' | 'out'
    vendor_name: string | null
    vendor_source: ReceiptClassificationSource | null
    expense_category: ReceiptExpenseCategory | null
    expense_source: ReceiptClassificationSource | null
  }>
}

async function applyAutomationRules(
  transactionIds: string[],
  options: {
    includeClosed?: boolean
    targetRuleId?: string | null
    overrideManual?: boolean
    allowClosedStatusUpdates?: boolean
  } = {}
): Promise<AutomationResult> {
  console.log('[retro] applyAutomationRules start', {
    transactionCount: transactionIds.length,
    options,
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

  const [{ data: rules, error: rulesError }] = await Promise.all([rulesQuery])

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
    const detailText = transaction.details.toLowerCase()
    inspectedTransactions.push(transaction)

    const matchingRule = ruleList.find((rule) => {
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

    if (!Object.keys(updatePayload).length && classificationNotes.length === 0) {
      continue
    }

    updatePayload.updated_at = now

    const { error } = await supabase
      .from('receipt_transactions')
      .update(updatePayload)
      .eq('id', transaction.id)

    if (!error) {
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
  }

  if (classificationLogs.length) {
    await supabase.from('receipt_transaction_logs').insert(classificationLogs)
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
    console.log('[receipts] applyAutomationRules summary', summary)

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

const RETRO_CHUNK_SIZE = 100

type RetroStepSuccess = {
  success: true
  reviewed: number
  matched: number
  statusAutoUpdated: number
  classificationUpdated: number
  vendorIntended: number
  expenseIntended: number
  samples: AutomationResult['samples']
  nextOffset: number
  total: number
  done: boolean
  durationMs: number
}

type RetroStepResult = RetroStepSuccess | { success: false; error: string }

export async function runReceiptRuleRetroactivelyStep({
  ruleId,
  scope = 'pending',
  offset = 0,
  chunkSize = RETRO_CHUNK_SIZE,
}: {
  ruleId: string
  scope?: 'pending' | 'all'
  offset?: number
  chunkSize?: number
}): Promise<RetroStepResult> {
  const startedAt = Date.now()
  await checkUserPermission('receipts', 'manage')

  const supabase = createAdminClient()

  const { data: rule, error: ruleError } = await supabase
    .from('receipt_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle()

  if (ruleError || !rule) {
    console.error('[retro-step] rule lookup failed', { ruleId, ruleError })
    return { success: false, error: 'Rule not found' }
  }

  if (!rule.is_active) {
    console.warn('[retro-step] rule inactive', { ruleId })
    return { success: false, error: 'Enable the rule before running it' }
  }

  let idsQuery = supabase
    .from('receipt_transactions')
    .select('id', { count: 'exact', head: false })
    .order('transaction_date', { ascending: false })

  if (scope === 'pending') {
    idsQuery = idsQuery.eq('status', 'pending')
  }

  const { data: idRows, count, error: idsError } = await idsQuery.range(offset, offset + chunkSize - 1)

  if (idsError) {
    console.error('[retro-step] failed to load ids', { idsError, ruleId, offset, chunkSize })
    return { success: false, error: 'Failed to load transactions' }
  }

  const ids = (idRows ?? []).map((row) => row.id ?? null).filter((value): value is string => Boolean(value))

  const total = typeof count === 'number' ? count : offset + ids.length

  if (!ids.length) {
    return {
      success: true,
      reviewed: 0,
      matched: 0,
      statusAutoUpdated: 0,
      classificationUpdated: 0,
      vendorIntended: 0,
      expenseIntended: 0,
      samples: [],
      nextOffset: offset,
      total,
      done: true,
      durationMs: Date.now() - startedAt,
    }
  }

  const summary = await applyAutomationRules(ids, {
    includeClosed: scope === 'all',
    targetRuleId: ruleId,
    overrideManual: scope === 'all',
    allowClosedStatusUpdates: scope === 'all',
  })

  const nextOffset = offset + ids.length
  const done = nextOffset >= total

  const durationMs = Date.now() - startedAt

  console.log('[retro-step] processed chunk', {
    ruleId,
    scope,
    offset,
    processed: ids.length,
    matched: summary.matched,
    statusAutoUpdated: summary.statusAutoUpdated,
    classificationUpdated: summary.classificationUpdated,
    vendorIntended: summary.vendorIntended,
    expenseIntended: summary.expenseIntended,
    nextOffset,
    total,
    done,
    durationMs,
  })

  return {
    success: true,
    reviewed: ids.length,
    matched: summary.matched,
    statusAutoUpdated: summary.statusAutoUpdated,
    classificationUpdated: summary.classificationUpdated,
    vendorIntended: summary.vendorIntended,
    expenseIntended: summary.expenseIntended,
    samples: summary.samples,
    nextOffset,
    total,
    done,
    durationMs,
  }
}

export async function finalizeReceiptRuleRetroRun(input: {
  ruleId: string
  scope: 'pending' | 'all'
  reviewed: number
  statusAutoUpdated: number
  classificationUpdated: number
  matched: number
  vendorIntended: number
  expenseIntended: number
}) {
  await checkUserPermission('receipts', 'manage')

  await logAuditEvent({
    operation_type: 'retro_run',
    resource_type: 'receipt_rule',
    resource_id: input.ruleId,
    operation_status: 'success',
    additional_info: {
      scope: input.scope,
      reviewed: input.reviewed,
      auto_marked: input.statusAutoUpdated,
      classified: input.classificationUpdated,
      matched: input.matched,
      vendor_intended: input.vendorIntended,
      expense_intended: input.expenseIntended,
    },
  })

  revalidatePath('/receipts')
  revalidatePath('/receipts/vendors')
  revalidatePath('/receipts/monthly')

  return { success: true }
}

async function recordAIUsage(
  supabase: AdminClient,
  usage: ClassificationUsage | undefined,
  context: string
) {
  if (!usage) return

  const { error } = await (supabase.from('ai_usage_events') as any).insert([
    {
      context,
      model: usage.model,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      cost: usage.cost,
    },
  ])

  if (error) {
    console.error('Failed to record OpenAI usage', error)
  }
}

async function classifyTransactionsWithAI(
  supabase: AdminClient,
  transactionIds: string[]
): Promise<void> {
  if (!transactionIds.length) return

  if (!process.env.OPENAI_API_KEY) {
    return
  }

  const client = supabase as any

  const { data: transactions, error } = await client
    .from('receipt_transactions')
    .select(
      'id, details, transaction_type, amount_in, amount_out, vendor_name, vendor_source, vendor_rule_id, expense_category, expense_category_source, expense_rule_id, status'
    )
    .in('id', transactionIds)

  if (error) {
    console.error('Failed to load transactions for AI classification', error)
    return
  }

  const transactionRows = (transactions ?? []) as ReceiptTransaction[]

  if (!transactionRows.length) return

  const logs: Array<Omit<ReceiptTransactionLog, 'id'>> = []

  for (const transaction of transactionRows) {
    const vendorLocked = transaction.vendor_source === 'manual' || transaction.vendor_source === 'rule'
    const expenseLocked = transaction.expense_category_source === 'manual'

    const needsVendor = !vendorLocked && !transaction.vendor_name
    const needsExpense = !expenseLocked && !transaction.expense_category

    if (!needsVendor && !needsExpense) {
      continue
    }

    const direction = getTransactionDirection(transaction)

    const outcome = await classifyReceiptTransaction({
      details: transaction.details,
      amountIn: transaction.amount_in,
      amountOut: transaction.amount_out,
      transactionType: transaction.transaction_type,
      categories: EXPENSE_CATEGORY_OPTIONS,
      direction,
      existingVendor: transaction.vendor_name ?? undefined,
      existingExpenseCategory: transaction.expense_category ?? undefined,
    })

    if (!outcome?.result) {
      continue
    }

    await recordAIUsage(supabase, outcome.usage, `receipt_classification:${transaction.id}`)

    const { vendorName, expenseCategory, reasoning } = outcome.result
    const updatePayload: Record<string, unknown> = {}
    const changeNotes: string[] = []
    const now = new Date().toISOString()

    if (needsVendor && vendorName) {
      updatePayload.vendor_name = vendorName
      updatePayload.vendor_source = 'ai'
      updatePayload.vendor_rule_id = null
      updatePayload.vendor_updated_at = now
      changeNotes.push(`Vendor → ${vendorName}`)
    }

    if (needsExpense && expenseCategory) {
      updatePayload.expense_category = expenseCategory
      updatePayload.expense_category_source = 'ai'
      updatePayload.expense_rule_id = null
      updatePayload.expense_updated_at = now
      changeNotes.push(`Expense → ${expenseCategory}`)
    }

    if (!Object.keys(updatePayload).length) {
      continue
    }

    updatePayload.updated_at = now

    const { error: updateError } = await client
      .from('receipt_transactions')
      .update(updatePayload)
      .eq('id', transaction.id)

    if (updateError) {
      console.error('Failed to persist AI classification', updateError)
      continue
    }

    logs.push({
      transaction_id: transaction.id,
      previous_status: transaction.status,
      new_status: transaction.status,
      action_type: 'ai_classification',
      note: reasoning
        ? `AI suggestion applied: ${changeNotes.join(' | ')} (Reason: ${reasoning})`
        : `AI suggestion applied: ${changeNotes.join(' | ')}`,
      performed_by: null,
      rule_id: null,
      performed_at: now,
    })
  }

  if (logs.length) {
    await client.from('receipt_transaction_logs').insert(logs)
  }
}

type RuleSuggestion = {
  suggestedName: string
  matchDescription: string | null
  direction: 'in' | 'out'
  amountValue: number
  details: string
  transactionType: string | null
  setVendorName: string | null
  setExpenseCategory: ReceiptExpenseCategory | null
}

export type ClassificationRuleSuggestion = RuleSuggestion

function buildRuleSuggestion(
  transaction: ReceiptTransaction,
  updates: {
    vendorName?: string | null
    expenseCategory?: ReceiptExpenseCategory | null
  }
): RuleSuggestion | null {
  if (!updates.vendorName && !updates.expenseCategory) {
    return null
  }

  const direction = getTransactionDirection(transaction)
  const amountValue = guessAmountValue(transaction)
  const details = transaction.details?.trim() ?? ''

  const keywords = details
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
    .filter((token) => token.length >= 4)
    .slice(0, 3)

  const matchDescription = keywords.join(',') || null

  const suggestedNameBase = updates.vendorName ?? updates.expenseCategory ?? 'Receipt rule'
  const suggestedName = `${suggestedNameBase} auto-tag`

  return {
    suggestedName,
    matchDescription,
    direction,
    amountValue,
    details,
    transactionType: transaction.transaction_type,
    setVendorName: updates.vendorName ?? null,
    setExpenseCategory: updates.expenseCategory ?? null,
  }
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

  const { statusAutoUpdated: autoApplied, classificationUpdated: autoClassified } =
    await applyAutomationRules(insertedIds)

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

  await classifyTransactionsWithAI(supabase, insertedIds)

  await logAuditEvent({
    operation_type: 'create',
    resource_type: 'receipt_batch',
    resource_id: batch.id,
    operation_status: 'success',
    additional_info: {
      filename: receiptFile.name,
      rows: rows.length,
      inserted: insertedIds.length,
      skipped: rows.length - insertedIds.length,
      auto_applied: autoApplied,
      auto_classified: autoClassified,
    },
  })

  revalidatePath('/receipts')
  revalidatePath('/receipts/vendors')
  revalidatePath('/receipts/monthly')

  return {
    success: true,
    inserted: insertedIds.length,
    skipped: rows.length - insertedIds.length,
    autoApplied,
    autoClassified,
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
    operation_type: 'update_status',
    resource_type: 'receipt_transaction',
    resource_id: input.transactionId,
    operation_status: 'success',
    additional_info: {
      previous_status: existing.status,
      new_status: updated.status,
      note: validation.data.note ?? null,
    },
  })

  revalidatePath('/receipts')

  return { success: true, transaction: updated }
}

export async function updateReceiptClassification(input: {
  transactionId: string
  vendorName?: string | null
  expenseCategory?: ReceiptExpenseCategory | null
}) {
  await checkUserPermission('receipts', 'manage')

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
  const { user_id } = await getCurrentUser()

  const { data: transaction, error: fetchError } = await supabase
    .from('receipt_transactions')
    .select('*')
    .eq('id', transactionId)
    .single()

  if (fetchError || !transaction) {
    return { error: 'Transaction not found' }
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
    return { success: true, transaction, ruleSuggestion: null }
  }

  updatePayload.updated_at = now

  const { data: updated, error: updateError } = await supabase
    .from('receipt_transactions')
    .update(updatePayload)
    .eq('id', transactionId)
    .select('*')
    .single()

  if (updateError || !updated) {
    console.error('Failed to update receipt classification:', updateError)
    return { error: 'Failed to update classification.' }
  }

  await supabase.from('receipt_transaction_logs').insert({
    transaction_id: transactionId,
    previous_status: transaction.status,
    new_status: updated.status,
    action_type: 'manual_classification',
    note: changeNotes.join(' | '),
    performed_by: user_id,
    rule_id: null,
    performed_at: now,
  })

  await logAuditEvent({
    operation_type: 'update_classification',
    resource_type: 'receipt_transaction',
    resource_id: transactionId,
    operation_status: 'success',
    additional_info: {
      vendor_changed: vendorChanged,
      expense_changed: expenseChanged,
      vendor: vendorName ?? null,
      expense: expenseCategory ?? null,
    },
  })

  const ruleSuggestion = buildRuleSuggestion(updated, {
    vendorName: vendorChanged ? vendorName ?? null : undefined,
    expenseCategory: expenseChanged ? expenseCategory ?? null : undefined,
  })

  revalidatePath('/receipts')

  return {
    success: true,
    transaction: updated,
    ruleSuggestion,
  }
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
    operation_type: 'upload_receipt',
    resource_type: 'receipt_transaction',
    resource_id: transactionId,
    operation_status: 'success',
    additional_info: {
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
    operation_type: 'delete_receipt',
    resource_type: 'receipt_file',
    resource_id: fileId,
    operation_status: 'success',
    additional_info: {
      transaction_id: receipt.transaction_id,
    },
  })

  revalidatePath('/receipts')

  return { success: true }
}

type RuleMutationResult =
  | { success: true; rule: ReceiptRule; canPromptRetro: true }
  | { error: string }

export async function createReceiptRule(formData: FormData): Promise<RuleMutationResult> {
  await checkUserPermission('receipts', 'manage')

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
    operation_type: 'create',
    resource_type: 'receipt_rule',
    resource_id: rule.id,
    operation_status: 'success',
    additional_info: parsed.data,
  })

  revalidatePath('/receipts')

  return { success: true, rule, canPromptRetro: true }
}

export async function updateReceiptRule(ruleId: string, formData: FormData): Promise<RuleMutationResult> {
  await checkUserPermission('receipts', 'manage')

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
    operation_type: 'update',
    resource_type: 'receipt_rule',
    resource_id: ruleId,
    operation_status: 'success',
    additional_info: parsed.data,
  })

  revalidatePath('/receipts')

  return { success: true, rule: updated, canPromptRetro: true }
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
    operation_type: 'toggle',
    resource_type: 'receipt_rule',
    resource_id: ruleId,
    operation_status: 'success',
    additional_info: { is_active: isActive },
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
    operation_type: 'delete',
    resource_type: 'receipt_rule',
    resource_id: ruleId,
    operation_status: 'success',
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

  if (filters.missingVendorOnly) {
    baseQuery = baseQuery.or('vendor_name.is.null,vendor_name.eq.')
  }

  if (filters.missingExpenseOnly) {
    baseQuery = baseQuery.is('expense_category', null)
  }

  baseQuery = baseQuery.range(offset, offset + pageSize - 1)

  const vendorQuery = supabase
    .from('receipt_transactions')
    .select('vendor_name')
    .not('vendor_name', 'is', null)
    .neq('vendor_name', '')
    .order('vendor_name', { ascending: true })
    .limit(2000)

  const [
    { data: transactions, count, error },
    { data: rules },
    summary,
    { data: vendorRecords, error: vendorError },
  ] = await Promise.all([
    baseQuery,
    supabase
      .from('receipt_rules')
      .select('*')
      .order('created_at', { ascending: true }),
    fetchSummary(),
    vendorQuery,
  ])

  if (error) {
    console.error('Failed to load receipts workspace:', error)
    throw error
  }

  if (vendorError) {
    console.error('Failed to load vendor list for receipts workspace:', vendorError)
  }

  const shapedTransactions = (transactions ?? []).map((tx) => ({
    ...tx,
    files: tx.receipt_files ?? [],
    autoRule: tx.receipt_rules?.[0] ?? null,
  }))

  const knownVendorSet = new Set<string>()

  ;(vendorRecords ?? []).forEach((record) => {
    const normalized = normalizeVendorInput(record.vendor_name)
    if (normalized) {
      knownVendorSet.add(normalized)
    }
  })

  shapedTransactions.forEach((tx) => {
    const normalized = normalizeVendorInput(tx.vendor_name)
    if (normalized) {
      knownVendorSet.add(normalized)
    }
  })

  ;(rules ?? []).forEach((rule) => {
    const normalized = normalizeVendorInput(rule.set_vendor_name)
    if (normalized) {
      knownVendorSet.add(normalized)
    }
  })

  const knownVendors = Array.from(knownVendorSet).sort((a, b) => a.localeCompare(b))

  return {
    transactions: shapedTransactions,
    rules: rules ?? [],
    summary,
    pagination: {
      page,
      pageSize,
      total: count ?? 0,
    },
    knownVendors,
  }
}

export async function getReceiptBulkReviewData(options: {
  limit?: number
  statuses?: BulkStatus[]
  onlyUnclassified?: boolean
} = {}): Promise<ReceiptBulkReviewData> {
  await checkUserPermission('receipts', 'manage')

  const parsed = bulkGroupQuerySchema.safeParse(options ?? {})
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid bulk review filters')
  }

  const limit = parsed.data.limit ?? 10
  const statuses = parsed.data.statuses && parsed.data.statuses.length
    ? (Array.from(new Set(parsed.data.statuses)) as BulkStatus[])
    : (['pending'] as BulkStatus[])
  const onlyUnclassified = parsed.data.onlyUnclassified ?? true

  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('get_receipt_detail_groups', {
    limit_groups: limit,
    include_statuses: statuses,
    only_unclassified: onlyUnclassified,
  })

  if (error) {
    console.error('Failed to fetch receipt detail groups', error)
    throw error
  }

  const rows = (data ?? []) as RpcDetailGroupRow[]
  const openAIEnabled = Boolean(process.env.OPENAI_API_KEY)

  const groups: ReceiptDetailGroup[] = []

  for (const row of rows) {
    const normalized = normalizeDetailGroupRow(row)
    const suggestion = await buildGroupSuggestion(supabase, normalized, openAIEnabled)

    groups.push({
      details: normalized.details,
      transactionIds: normalized.transactionIds,
      transactionCount: normalized.transactionCount,
      needsVendorCount: normalized.needsVendorCount,
      needsExpenseCount: normalized.needsExpenseCount,
      totalIn: roundToCurrency(normalized.totalIn),
      totalOut: roundToCurrency(normalized.totalOut),
      firstDate: normalized.firstDate,
      lastDate: normalized.lastDate,
      dominantVendor: normalized.dominantVendor,
      dominantExpense: normalized.dominantExpense,
      sampleTransaction: normalized.sampleTransaction,
      suggestion,
    })
  }

  return {
    groups,
    generatedAt: new Date().toISOString(),
    config: {
      limit,
      statuses,
      onlyUnclassified,
      openAIEnabled,
    },
  }
}

export async function applyReceiptGroupClassification(input: {
  details: string
  vendorName?: string | null
  expenseCategory?: ReceiptExpenseCategory | null
  statuses?: BulkStatus[]
}) {
  await checkUserPermission('receipts', 'manage')

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
  const { user_id } = await getCurrentUser()

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
    .select('id, status')
    .eq('details', parsed.data.details)
    .in('status', statuses)

  const { data: matches, error: selectError } = await selection

  if (selectError) {
    console.error('Failed to load transactions for bulk classification', selectError)
    return { error: 'Failed to load matching transactions' }
  }

  if (!matches?.length) {
    return { success: true, updated: 0 }
  }

  const now = new Date().toISOString()

  const updatePayload: Record<string, unknown> = {
    updated_at: now,
  }

  if (vendorProvided) {
    updatePayload.vendor_name = normalizedVendor
    updatePayload.vendor_source = normalizedVendor ? 'manual' : null
    updatePayload.vendor_rule_id = null
    updatePayload.vendor_updated_at = now
  }

  if (expenseProvided) {
    updatePayload.expense_category = normalizedExpense ?? null
    updatePayload.expense_category_source = normalizedExpense ? 'manual' : null
    updatePayload.expense_rule_id = null
    updatePayload.expense_updated_at = now
  }

  const ids = matches.map((row) => row.id)

  const { error: updateError } = await supabase
    .from('receipt_transactions')
    .update(updatePayload)
    .in('id', ids)

  if (updateError) {
    console.error('Failed to apply bulk classification', updateError)
    return { error: 'Failed to apply changes' }
  }

  const summaryParts: string[] = []
  if (vendorProvided) {
    summaryParts.push(normalizedVendor ? `Vendor → ${normalizedVendor}` : 'Vendor cleared')
  }
  if (expenseProvided) {
    summaryParts.push(normalizedExpense ? `Expense → ${normalizedExpense}` : 'Expense cleared')
  }

  const note = `Bulk classification: ${summaryParts.join(' | ')}`
  const statusMap = new Map(matches.map((row) => [row.id, row.status]))

  const logs = ids.map((id) => ({
    transaction_id: id,
    previous_status: statusMap.get(id) ?? 'pending',
    new_status: statusMap.get(id) ?? 'pending',
    action_type: 'bulk_classification' as const,
    note,
    performed_by: user_id,
    rule_id: null,
    performed_at: now,
  }))

  if (logs.length) {
    const { error: logError } = await supabase.from('receipt_transaction_logs').insert(logs)
    if (logError) {
      console.error('Failed to record bulk classification logs', logError)
    }
  }

  await logAuditEvent({
    operation_type: 'bulk_classification',
    resource_type: 'receipt_transaction_group',
    resource_id: hashDetails(parsed.data.details),
    operation_status: 'success',
    additional_info: {
      details: parsed.data.details,
      vendor_applied: vendorProvided,
      expense_applied: expenseProvided,
      vendor_value: normalizedVendor,
      expense_value: normalizedExpense,
      statuses,
      count: ids.length,
    },
  })

  revalidatePath('/receipts')
  revalidatePath('/receipts/bulk')

  return { success: true, updated: ids.length }
}

export async function createReceiptRuleFromGroup(input: {
  name: string
  details: string
  matchDescription?: string
  description?: string
  direction?: 'in' | 'out' | 'both'
  autoStatus?: ReceiptTransaction['status']
  vendorName?: string | null
  expenseCategory?: ReceiptExpenseCategory | null
}) {
  await checkUserPermission('receipts', 'manage')

  const parsed = groupRuleInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid rule details' }
  }

  const data = parsed.data
  const vendor = normalizeVendorInput(data.vendorName ?? null)
  const expense = coerceExpenseCategory(data.expenseCategory ?? null)

  const formData = new FormData()
  formData.set('name', data.name)
  if (data.description) {
    formData.set('description', data.description)
  }
  formData.set('match_description', data.matchDescription ?? data.details)
  formData.set('match_direction', data.direction)
  formData.set('auto_status', data.autoStatus)
  formData.set('match_transaction_type', '')
  if (vendor) {
    formData.set('set_vendor_name', vendor)
  }
  if (expense) {
    formData.set('set_expense_category', expense)
  }

  const result = await createReceiptRule(formData)

  if ('success' in result) {
    revalidatePath('/receipts/bulk')
  }

  return result
}

async function fetchSummary(): Promise<ReceiptWorkspaceSummary> {
  const supabase = createAdminClient()
  const [{ data: statusCounts }, { data: lastBatch }, { data: costData, error: costError }] = await Promise.all([
    supabase.rpc('count_receipt_statuses'),
    supabase
      .from('receipt_batches')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc('get_openai_usage_total'),
  ])

  const counts = Array.isArray(statusCounts) ? statusCounts[0] : statusCounts

  if (costError) {
    console.error('Failed to fetch OpenAI usage total', costError)
  }

  const pending = Number(counts?.pending ?? 0)
  const completed = Number(counts?.completed ?? 0)
  const autoCompleted = Number(counts?.auto_completed ?? 0)
  const noReceiptRequired = Number(counts?.no_receipt_required ?? 0)
  const openAICost = costError ? 0 : Number(costData ?? 0)

  return {
    totals: {
      pending,
      completed,
      autoCompleted,
      noReceiptRequired,
    },
    needsAttentionValue: pending,
    lastImport: lastBatch ?? null,
    openAICost,
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

export async function runReceiptRuleRetroactively(
  ruleId: string,
  scope: 'pending' | 'all' = 'pending'
) {
  const start = Date.now()
  const timeBudgetMs = 12_000

  let offset = 0
  let totals = {
    reviewed: 0,
    matched: 0,
    statusAutoUpdated: 0,
    classificationUpdated: 0,
    vendorIntended: 0,
    expenseIntended: 0,
  }
  let samples: AutomationResult['samples'] = []
  let totalRecords = 0

  while (true) {
    const step = await runReceiptRuleRetroactivelyStep({ ruleId, scope, offset })

    if (!step.success) {
      return { error: step.error }
    }

    totals = {
      reviewed: totals.reviewed + step.reviewed,
      matched: totals.matched + step.matched,
      statusAutoUpdated: totals.statusAutoUpdated + step.statusAutoUpdated,
      classificationUpdated: totals.classificationUpdated + step.classificationUpdated,
      vendorIntended: totals.vendorIntended + step.vendorIntended,
      expenseIntended: totals.expenseIntended + step.expenseIntended,
    }

    if (!samples.length && step.samples.length) {
      samples = step.samples
    }

    offset = step.nextOffset
    totalRecords = step.total

    if (step.done) {
      await finalizeReceiptRuleRetroRun({
        ruleId,
        scope,
        reviewed: totals.reviewed,
        statusAutoUpdated: totals.statusAutoUpdated,
        classificationUpdated: totals.classificationUpdated,
        matched: totals.matched,
        vendorIntended: totals.vendorIntended,
        expenseIntended: totals.expenseIntended,
      })

      return {
        success: true,
        ruleId,
        reviewed: totals.reviewed,
        autoApplied: totals.statusAutoUpdated,
        classified: totals.classificationUpdated,
        matched: totals.matched,
        vendorIntended: totals.vendorIntended,
        expenseIntended: totals.expenseIntended,
        samples,
        scope,
        done: true,
      }
    }

    if (Date.now() - start > timeBudgetMs) {
      console.warn('[retro] time budget exceeded, returning partial result', {
        ruleId,
        scope,
        offset,
        totals,
        totalRecords,
      })
      return {
        success: true,
        ruleId,
        reviewed: totals.reviewed,
        autoApplied: totals.statusAutoUpdated,
        classified: totals.classificationUpdated,
        matched: totals.matched,
        vendorIntended: totals.vendorIntended,
        expenseIntended: totals.expenseIntended,
        samples,
        scope,
        done: false,
        nextOffset: offset,
        total: totalRecords,
      }
    }
  }
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

function parseTopList(input: unknown): Array<{ label: string; amount: number }> {
  if (!input) return []
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        const label = typeof item?.label === 'string' ? item.label : 'Uncategorised'
        const amount = Number(item?.amount ?? 0)
        return { label, amount }
      })
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      return parseTopList(parsed)
    } catch (_error) {
      return []
    }
  }

  if (typeof input === 'object') {
    return parseTopList([input])
  }

  return []
}

export async function getMonthlyReceiptSummary(limit = 12): Promise<ReceiptMonthlySummaryItem[]> {
  await checkUserPermission('receipts', 'view')

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_receipt_monthly_summary', {
    limit_months: limit,
  })

  if (error) {
    console.error('Failed to load monthly receipt summary', error)
    throw error
  }

  const rows = Array.isArray(data) ? data : []

  return rows.map((row) => ({
    monthStart: row.month_start,
    totalIncome: Number(row.total_income ?? 0),
    totalOutgoing: Number(row.total_outgoing ?? 0),
    topIncome: parseTopList(row.top_income),
    topOutgoing: parseTopList(row.top_outgoing),
  }))
}

export async function getReceiptVendorSummary(monthWindow = 12): Promise<ReceiptVendorSummary[]> {
  await checkUserPermission('receipts', 'view')

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_receipt_vendor_trends', {
    month_window: monthWindow,
  })

  if (error) {
    console.error('Failed to load vendor trends', error)
    throw error
  }

  const rows = Array.isArray(data) ? data : []
  const grouped = new Map<string, ReceiptVendorTrendMonth[]>()

  rows.forEach((row) => {
    const vendorLabel = row.vendor_label ?? 'Uncategorised'
    const list = grouped.get(vendorLabel) ?? []
    list.push({
      monthStart: row.month_start,
      totalOutgoing: Number(row.total_outgoing ?? 0),
      totalIncome: Number(row.total_income ?? 0),
      transactionCount: Number(row.transaction_count ?? 0),
    })
    grouped.set(vendorLabel, list)
  })

  const summaries: ReceiptVendorSummary[] = []

  grouped.forEach((months, vendorLabel) => {
    months.sort((a, b) => a.monthStart.localeCompare(b.monthStart))

    const totalOutgoing = months.reduce((sum, month) => sum + month.totalOutgoing, 0)
    const totalIncome = months.reduce((sum, month) => sum + month.totalIncome, 0)

    if (!totalOutgoing) {
      return
    }

    if (vendorLabel === 'Uncategorised') {
      return
    }

    const recent = months.slice(-3)
    const previous = months.slice(-6, -3)

    const average = (items: ReceiptVendorTrendMonth[]) =>
      items.length ? items.reduce((sum, item) => sum + item.totalOutgoing, 0) / items.length : 0

    const recentAverage = average(recent)
    const previousAverage = average(previous)

    let changePercentage = 0
    if (previousAverage === 0) {
      changePercentage = recentAverage > 0 ? 100 : 0
    } else {
      changePercentage = Number((((recentAverage - previousAverage) / previousAverage) * 100).toFixed(2))
    }

    summaries.push({
      vendorLabel,
      months,
      totalOutgoing,
      totalIncome,
      recentAverageOutgoing: Number(recentAverage.toFixed(2)),
      previousAverageOutgoing: Number(previousAverage.toFixed(2)),
      changePercentage,
    })
  })

  summaries.sort((a, b) => b.totalOutgoing - a.totalOutgoing)

  return summaries
}
