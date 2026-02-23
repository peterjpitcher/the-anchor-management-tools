'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { recordAIUsage } from '@/lib/receipts/ai-classification'
import { selectBestReceiptRule } from '@/lib/receipts/rule-matching'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobQueue } from '@/lib/unified-job-queue'
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
import { classifyReceiptTransaction } from '@/lib/openai'
import { getOpenAIConfig } from '@/lib/openai/config'

const RECEIPT_BUCKET = 'receipts'
const MAX_RECEIPT_UPLOAD_SIZE = 15 * 1024 * 1024 // 15 MB safety limit (keep in sync with next.config.mjs)
const DEFAULT_PAGE_SIZE = 25
const MAX_MONTH_PAGE_SIZE = 5000
const RECEIPT_AI_JOB_CHUNK_SIZE = 10
const EXPENSE_CATEGORY_OPTIONS = receiptExpenseCategorySchema.options
const BULK_STATUS_OPTIONS = receiptTransactionStatusSchema.options
const OUTSTANDING_STATUSES: ReceiptTransaction['status'][] = ['pending']
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

export type ReceiptSortColumn = 'transaction_date' | 'details' | 'amount_in' | 'amount_out' | 'amount_total'

export type ReceiptWorkspaceFilters = {
  status?: ReceiptTransaction['status'] | 'all'
  direction?: 'in' | 'out' | 'all'
  search?: string
  showOnlyOutstanding?: boolean
  missingVendorOnly?: boolean
  missingExpenseOnly?: boolean
  month?: string
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
    cantFind: number
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
  availableMonths: string[]
}

export type ReceiptMissingExpenseSummaryItem = {
  vendorLabel: string
  transactionCount: number
  totalOutgoing: number
  totalIncoming: number
  latestTransaction?: string | null
}

export type ReceiptMonthlySummaryItem = {
  monthStart: string
  totalIncome: number
  totalOutgoing: number
  topIncome: Array<{ label: string; amount: number }>
  topOutgoing: Array<{ label: string; amount: number }>
}

export type ReceiptMonthlyInsightMonth = {
  monthStart: string
  totalIncome: number
  totalOutgoing: number
  netCash: number
  topIncome: Array<{ label: string; amount: number }>
  topOutgoing: Array<{ label: string; amount: number }>
  incomeBreakdown: Array<{ label: string; amount: number }>
  spendingBreakdown: Array<{ label: string; amount: number }>
  statusCounts: Record<ReceiptTransaction['status'], number>
}

export type ReceiptMonthlyInsights = {
  months: ReceiptMonthlyInsightMonth[]
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

export type ReceiptVendorMonthTransaction = Pick<ReceiptTransaction,
  'id' | 'transaction_date' | 'details' | 'amount_in' | 'amount_out' | 'status' | 'transaction_type' | 'vendor_name'
>

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

function sanitizeReceiptSearchTerm(input: string): string {
  return sanitizeText(input)
    .replace(/[,%_()"'\\]/g, '')
    .slice(0, 80)
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

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return []
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
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

function isIncomingOnlyTransaction(tx: { amount_in: number | null; amount_out: number | null }): boolean {
  const hasIncoming = typeof tx.amount_in === 'number' && tx.amount_in > 0
  const hasOutgoing = typeof tx.amount_out === 'number' && tx.amount_out > 0
  return hasIncoming && !hasOutgoing
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
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { success: false, error: 'Insufficient permissions' }
  }

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
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return { success: true }
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

async function enqueueReceiptAiClassificationJobs(transactionIds: string[], batchId: string) {
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

export async function importReceiptStatement(formData: FormData) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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

  let aiJobsQueued = 0
  let aiJobsFailed = 0

  try {
    const queuedResult = await enqueueReceiptAiClassificationJobs(insertedIds, batch.id)
    aiJobsQueued = queuedResult.queued
    aiJobsFailed = queuedResult.failed
  } catch (error) {
    console.error('Failed to enqueue receipt AI classification jobs', error)
  }

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
      ai_jobs_queued: aiJobsQueued,
      ai_jobs_failed: aiJobsFailed,
    },
  })

  revalidatePath('/receipts')
  revalidatePath('/receipts/vendors')
  revalidatePath('/receipts/monthly')
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

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
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
    .maybeSingle()

  if (updateError) {
    console.error('Failed to update receipt transaction:', updateError)
    return { error: 'Failed to update the transaction.' }
  }
  if (!updated) {
    return { error: 'Transaction not found' }
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
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return { success: true, transaction: updated }
}

export async function updateReceiptClassification(input: {
  transactionId: string
  vendorName?: string | null
  expenseCategory?: ReceiptExpenseCategory | null
}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
    return { success: true, transaction, ruleSuggestion: null }
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
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return {
    success: true,
    transaction: updated,
    ruleSuggestion,
  }
}

export async function uploadReceiptForTransaction(formData: FormData) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
    const { error: cleanupStorageError } = await supabase.storage.from(RECEIPT_BUCKET).remove([storagePath])
    if (cleanupStorageError) {
      console.error('Failed to cleanup receipt storage after metadata insert error:', cleanupStorageError)
      return { error: 'Failed to store receipt metadata. Uploaded file cleanup requires manual reconciliation.' }
    }

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
    performed_by: user_id,
    rule_id: null,
    performed_at: now,
  })

  if (uploadLogError) {
    console.error('Failed to record receipt upload transaction log:', uploadLogError)
  }

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
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return { success: true, receipt }
}

