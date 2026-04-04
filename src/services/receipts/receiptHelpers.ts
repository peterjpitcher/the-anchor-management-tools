/**
 * Pure helper / utility functions used across query, mutation, and export modules.
 *
 * These functions are side-effect free (no DB access). They are safe to import
 * from any context.
 */

import { createHash } from 'crypto'
import Papa from 'papaparse'
import { z } from 'zod'
import {
  receiptExpenseCategorySchema,
  receiptTransactionStatusSchema,
} from '@/lib/validation'
import type {
  ReceiptExpenseCategory,
  ReceiptClassificationSource,
  ReceiptTransaction,
} from '@/types/database'
import type {
  CsvRow,
  ParsedTransactionRow,
  GroupSample,
  RpcDetailGroupRow,
  NormalizedDetailGroupRow,
  RuleSuggestion,
} from './types'
import { MAX_RECEIPT_UPLOAD_SIZE } from './types'

// ---------------------------------------------------------------------------
// Zod schemas shared by actions layer
// ---------------------------------------------------------------------------

export const EXPENSE_CATEGORY_OPTIONS = receiptExpenseCategorySchema.options
export const BULK_STATUS_OPTIONS = receiptTransactionStatusSchema.options

export const bulkGroupQuerySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  statuses: z.array(receiptTransactionStatusSchema).optional(),
  onlyUnclassified: z.boolean().optional(),
})

export const bulkGroupApplySchema = z.object({
  details: z.string().min(1),
  statuses: z.array(receiptTransactionStatusSchema).optional(),
  vendorName: z.union([z.string(), z.null()]).optional(),
  expenseCategory: z.union([z.string(), z.null()]).optional(),
})

export const groupRuleInputSchema = z.object({
  name: z.string().min(1).max(120),
  details: z.string().min(1),
  matchDescription: z.string().trim().max(300).optional(),
  description: z.string().trim().max(500).optional(),
  direction: z.enum(['in', 'out', 'both']).default('both'),
  autoStatus: receiptTransactionStatusSchema.default('no_receipt_required'),
  vendorName: z.union([z.string(), z.null()]).optional(),
  expenseCategory: z.union([z.string(), z.null()]).optional(),
})

export const classificationUpdateSchema = z.object({
  transactionId: z.string().uuid('Transaction reference is invalid'),
  vendorName: z
    .string()
    .trim()
    .max(120, 'Keep the vendor name under 120 characters')
    .nullable()
    .optional(),
  expenseCategory: receiptExpenseCategorySchema.nullable().optional(),
})

export const fileSchema = z.instanceof(File, { message: 'Please attach a CSV file' })
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.size <= MAX_RECEIPT_UPLOAD_SIZE, {
    message: 'CSV file is too large. Please keep bank statements under 15 MB.',
  })
  .refine((file) => file.type === 'text/csv' || file.name.endsWith('.csv'), {
    message: 'Only CSV bank statements are supported'
  })

export const ALLOWED_RECEIPT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif', // iOS may report HEIC files as image/heif depending on OS version
]

export const receiptFileSchema = z.instanceof(File, { message: 'Please choose a receipt file' })
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.size <= MAX_RECEIPT_UPLOAD_SIZE, {
    message: 'File is too large. Please keep receipts under 15MB.'
  })
  .refine(
    (file) => ALLOWED_RECEIPT_MIME_TYPES.includes(file.type),
    { message: 'Only PDF, PNG, JPG, GIF, WEBP, and HEIC files are accepted.' }
  )

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

export function sanitizeText(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
}

