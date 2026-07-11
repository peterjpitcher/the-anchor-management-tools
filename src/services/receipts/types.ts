/**
 * Shared type definitions for the receipts service layer.
 *
 * Re-exported from `src/app/actions/receipts.ts` so that consumers
 * importing types from the actions file continue to work unchanged.
 */

import type {
  ReceiptBatch,
  ReceiptRule,
  ReceiptTransaction,
  ReceiptFile,
  ReceiptSourceType,
  ReceiptTransactionStatus,
  ReceiptExpenseCategory,
  ReceiptClassificationSource,
  ReceiptRuleConflict,
  ReceiptRuleSuggestion,
} from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  MAX_RECEIPT_FILE_UPLOAD_BYTES,
  MAX_RECEIPT_STATEMENT_UPLOAD_BYTES,
  RECEIPT_BUCKET_NAME,
} from '@/lib/receipts/upload-constraints'

// ---------------------------------------------------------------------------
// Internal utility types
// ---------------------------------------------------------------------------

export type AdminClient = ReturnType<typeof createAdminClient>

export type CsvRow = {
  Date: string
  Details: string
  'Transaction Type': string
  In: string
  Out: string
  Balance: string
}

export type AmexCsvRow = {
  Date: string
  Description: string
  'Card Member': string
  'Account #': string
  Amount: string
  'Extended Details': string
  'Appears On Your Statement As': string
  'Town/City': string
  Reference: string
  Category: string
}

export type ParsedTransactionRow = {
  transactionDate: string
  details: string
  transactionType: string | null
  amountIn: number | null
  amountOut: number | null
  balance: number | null
  dedupeHash: string
  // Source + Amex extensions. Bank rows omit these (treated as defaults downstream).
  sourceType?: ReceiptSourceType
  cardMember?: string | null
  cardAccount?: string | null
  merchantCategory?: string | null
  merchantTown?: string | null
  externalReference?: string | null
  status?: ReceiptTransactionStatus
  receiptRequired?: boolean
  expenseCategory?: ReceiptExpenseCategory | null
  expenseCategorySource?: ReceiptClassificationSource | null
  vendorName?: string | null
  vendorSource?: ReceiptClassificationSource | null
}

// ---------------------------------------------------------------------------
// Exported / public types (consumed by UI components)
// ---------------------------------------------------------------------------

export type ReceiptSortColumn = 'transaction_date' | 'details' | 'amount_in' | 'amount_out' | 'amount_total'

export type ReceiptWorkspaceFilters = {
  status?: ReceiptTransaction['status'] | 'all'
  direction?: 'in' | 'out' | 'all'
  sourceType?: 'bank' | 'amex' | 'all'
  cardMember?: string
  search?: string
  showOnlyOutstanding?: boolean
  groupByVendor?: boolean
  missingVendorOnly?: boolean
  missingExpenseOnly?: boolean
  month?: string
  page?: number
  pageSize?: number
  sortBy?: ReceiptSortColumn
  sortDirection?: 'asc' | 'desc'
}

type AIModelBreakdown = {
  model: string
  total_cost: number
  total_tokens: number
  call_count: number
}

export type AIUsageBreakdown = {
  total_cost: number
  this_month_cost: number
  total_classifications: number
  this_month_classifications: number
  model_breakdown: AIModelBreakdown[] | null
}

export type RulePreviewResult = {
  totalMatching: number
  pendingMatching: number
  wouldChangeStatus: number
  wouldChangeVendor: number
  wouldChangeExpense: number
  overlappingRules: Array<{ id: string; name: string; overlapCount: number }>
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
  aiUsageBreakdown?: AIUsageBreakdown | null
  failedAiJobCount: number
}