export async function deleteReceiptFile(fileId: string) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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

  const { data: transaction, error: transactionError } = await supabase
    .from('receipt_transactions')
    .select('*')
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

  const now = new Date().toISOString()

  const { error: deleteLogError } = await supabase.from('receipt_transaction_logs').insert({
    transaction_id: receipt.transaction_id,
    previous_status: transaction?.status ?? null,
    new_status: 'pending',
    action_type: 'receipt_deleted',
    note: 'Receipt removed by user',
    performed_by: user_id,
    rule_id: null,
    performed_at: now,
  })

  if (deleteLogError) {
    console.error('Failed to record receipt deletion transaction log:', deleteLogError)
  }

  // If there are no receipts left, revert to pending
  const { data: remaining, error: remainingError } = await supabase
    .from('receipt_files')
    .select('id')
    .eq('transaction_id', receipt.transaction_id)

  if (remainingError) {
    console.error('Failed to check for remaining receipts:', remainingError)
    return { error: 'Receipt was removed, but failed to verify remaining receipt files.' }
  }

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
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return { success: true }
}

type RuleMutationResult =
  | { success: true; rule: ReceiptRule; canPromptRetro: true }
  | { error: string }

export async function createReceiptRule(formData: FormData): Promise<RuleMutationResult> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return { success: true, rule, canPromptRetro: true }
}

export async function updateReceiptRule(ruleId: string, formData: FormData): Promise<RuleMutationResult> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
  const { user_id } = await getCurrentUser()

  const { data: updated, error } = await supabase
    .from('receipt_rules')
    .update({
      ...parsed.data,
      updated_by: user_id,
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

  await logAuditEvent({
    operation_type: 'update',
    resource_type: 'receipt_rule',
    resource_id: ruleId,
    operation_status: 'success',
    additional_info: parsed.data,
  })

  revalidatePath('/receipts')
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return { success: true, rule: updated, canPromptRetro: true }
}

export async function toggleReceiptRule(ruleId: string, isActive: boolean) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return { success: true, rule: updated }
}

export async function deleteReceiptRule(ruleId: string) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return { success: true }
}

function resolveMonthRange(month?: string) {
  if (!month) return null
  const match = /^([0-9]{4})-([0-9]{2})$/.exec(month)
  if (!match) return null

  const year = Number.parseInt(match[1], 10)
  const monthIndex = Number.parseInt(match[2], 10) - 1
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null
  }

  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 1))

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