export function sanitizeReceiptSearchTerm(input: string): string {
  return sanitizeText(input)
    .replace(/[,%_()"'\\]/g, '')
    .slice(0, 80)
}

export function sanitizeForPath(input: string, fallback = 'receipt'): string {
  const cleaned = sanitizeText(input)
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
  return cleaned || fallback
}

export function sanitizeDescriptionForFilenameSegment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9\s&\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function composeReceiptFileArtifacts(
  transaction: ReceiptTransaction,
  amount: number,
  extension: string
): { friendlyName: string; storagePath: string } {
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

export function parseCsv(buffer: Buffer): ParsedTransactionRow[] {
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

export function normaliseDate(input: string): string | null {
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

export function parseCurrency(value: string | null | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned) return null
  const result = Number.parseFloat(cleaned)
  if (!Number.isFinite(result)) return null
  // Bank CSV exports should always use unsigned amounts in their respective column
  // (positive values in 'In' for credits, positive values in 'Out' for debits).
  // Negative values indicate a malformed or unexpected export format — reject them.
  if (result < 0) return null
  return Number(result.toFixed(2))
}

export function normalizeVendorInput(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 120)
}

export function coerceExpenseCategory(value: unknown): ReceiptExpenseCategory | null {
  const parsed = receiptExpenseCategorySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function hashDetails(details: string): string {
  return createHash('sha256').update(details).digest('hex').slice(0, 24)
}

export function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function roundToCurrency(value: number): number {
  return Number(value.toFixed(2))
}

export function parseSampleTransaction(value: unknown): GroupSample {
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

export function deriveDirection(amountIn: number | null, amountOut: number | null): 'in' | 'out' {
  const inValue = amountIn ?? 0
  const outValue = amountOut ?? 0
  if (outValue > 0 && outValue >= inValue) return 'out'
  if (inValue > 0) return 'in'
  return outValue > inValue ? 'out' : 'in'
}

export function createTransactionHash(input: {
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

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return []
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export function isParsedTransactionRow(tx: ParsedTransactionRow | ReceiptTransaction): tx is ParsedTransactionRow {
  return 'amountIn' in tx
}

export function getTransactionDirection(tx: ParsedTransactionRow | ReceiptTransaction): 'in' | 'out' {
  const amountIn = isParsedTransactionRow(tx) ? tx.amountIn : tx.amount_in
  const amountOut = isParsedTransactionRow(tx) ? tx.amountOut : tx.amount_out
  if (amountIn && amountIn > 0) return 'in'
  return 'out'
}

export function isIncomingOnlyTransaction(tx: { amount_in: number | null; amount_out: number | null }): boolean {
  const hasIncoming = typeof tx.amount_in === 'number' && tx.amount_in > 0
  const hasOutgoing = typeof tx.amount_out === 'number' && tx.amount_out > 0
  return hasIncoming && !hasOutgoing
}

export function guessAmountValue(tx: ParsedTransactionRow | ReceiptTransaction): number {
  const amountIn = isParsedTransactionRow(tx) ? tx.amountIn : tx.amount_in
  const amountOut = isParsedTransactionRow(tx) ? tx.amountOut : tx.amount_out
  if (amountIn && amountIn > 0) return amountIn
  if (amountOut && amountOut > 0) return amountOut
  return 0
}

export function normalizeDetailGroupRow(row: RpcDetailGroupRow): NormalizedDetailGroupRow {
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

export function buildRuleSuggestion(
  transaction: ReceiptTransaction,
  updates: {
    vendorName?: string | null
    expenseCategory?: ReceiptExpenseCategory | null
    suggestedRuleKeywords?: string | null
  }
): RuleSuggestion | null {
  if (!updates.vendorName && !updates.expenseCategory) {
    return null
  }

  const direction = getTransactionDirection(transaction)
  const amountValue = guessAmountValue(transaction)
  const details = transaction.details?.trim() ?? ''

  let matchDescription: string | null = null

  if (updates.suggestedRuleKeywords) {
    // Prefer AI-suggested keywords
    matchDescription = updates.suggestedRuleKeywords
  } else {
    // Fall back to heuristic: first 3 tokens of 4+ chars
    const keywords = details
      .split(/\s+/)
      .map((token) => token.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
      .filter((token) => token.length >= 4)
      .slice(0, 3)
    matchDescription = keywords.join(',') || null
  }

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

export function resolveMonthRange(month?: string): { start: string; end: string } | null {
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

export function parseTopList(input: unknown): Array<{ label: string; amount: number }> {
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

export function toOptionalNumber(input: FormDataEntryValue | null): number | undefined {
  if (typeof input !== 'string') return undefined
  const cleaned = input.trim()
  if (!cleaned) return undefined
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? Number(value.toFixed(2)) : undefined
}
