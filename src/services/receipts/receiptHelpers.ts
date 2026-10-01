/**
 * Pure helper / utility functions used across query, mutation, and export modules.
 *
 * These functions are side-effect free (no DB access). They are safe to import
 * from any context.
 */

import { createHash } from 'crypto'
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
  ParsedTransactionRow,
  GroupSample,
  RpcDetailGroupRow,
  NormalizedDetailGroupRow,
  RuleSuggestion,
} from './types'
import {
  MAX_RECEIPT_FILE_UPLOAD_BYTES,
  MAX_RECEIPT_STATEMENT_UPLOAD_BYTES,
  RECEIPT_FILE_UPLOAD_LIMIT_LABEL,
  RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL,
  isAllowedReceiptMimeType,
} from '@/lib/receipts/upload-constraints'

// Statement parsing has its own module. Re-exported so existing imports keep working.
export {
  createAmexTransactionHash,
  createTransactionHash,
  parseAmexCsv,
  parseAmexStatement,
  parseBankStatement,
  parseCsv,
  parseSignedAmount,
  parseStatementMoney,
} from './statementParsing'
export type {
  RejectedStatementRecord,
  StatementParseResult,
  StatementRejectionReason,
} from './statementParsing'

// ---------------------------------------------------------------------------
// Zod schemas shared by actions layer
// ---------------------------------------------------------------------------

export const EXPENSE_CATEGORY_OPTIONS = receiptExpenseCategorySchema.options
export const BULK_STATUS_OPTIONS = receiptTransactionStatusSchema.options

// Below this AI-reported confidence the AI classifier does not even propose a rule
// suggestion — keeps the suggestion queue trustworthy and cheap to review. (Lives here,
// a non-'use server' module, so it can be a plain const export.)
export const AI_SUGGESTION_MIN_CONFIDENCE = 70

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
  autoStatus: receiptTransactionStatusSchema.default('pending'),
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
  .refine((file) => file.size <= MAX_RECEIPT_STATEMENT_UPLOAD_BYTES, {
    message: `CSV file is too large. Please keep bank statements under ${RECEIPT_STATEMENT_UPLOAD_LIMIT_LABEL}.`,
  })
  // Windows saves the extension in capitals as often as not.
  .refine((file) => file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv'), {
    message: 'Only CSV bank statements are supported'
  })

export const receiptFileSchema = z.instanceof(File, { message: 'Please choose a receipt file' })
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.size <= MAX_RECEIPT_FILE_UPLOAD_BYTES, {
    message: `File is too large. Please keep receipts under ${RECEIPT_FILE_UPLOAD_LIMIT_LABEL}.`
  })
  .refine(
    (file) => isAllowedReceiptMimeType(file.type),
    { message: 'Only PDF, PNG, JPG, GIF, WEBP, and HEIC files are accepted.' }
  )

const receiptUploadMetadataBaseSchema = z.object({
  fileName: z.string().trim().min(1, 'Please choose a receipt file').max(255, 'File name is too long'),
  fileType: z.string().trim().min(1, 'File type is missing'),
  fileSize: z.number().int('Invalid file size').positive('File is empty'),
})

export const receiptUploadMetadataSchema = receiptUploadMetadataBaseSchema
  .refine((file) => file.fileSize <= MAX_RECEIPT_FILE_UPLOAD_BYTES, {
    message: `File is too large. Please keep receipts under ${RECEIPT_FILE_UPLOAD_LIMIT_LABEL}.`,
    path: ['fileSize'],
  })
  .refine((file) => isAllowedReceiptMimeType(file.fileType), {
    message: 'Only PDF, PNG, JPG, GIF, WEBP, and HEIC files are accepted.',
    path: ['fileType'],
  })