export async function getReceiptWorkspaceData(filters: ReceiptWorkspaceFilters = {}): Promise<ReceiptWorkspaceData> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }

  const supabase = createAdminClient()

  const monthRange = resolveMonthRange(filters.month)
  const isMonthScoped = Boolean(monthRange)
  const maxPageSize = isMonthScoped ? MAX_MONTH_PAGE_SIZE : 100
  const requestedPageSize = filters.pageSize ?? (isMonthScoped ? MAX_MONTH_PAGE_SIZE : DEFAULT_PAGE_SIZE)
  const pageSize = Math.min(requestedPageSize, maxPageSize)
  const page = isMonthScoped ? 1 : Math.max(filters.page ?? 1, 1)
  const offset = isMonthScoped ? 0 : (page - 1) * pageSize

  const isAllTimeView = !filters.month
  const defaultSortColumn: ReceiptSortColumn = isAllTimeView ? 'amount_total' : 'transaction_date'
  const sortColumn: ReceiptSortColumn = filters.sortBy ?? defaultSortColumn
  const sortDirection: 'asc' | 'desc' = filters.sortDirection === 'asc' ? 'asc' : 'desc'

  const orderDefinitions: Array<{ column: ReceiptSortColumn; ascending: boolean; nullsFirst?: boolean }> = []

  const isAscending = sortDirection === 'asc'
  orderDefinitions.push({
    column: sortColumn,
    ascending: isAscending,
    nullsFirst: sortColumn === 'amount_total' ? false : undefined,
  })

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
    baseQuery = baseQuery.order(order.column, { ascending: order.ascending, nullsFirst: order.nullsFirst })
  })

  if (filters.status && filters.status !== 'all') {
    baseQuery = baseQuery.eq('status', filters.status)
  }

  if (filters.showOnlyOutstanding && !filters.status) {
    baseQuery = baseQuery.in('status', OUTSTANDING_STATUSES)
  }

  if (filters.direction && filters.direction !== 'all') {
    if (filters.direction === 'in') {
      baseQuery = baseQuery.not('amount_in', 'is', null)
    } else {
      baseQuery = baseQuery.not('amount_out', 'is', null)
    }
  }

  if (filters.search) {
    const sanitizedSearch = sanitizeReceiptSearchTerm(filters.search.toLowerCase())
    if (sanitizedSearch.length > 0) {
      const qs = `%${sanitizedSearch}%`
      baseQuery = baseQuery.or(`details.ilike.${qs},transaction_type.ilike.${qs}`)
    }
  }

  if (filters.missingVendorOnly) {
    baseQuery = baseQuery.or('vendor_name.is.null,vendor_name.eq.')
  }

  if (filters.missingExpenseOnly) {
    baseQuery = baseQuery.is('expense_category', null).not('amount_out', 'is', null)
  }

  if (monthRange) {
    baseQuery = baseQuery.gte('transaction_date', monthRange.start).lt('transaction_date', monthRange.end)
  }

  baseQuery = baseQuery.range(offset, offset + pageSize - 1)

  const vendorQuery = supabase
    .from('receipt_transactions')
    .select('vendor_name')
    .not('vendor_name', 'is', null)
    .neq('vendor_name', '')
    .order('vendor_name', { ascending: true })
    .limit(2000)

  const monthsQuery = supabase.rpc('get_receipt_monthly_summary', {
    limit_months: 1000,
  })

  const [
    { data: transactions, count, error },
    { data: rules },
    summary,
    { data: vendorRecords, error: vendorError },
    { data: monthSummary, error: monthError },
  ] = await Promise.all([
    baseQuery,
    supabase
      .from('receipt_rules')
      .select('*')
      .order('created_at', { ascending: true }),
    fetchSummary(),
    vendorQuery,
    monthsQuery,
  ])

  if (error) {
    console.error('Failed to load receipts workspace:', error)
    throw error
  }

  if (vendorError) {
    console.error('Failed to load vendor list for receipts workspace:', vendorError)
  }

  if (monthError) {
    console.error('Failed to load month list for receipts workspace:', monthError)
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

  const enrichedSummary: ReceiptWorkspaceSummary = {
    ...summary,
    totals: {
      pending: summary.totals.pending ?? 0,
      completed: summary.totals.completed ?? 0,
      autoCompleted: summary.totals.autoCompleted ?? 0,
      noReceiptRequired: summary.totals.noReceiptRequired ?? 0,
      cantFind: summary.totals.cantFind ?? 0,
    },
  }

  const availableMonthsSet = new Set<string>()

  const monthRows = Array.isArray(monthSummary) ? monthSummary : []
  monthRows.forEach((row) => {
    const value = typeof row?.month_start === 'string' ? row.month_start.slice(0, 7) : null
    if (value) {
      availableMonthsSet.add(value)
    }
  })

  if (filters.month) {
    availableMonthsSet.add(filters.month)
  }

  const availableMonths = Array.from(availableMonthsSet)
    .filter((value) => monthRows.some((row) => row?.month_start?.startsWith(value)))
    .sort((a, b) => b.localeCompare(a))

  const effectivePageSize = isMonthScoped ? MAX_MONTH_PAGE_SIZE : pageSize

  return {
    transactions: shapedTransactions,
    rules: rules ?? [],
    summary: enrichedSummary,
    pagination: {
      page,
      pageSize: effectivePageSize,
      total: count ?? shapedTransactions.length,
    },
    knownVendors,
    availableMonths,
  }
}