export type ReceiptWorkspaceData = {
  transactions: (ReceiptTransaction & {
    files: ReceiptFile[]
    autoRule?: Pick<ReceiptRule, 'id' | 'name'> | null
  })[]
  rules: ReceiptRule[]
  ruleConflicts: ReceiptRuleConflict[]
  ruleSuggestions: ReceiptRuleSuggestion[]
  suggestionsTotal: number
  summary: ReceiptWorkspaceSummary
  pagination: {
    page: number
    pageSize: number
    total: number
  }
  knownVendors: string[]
  availableMonths: string[]
  availableCardMembers: string[]
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

export type ReceiptVendorCostSignal = {
  vendorLabel: string
  severity: 'medium' | 'high'
  direction: 'spike' | 'drop' | 'new'
  recentAverageOutgoing: number
  previousAverageOutgoing: number
  recentTotalOutgoing: number
  previousTotalOutgoing: number
  absoluteDelta: number
  percentageChange: number
  reason: string
}

export type ReceiptVendorMovementRange = '12m' | '24m' | '36m' | 'all'

export type ReceiptVendorMovementComparison = 'mom' | 'yoy' | 'rolling_3m'

type ReceiptVendorMovementDirection = 'spike' | 'drop' | 'new' | 'resumed'

export type ReceiptVendorMovementSignal = {
  vendorLabel: string
  severity: 'medium' | 'high'
  direction: ReceiptVendorMovementDirection
  comparison: ReceiptVendorMovementComparison
  monthStart: string
  currentOutgoing: number
  baselineOutgoing: number
  baselineMonthStart: string | null
  absoluteDelta: number
  percentageChange: number
  reason: string
}

export type ReceiptVendorMovementMonth = ReceiptVendorTrendMonth & {
  momBaselineMonthStart: string | null
  momBaselineOutgoing: number | null
  momDelta: number | null
  momPercentageChange: number | null
  momBaselineAvailable: boolean
  momSignal: ReceiptVendorMovementSignal | null
  yoyBaselineMonthStart: string | null
  yoyBaselineOutgoing: number | null
  yoyDelta: number | null
  yoyPercentageChange: number | null
  yoyBaselineAvailable: boolean
  yoySignal: ReceiptVendorMovementSignal | null
}

export type ReceiptVendorMovementSummary = {
  vendorLabel: string
  range: ReceiptVendorMovementRange
  comparison: ReceiptVendorMovementComparison
  months: ReceiptVendorMovementMonth[]
  latestMonthStart: string | null
  latestOutgoing: number
  latestTransactionCount: number
  baselineMonthStart: string | null
  baselineOutgoing: number | null
  delta: number | null
  percentageChange: number | null
  signal: ReceiptVendorMovementSignal | null
  totalOutgoing: number
  transactionCount: number
}

export type ReceiptVendorAiReviewItem = {
  vendorLabel: string
  severity: 'medium' | 'high'
  direction: 'spike' | 'drop' | 'new' | 'resumed'
  reason: string
  suggestedReview: string
}

export type ReceiptVendorAiReview = {
  overview: string
  reviewItems: ReceiptVendorAiReviewItem[]
  source: 'ai' | 'deterministic'
  generatedAt: string
  model?: string | null
}

export type ReceiptVendorExpenseBreakdown = {
  expenseCategory: string
  totalOutgoing: number
  transactionCount: number
}

export type ReceiptVendorDetailTransaction = Pick<ReceiptTransaction,
  | 'id'
  | 'transaction_date'
  | 'details'
  | 'amount_in'
  | 'amount_out'
  | 'status'
  | 'transaction_type'
  | 'vendor_name'
  | 'vendor_source'
  | 'expense_category'
  | 'expense_category_source'
>

export type ReceiptVendorDetail = {
  vendorLabel: string
  months: ReceiptVendorTrendMonth[]
  totalOutgoing: number
  totalIncome: number
  transactionCount: number
  historyTotalOutgoing: number
  historyTotalIncome: number
  historyTransactionCount: number
  historyStartDate: string | null
  historyEndDate: string | null
  recentAverageOutgoing: number
  previousAverageOutgoing: number
  changePercentage: number
  signals: ReceiptVendorCostSignal[]
  movementMonths: ReceiptVendorMovementMonth[]
  movementSignals: ReceiptVendorMovementSignal[]
  categoryBreakdown: ReceiptVendorExpenseBreakdown[]
  transactions: ReceiptVendorDetailTransaction[]
  recentTransactions: ReceiptVendorDetailTransaction[]
}

export type ReceiptVendorWatchlistItem = {
  userId: string
  vendorKey: string
  vendorLabel: string
  createdAt: string
  updatedAt: string
}

export type ReceiptVendorReviewStatus = 'needs_review' | 'expected' | 'action_required' | 'reviewed'

export type ReceiptVendorReviewItem = {
  userId: string
  vendorKey: string
  vendorLabel: string
  comparison: ReceiptVendorMovementComparison
  monthStart: string
  status: ReceiptVendorReviewStatus
  createdAt: string
  updatedAt: string
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
    useFuzzyGrouping: boolean
  }
}

export type RpcDetailGroupRow = {
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

export type NormalizedDetailGroupRow = {
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

export type GroupSample = ReceiptDetailGroup['sampleTransaction']

export type AutomationResult = {
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

export type RuleSuggestion = {
  suggestedName: string
  matchDescription: string | null
  direction: 'in' | 'out'
  amountValue: number
  details: string
  setVendorName: string | null
  setExpenseCategory: ReceiptExpenseCategory | null
}

export type ClassificationRuleSuggestion = RuleSuggestion

export type RuleMutationResult =
  | { success: true; rule: ReceiptRule; canPromptRetro: true }
  | { error: string }

export type RetroStepSuccess = {
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

export type RetroStepResult = RetroStepSuccess | { success: false; error: string }

export type BulkStatus = ReceiptTransaction['status']

// ---------------------------------------------------------------------------
// Constants shared across service modules
// ---------------------------------------------------------------------------

export const RECEIPT_BUCKET = RECEIPT_BUCKET_NAME
const MAX_RECEIPT_STATEMENT_UPLOAD_SIZE = MAX_RECEIPT_STATEMENT_UPLOAD_BYTES
const MAX_RECEIPT_FILE_UPLOAD_SIZE = MAX_RECEIPT_FILE_UPLOAD_BYTES
const MAX_RECEIPT_UPLOAD_SIZE = MAX_RECEIPT_STATEMENT_UPLOAD_SIZE
export const DEFAULT_PAGE_SIZE = 25
export const MAX_MONTH_PAGE_SIZE = 5000
export const RECEIPT_AI_JOB_CHUNK_SIZE = 10
export const RETRO_CHUNK_SIZE = 100
export const OUTSTANDING_STATUSES: ReceiptTransaction['status'][] = ['pending']