export const receiptUploadedObjectSchema = receiptUploadMetadataBaseSchema.extend({
  storagePath: z
    .string()
    .trim()
    .min(1, 'Missing uploaded receipt path')
    .max(500, 'Uploaded receipt path is too long')
    .regex(/^\d{4}\/[^/]+_\d{13}$/, 'Uploaded receipt path is invalid'),
})
  .refine((file) => file.fileSize <= MAX_RECEIPT_FILE_UPLOAD_BYTES, {
    message: `File is too large. Please keep receipts under ${RECEIPT_FILE_UPLOAD_LIMIT_LABEL}.`,
    path: ['fileSize'],
  })
  .refine((file) => isAllowedReceiptMimeType(file.fileType), {
    message: 'Only PDF, PNG, JPG, GIF, WEBP, and HEIC files are accepted.',
    path: ['fileType'],
  })

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

function sanitizeText(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
}

export function sanitizeReceiptSearchTerm(input: string): string {
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

export function normalizeVendorInput(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.toLowerCase() === 'null') return null
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

export function deriveDirection(amountIn: number | null, amountOut: number | null): 'in' | 'out' {
  const inValue = amountIn ?? 0
  const outValue = amountOut ?? 0
  if (outValue > 0 && outValue >= inValue) return 'out'
  if (inValue > 0) return 'in'
  return outValue > inValue ? 'out' : 'in'
}

export function chunkArray<T>(items: T[], size: number): T[][] {
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

// Words too generic to be a useful OR-keyword in a rule's match_description.
const RULE_KEYWORD_STOPLIST = new Set([
  'the', 'and', 'ltd', 'limited', 'plc', 'uk', 'gbr', 'gb', 'store', 'stores', 'card',
  'payment', 'purchase', 'refund', 'london', 'account', 'ref', 'www', 'com', 'co',
  'shop', 'online', 'services', 'service', 'group', 'holdings', 'retail',
])

// Local town/place tokens that appear in card descriptions (e.g. "TESCO STAINES").
// A rule should key off the vendor/brand, never the location — a lone location token
// would match every merchant in that town, so we drop these and, if a candidate keyword
// list contains ONLY locations, propose no rule at all.
const RULE_KEYWORD_LOCATION_STOPLIST = new Set([
  'staines', 'sunbury', 'camberley', 'london', 'clitheroe', 'waterstock', 'leatherhead',
  'westfield', 'hanworth', 'ashford', 'feltham',
])

// How many distinctive keywords a sanitized match_description may carry. Keeping this
// at 1 means a rule keys off the single most-distinctive (first) vendor token and never
// drags along trailing location/noise tokens (e.g. "TESCO ... STAINES" → "tesco"), which
// would otherwise broaden or misfire the rule.
const RULE_KEYWORD_LIMIT = 1

// Produce a comma-separated, de-noised keyword list for a rule's match_description.
// Prefers AI-suggested keywords, falls back to the transaction details. Returns null
// if nothing sufficiently distinctive remains (caller should then NOT create a rule).
export function sanitizeRuleKeywords(details: string, aiKeywords?: string | null): string | null {
  const raw = (aiKeywords && aiKeywords.trim().length > 0 ? aiKeywords : details) || ''
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const token of raw.split(/[\s,]+/)) {
    const cleaned = token.replace(/[^a-zA-Z0-9&]/g, '').toLowerCase()
    if (cleaned.length < 4) continue
    if (/^\d+$/.test(cleaned)) continue
    if (RULE_KEYWORD_STOPLIST.has(cleaned)) continue
    // A lone location/town token would match every merchant in that town, so drop it.
    // If the candidate list ends up location-only, no distinctive keyword survives and
    // we deliberately propose no rule (return null below).
    if (RULE_KEYWORD_LOCATION_STOPLIST.has(cleaned)) continue
    if (seen.has(cleaned)) continue
    seen.add(cleaned)
    keywords.push(cleaned)
    if (keywords.length >= RULE_KEYWORD_LIMIT) break
  }
  return keywords.length ? keywords.join(',') : null
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

  const matchDescription = sanitizeRuleKeywords(details, updates.suggestedRuleKeywords)
  if (!matchDescription) {
    // No distinctive keyword → don't propose an over-broad rule.
    return null
  }

  const suggestedNameBase = updates.vendorName ?? updates.expenseCategory ?? 'Receipt rule'
  const suggestedName = `${suggestedNameBase} auto-tag`

  return {
    suggestedName,
    matchDescription,
    direction,
    amountValue,
    details,
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