export async function getReceiptBulkReviewData(options: {
  limit?: number
  statuses?: BulkStatus[]
  onlyUnclassified?: boolean
} = {}): Promise<ReceiptBulkReviewData> {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    throw new Error('Insufficient permissions')
  }

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
  const { apiKey } = await getOpenAIConfig()
  const openAIEnabled = Boolean(apiKey)

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
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
    .select('id, status, amount_in, amount_out')
    .eq('details', parsed.data.details)
    .in('status', statuses)

  const { data: matches, error: selectError } = await selection

  if (selectError) {
    console.error('Failed to load transactions for bulk classification', selectError)
    return { error: 'Failed to load matching transactions' }
  }

  const matchRows = (matches ?? []) as Array<Pick<ReceiptTransaction, 'id' | 'status' | 'amount_in' | 'amount_out'>>

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
      count: updatedIds.length,
      skipped_incoming_count: skippedIncomingCount,
    },
  })

  revalidatePath('/receipts')
  revalidatePath('/receipts/bulk')
  revalidateTag('dashboard')
  revalidatePath('/dashboard')

  return { success: true, updated: updatedIds.length, skippedIncomingCount }
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
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
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
  const cantFind = Number(counts?.cant_find ?? 0)
  const openAICost = costError ? 0 : Number(costData ?? 0)

  return {
    totals: {
      pending,
      completed,
      autoCompleted,
      noReceiptRequired,
      cantFind,
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
      const finalizeResult = await finalizeReceiptRuleRetroRun({
        ruleId,
        scope,
        reviewed: totals.reviewed,
        statusAutoUpdated: totals.statusAutoUpdated,
        classificationUpdated: totals.classificationUpdated,
        matched: totals.matched,
        vendorIntended: totals.vendorIntended,
        expenseIntended: totals.expenseIntended,
      })

      if (finalizeResult && 'error' in finalizeResult && finalizeResult.error) {
        return { error: finalizeResult.error }
      }

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
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { error: 'Insufficient permissions' }
  }
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
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }

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

export async function getMonthlyReceiptInsights(limit = 12): Promise<ReceiptMonthlyInsights> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }

  const supabase = createAdminClient()

  const [
    { data: summaryData, error: summaryError },
    { data: categoryData, error: categoryError },
    { data: incomeData, error: incomeError },
    { data: statusData, error: statusError },
  ] = await Promise.all([
    supabase.rpc('get_receipt_monthly_summary', { limit_months: limit }),
    supabase.rpc('get_receipt_monthly_category_breakdown', { limit_months: limit }),
    supabase.rpc('get_receipt_monthly_income_breakdown', { limit_months: limit }),
    supabase.rpc('get_receipt_monthly_status_counts', { limit_months: limit }),
  ])

  if (summaryError) {
    console.error('Failed to load monthly receipt summary', summaryError)
    throw summaryError
  }

  if (categoryError) {
    console.error('Failed to load monthly category breakdown', categoryError)
    throw categoryError
  }

  if (incomeError) {
    console.error('Failed to load monthly income breakdown', incomeError)
    throw incomeError
  }

  if (statusError) {
    console.error('Failed to load monthly status counts', statusError)
    throw statusError
  }

  const summaryRows = Array.isArray(summaryData) ? summaryData : []
  const categoryRows = Array.isArray(categoryData) ? categoryData : []
  const incomeRows = Array.isArray(incomeData) ? incomeData : []
  const statusRows = Array.isArray(statusData) ? statusData : []

  const monthMap = new Map<string, ReceiptMonthlyInsightMonth>()

  summaryRows.forEach((row: any) => {
    const monthStart = row.month_start as string
    const totalIncome = Number(row.total_income ?? 0)
    const totalOutgoing = Number(row.total_outgoing ?? 0)
    monthMap.set(monthStart, {
      monthStart,
      totalIncome,
      totalOutgoing,
      netCash: totalIncome - totalOutgoing,
      topIncome: parseTopList(row.top_income),
      topOutgoing: parseTopList(row.top_outgoing),
      incomeBreakdown: [],
      spendingBreakdown: [],
      statusCounts: {
        pending: 0,
        completed: 0,
        auto_completed: 0,
        no_receipt_required: 0,
        cant_find: 0,
      },
    })
  })

  categoryRows.forEach((row: any) => {
    const monthStart = row.month_start as string
    const entry = monthMap.get(monthStart)
    if (!entry) return

    entry.spendingBreakdown.push({
      label: row.category ?? 'Other',
      amount: Number(row.total_outgoing ?? 0),
    })
  })

  incomeRows.forEach((row: any) => {
    const monthStart = row.month_start as string
    const entry = monthMap.get(monthStart)
    if (!entry) return

    entry.incomeBreakdown.push({
      label: row.source ?? 'Other',
      amount: Number(row.total_income ?? 0),
    })
  })

  statusRows.forEach((row: any) => {
    const monthStart = row.month_start as string
    const entry = monthMap.get(monthStart)
    if (!entry) return

    const status = (row.status as ReceiptTransaction['status']) ?? 'pending'
    entry.statusCounts[status] = Number(row.total ?? 0)
  })

  const months = Array.from(monthMap.values()).sort((a, b) => b.monthStart.localeCompare(a.monthStart))

  const ensureSorted = (items: Array<{ label: string; amount: number }>) =>
    items
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount)

  months.forEach((month) => {
    month.incomeBreakdown = ensureSorted(month.incomeBreakdown)
    month.spendingBreakdown = ensureSorted(month.spendingBreakdown)
  })

  return { months }
}

export async function getReceiptVendorSummary(monthWindow = 12): Promise<ReceiptVendorSummary[]> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }

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

export async function getReceiptVendorMonthTransactions(input: {
  vendorLabel: string
  monthStart: string
}): Promise<{ transactions: ReceiptVendorMonthTransaction[]; error?: string }> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    return { transactions: [], error: 'Insufficient permissions' }
  }

  const normalizedVendor = normalizeVendorInput(input.vendorLabel)
  if (!normalizedVendor) {
    return { transactions: [] }
  }

  const startDate = new Date(input.monthStart)
  if (Number.isNaN(startDate.getTime())) {
    return { transactions: [], error: 'Invalid month provided' }
  }

  const start = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))
  const end = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1))

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('receipt_transactions')
    .select('id, transaction_date, details, amount_in, amount_out, status, vendor_name, transaction_type')
    .gte('transaction_date', start.toISOString())
    .lt('transaction_date', end.toISOString())
    .order('transaction_date', { ascending: true })
    .limit(1000)

  if (error) {
    console.error('Failed to load vendor month transactions', error)
    return { transactions: [], error: 'Failed to load transactions for this vendor.' }
  }

  const rows = Array.isArray(data) ? data : []

  const filtered = rows.filter((row) => normalizeVendorInput(row?.vendor_name) === normalizedVendor)

  return {
    transactions: filtered.map((row) => ({
      id: row.id,
      transaction_date: row.transaction_date,
      details: row.details,
      amount_in: row.amount_in,
      amount_out: row.amount_out,
      status: row.status,
      transaction_type: row.transaction_type,
      vendor_name: row.vendor_name,
    })),
  }
}

export async function getReceiptMissingExpenseSummary(): Promise<ReceiptMissingExpenseSummaryItem[]> {
  const canView = await checkUserPermission('receipts', 'view')
  if (!canView) {
    throw new Error('Insufficient permissions')
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('receipt_transactions')
    .select('vendor_name, amount_out, amount_in, transaction_date')
    .is('expense_category', null)
    .not('amount_out', 'is', null)

  if (error) {
    console.error('Failed to load missing expense summary', error)
    throw error
  }

  const summaryMap = new Map<string, ReceiptMissingExpenseSummaryItem>()

  ;(data ?? []).forEach((row) => {
    const normalizedVendor = normalizeVendorInput(row.vendor_name)
    const label = normalizedVendor ?? 'Unassigned vendor'
    const existing = summaryMap.get(label) ?? {
      vendorLabel: label,
      transactionCount: 0,
      totalOutgoing: 0,
      totalIncoming: 0,
      latestTransaction: null as string | null,
    }

    existing.transactionCount += 1
    existing.totalOutgoing += Number(row.amount_out ?? 0)
    existing.totalIncoming += Number(row.amount_in ?? 0)

    const currentDate = row.transaction_date ? new Date(row.transaction_date).getTime() : null
    const latestDate = existing.latestTransaction ? new Date(existing.latestTransaction).getTime() : null
    if (currentDate && (!latestDate || currentDate > latestDate)) {
      existing.latestTransaction = row.transaction_date
    }

    summaryMap.set(label, existing)
  })

  return Array.from(summaryMap.values()).sort((a, b) => {
    if (b.totalOutgoing !== a.totalOutgoing) {
      return b.totalOutgoing - a.totalOutgoing
    }
    return b.transactionCount - a.transactionCount
  })
}
