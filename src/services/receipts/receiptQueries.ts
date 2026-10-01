/**
 * Read-only receipt query operations.
 *
 * All functions in this module perform SELECT-only database operations.
 * Auth checks are performed by the caller (server action layer).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { summarizeReceiptVendorCostReview } from '@/lib/openai'
import { getRuleMatch } from '@/lib/receipts/rule-matching'
import { recordAIUsage } from '@/lib/receipts/ai-classification'
import { buildDailyBankBalanceSeries, type BankBalanceRow } from '@/lib/receipts/bank-balance'
import type { ReceiptRule, ReceiptTransaction } from '@/types/database'

import type {
  AdminClient,
  ReceiptWorkspaceFilters,
  ReceiptWorkspaceData,
  ReceiptAiSuggestion,
  ReceiptWorkspaceSummary,
  ReceiptBulkReviewData,
  ReceiptDetailGroup,
  ReceiptDetailGroupSuggestion,
  NormalizedDetailGroupRow,
  ReceiptMonthlySummaryItem,
  ReceiptMonthlyInsights,
  ReceiptMonthlyInsightMonth,
  ReceiptBankBalanceHistory,
  ReceiptVendorSummary,
  ReceiptVendorTrendMonth,
  ReceiptVendorMonthTransaction,
  ReceiptVendorDetail,
  ReceiptVendorDetailTransaction,
  ReceiptVendorExpenseBreakdown,
  ReceiptVendorAiReview,
  ReceiptVendorCostSignal,
  ReceiptVendorMovementComparison,
  ReceiptVendorMovementRange,
  ReceiptVendorMovementSignal,
  ReceiptVendorMovementSummary,
  ReceiptVendorWatchlistItem,
  ReceiptVendorReviewItem,
  ReceiptVendorReviewStatus,
  ReceiptMissingExpenseSummaryItem,
  AIUsageBreakdown,
  RpcDetailGroupRow,
  ReceiptSortColumn,
  BulkStatus,
  RulePreviewResult,
} from './types'
import {
  DEFAULT_PAGE_SIZE,
  MAX_MONTH_PAGE_SIZE,
  OUTSTANDING_STATUSES,
} from './types'
import {
  normalizeVendorInput,
  coerceExpenseCategory,
  sanitizeReceiptSearchTerm,
  normalizeDetailGroupRow,
  hashDetails,
  parseNumeric,
  roundToCurrency,
  parseTopList,
  getTransactionDirection,
  guessAmountValue,
  resolveMonthRange,
  EXPENSE_CATEGORY_OPTIONS,
  bulkGroupQuerySchema,
} from './receiptHelpers'
import {
  buildDeterministicVendorAiReview,
  buildReceiptVendorCostSignals,
  buildReceiptVendorMovementMonthsForVendor,
  buildReceiptVendorMovementSummaries,
  calculateReceiptVendorTrendStats,
  normalizeReceiptMonthWindow,
  normalizeReceiptVendorKey,
  normalizeReceiptVendorMovementComparison,
  normalizeReceiptVendorMovementRange,
  receiptVendorMovementRangeMonths,
} from './vendorInsights'
import { queryReceiptGovernanceItems } from './receiptGovernance'
import { queryReceiptAiStatus } from './receiptAiReview'
import { RECEIPT_AI_PROMPT_VERSION } from '@/lib/receipts/ai-client'

const RECEIPT_HISTORY_PAGE_SIZE = 1000

type CanonicalVendorRow = { canonical_name: string | null }

// ---------------------------------------------------------------------------
// Suggestions for bulk review groups, from what is already stored
// ---------------------------------------------------------------------------
// The bulk page used to make one model call per group every time it was opened (2,293 calls by
// October 2026), sending each group's bank description. It now reads what the classification job
// has already recorded: the category proposed for the group's payments. Nothing is sent anywhere
// when the page loads.

type StoredProposalRow = {
  transaction_id: string
  proposed_expense_category: string | null
  category_state: string
  reasoning: string | null
  model: string | null
}

async function loadStoredProposals(
  supabase: AdminClient,
  transactionIds: string[]
): Promise<Map<string, StoredProposalRow>> {
  const byTransaction = new Map<string, StoredProposalRow>()
  for (let index = 0; index < transactionIds.length; index += 200) {
    const chunk = transactionIds.slice(index, index + 200)
    const { data, error } = await (supabase as any)
      .from('receipt_ai_attempts')
      .select('transaction_id, proposed_expense_category, category_state, reasoning, model')
      .eq('category_state', 'proposed')
      .in('transaction_id', chunk)
    if (error) {
      // The groups still show without suggestions.
      console.error('Failed to load stored AI proposals for bulk review', error)
      return byTransaction
    }
    for (const row of (data ?? []) as StoredProposalRow[]) {
      byTransaction.set(row.transaction_id, row)
    }
  }
  return byTransaction
}

function buildGroupSuggestion(
  group: NormalizedDetailGroupRow,
  proposals: Map<string, StoredProposalRow>
): ReceiptDetailGroupSuggestion {
  const existingVendor = group.dominantVendor
  const existingExpense = group.dominantExpense

  const suggestion: ReceiptDetailGroupSuggestion = {
    vendorName: existingVendor,
    expenseCategory: existingExpense ?? null,
    reasoning: null,
    source: existingVendor || existingExpense ? 'existing' : 'none',
  }
  if (existingExpense) return suggestion

  // The category proposed most often for this group's payments.
  const counts = new Map<string, { count: number; row: StoredProposalRow }>()
  for (const id of group.transactionIds) {
    const row = proposals.get(id)
    const category = coerceExpenseCategory(row?.proposed_expense_category ?? null)
    if (!row || !category) continue
    const entry = counts.get(category) ?? { count: 0, row }
    entry.count += 1
    counts.set(category, entry)
  }
  const best = [...counts.entries()].sort((left, right) => right[1].count - left[1].count)[0]
  if (!best) return suggestion

  return {
    vendorName: existingVendor,
    expenseCategory: best[0] as ReceiptDetailGroupSuggestion['expenseCategory'],
    reasoning: best[1].row.reasoning,
    source: 'ai',
    model: best[1].row.model ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// fetchSummary — dashboard summary data
// ---------------------------------------------------------------------------

async function fetchSummary(): Promise<ReceiptWorkspaceSummary> {
  const supabase = createAdminClient()
  const [{ data: statusCounts, error: statusCountsError }, { data: lastBatch }, { data: usageData, error: usageError }, { count: failedJobCount, error: failedJobsError }] = await Promise.all([
    supabase.rpc('count_receipt_statuses'),
    supabase
      .from('receipt_batches')
      .select('id, uploaded_at, uploaded_by, original_filename, source_hash, source_type, row_count, notes, created_at, status, records_in_file, inserted_count, duplicate_count, rejected_count, rejected_records, repeated_in_file, followup_status, followup_error, followup_completed_at')
      .eq('status', 'completed')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Receipts spend only. The app-wide total includes recruitment and is not this section's figure.
    (supabase as any).rpc('get_receipt_ai_usage'),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'classify_receipt_transactions')
      .eq('status', 'failed'),
  ])

  const counts = Array.isArray(statusCounts) ? statusCounts[0] : statusCounts

  // A failed count used to show as zero, and zero reads as "All clear".
  if (statusCountsError) {
    console.error('Failed to count receipt statuses', statusCountsError)
  }

  if (usageError) {
    console.error('Failed to fetch receipts AI usage', usageError)
  }

  if (failedJobsError) {
    console.error('Failed to fetch failed AI job count:', failedJobsError)
  }

  const pending = Number(counts?.pending ?? 0)
  const completed = Number(counts?.completed ?? 0)
  const autoCompleted = Number(counts?.auto_completed ?? 0)
  const noReceiptRequired = Number(counts?.no_receipt_required ?? 0)
  const cantFind = Number(counts?.cant_find ?? 0)
  const aiUsageBreakdown = usageError ? null : readAiUsage(usageData)
  const openAICost = aiUsageBreakdown?.total_cost ?? 0

  return {
    totals: {
      pending,
      completed,
      autoCompleted,
      noReceiptRequired,
      cantFind,
    },
    totalsUnavailable: Boolean(statusCountsError),
    needsAttentionValue: pending,
    lastImport: lastBatch ?? null,
    openAICost,
    aiUsageBreakdown,
    failedAiJobCount: failedJobCount ?? 0,
  }
}

// ---------------------------------------------------------------------------
// getReceiptWorkspaceData
// ---------------------------------------------------------------------------

type AiAttemptRow = {
  transaction_id: string
  outcome: string
  category_state: string
  proposed_expense_category: string | null
  proposed_no_category: boolean | null
  confidence: number | null
  reasoning: string | null
  prompt_version: string
}

/**
 * The AI's attempts for the payments on this page. Read on its own, not embedded in the payment
 * query, so that a failure here costs the suggestions and not the whole list.
 */
async function loadAiAttemptsForPage(
  supabase: AdminClient,
  transactionIds: string[]
): Promise<Map<string, AiAttemptRow[]>> {
  const byTransaction = new Map<string, AiAttemptRow[]>()
  const chunks: string[][] = []
  for (let index = 0; index < transactionIds.length; index += 200) {
    chunks.push(transactionIds.slice(index, index + 200))
  }

  // A month view holds up to 1,000 payments: the chunks are read together, not one after another.
  const results = await Promise.all(
    chunks.map((chunk) =>
      (supabase as any)
        .from('receipt_ai_attempts')
        .select(
          'transaction_id, outcome, category_state, proposed_expense_category, proposed_no_category, confidence, reasoning, prompt_version'
        )
        .in('transaction_id', chunk)
    )
  )

  for (const { data, error } of results as Array<{ data: AiAttemptRow[] | null; error: unknown }>) {
    if (error) {
      console.error('Failed to load AI attempts for receipts workspace:', error)
      return new Map()
    }
    for (const row of data ?? []) {
      const list = byTransaction.get(row.transaction_id) ?? []
      list.push(row)
      byTransaction.set(row.transaction_id, list)
    }
  }
  return byTransaction
}

/**
 * What a payment's AI attempts mean for the person looking at it: a category waiting to be
 * accepted, or a note. A suggestion is shown only while the payment is still uncategorised.
 */
export function describeAiAttempts(
  payment: Pick<
    ReceiptTransaction,
    'vendor_name' | 'vendor_source' | 'expense_category' | 'expense_category_source' | 'amount_out'
  > & { no_category_applies?: boolean | null },
  attempts: AiAttemptRow[]
): { aiSuggestion: ReceiptAiSuggestion | null; aiNote: string | null } {
  const needsVendor = !payment.vendor_name && !payment.vendor_source
  const needsCategory =
    Number(payment.amount_out ?? 0) > 0 &&
    !payment.expense_category &&
    !payment.expense_category_source &&
    !payment.no_category_applies

  const open = needsCategory ? attempts.find((attempt) => attempt.category_state === 'proposed') : undefined
  const category = coerceExpenseCategory(open?.proposed_expense_category ?? null)
  const aiSuggestion: ReceiptAiSuggestion | null =
    open && (category || open.proposed_no_category)
      ? {
          category: category ?? null,
          noCategoryApplies: !category && Boolean(open.proposed_no_category),
          confidence: open.confidence,
          reasoning: open.reasoning,
        }
      : null

  const current = attempts.find((attempt) => attempt.prompt_version === RECEIPT_AI_PROMPT_VERSION)
  let aiNote: string | null = null
  if (current && (needsVendor || needsCategory)) {
    if (current.outcome === 'payroll_check') {
      aiNote = current.reasoning || 'This may be a wage payment. Please check it.'
    } else if (current.outcome === 'failed_final' || current.outcome === 'failed_retryable') {
      aiNote = 'The AI could not classify this transaction.'
    }
  }

  return { aiSuggestion, aiNote }
}

export async function queryReceiptWorkspaceData(filters: ReceiptWorkspaceFilters = {}): Promise<ReceiptWorkspaceData> {
  const supabase = createAdminClient()

  const monthRange = resolveMonthRange(filters.month)
  const isMonthScoped = Boolean(monthRange)
  const useExpandedPage = isMonthScoped || filters.groupByVendor
  const maxPageSize = useExpandedPage ? MAX_MONTH_PAGE_SIZE : 100
  const requestedPageSize = filters.pageSize ?? (useExpandedPage ? MAX_MONTH_PAGE_SIZE : DEFAULT_PAGE_SIZE)
  const pageSize = Math.min(requestedPageSize, maxPageSize)
  // Every view honours the requested page. Pinning the month view to page 1 left
  // the pager offering pages the query never fetched, so later rows were simply
  // unreachable.
  const page = Math.max(filters.page ?? 1, 1)
  const offset = (page - 1) * pageSize

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
    .select('*, receipt_files(*), receipt_rules!receipt_transactions_rule_applied_id_fkey(id,name)', { count: 'exact' })

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

  if (filters.sourceType && filters.sourceType !== 'all') {
    baseQuery = baseQuery.eq('source_type', filters.sourceType)
  }

  if (filters.cardMember && filters.sourceType === 'amex') {
    baseQuery = baseQuery.eq('card_member', filters.cardMember)
  }

  if (filters.missingVendorOnly) {
    baseQuery = baseQuery.or('vendor_name.is.null,vendor_name.eq.')
  }

  if (filters.missingExpenseOnly) {
    // A payment marked "no category applies" has been decided: it is not missing a category.
    baseQuery = baseQuery.is('expense_category', null).eq('no_category_applies', false).not('amount_out', 'is', null)
  }

  if (monthRange) {
    baseQuery = baseQuery.gte('transaction_date', monthRange.start).lt('transaction_date', monthRange.end)
  }

  baseQuery = baseQuery.range(offset, offset + pageSize - 1)

  // The vendor picker offers the vendors that are standing: not merged into another and not
  // deactivated. Those keep their history and are no longer offered. Names on the rows already
  // on screen and names in rules are not added: a name that is not a standing vendor goes
  // through "+ New vendor", which asks first.
  // Paged, so the list is whole or it is empty: a failure logs and leaves the picker with
  // "+ New vendor" only rather than breaking the workspace.
  const canonicalVendorQuery = fetchAllRows<CanonicalVendorRow>(
    (from, to) =>
      supabase
        .from('receipt_vendors')
        .select('canonical_name')
        .in('status', ['unconfirmed', 'confirmed'])
        .order('canonical_name', { ascending: true })
        .order('id')
        .range(from, to),
    { label: 'receipt canonical vendors' },
  ).catch((canonicalVendorError: unknown) => {
    console.error('Failed to load canonical receipt vendors:', canonicalVendorError)
    return [] as CanonicalVendorRow[]
  })

  const monthsQuery = supabase.rpc('get_receipt_monthly_summary', {
    limit_months: 1000,
  })

  const cardMembersQuery = supabase.rpc('get_amex_card_members')

  const [
    { data: transactions, count, error },
    { data: rules },
    summary,
    canonicalVendorRecords,
    { data: monthSummary, error: monthError },
    { data: cardMemberRows, error: cardMemberError },
    governance,
    aiStatus,
  ] = await Promise.all([
    baseQuery,
    supabase
      .from('receipt_rules')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true }),
    fetchSummary(),
    canonicalVendorQuery,
    monthsQuery,
    cardMembersQuery,
    queryReceiptGovernanceItems(),
    // The list still loads if this cannot be worked out; the notice above it is simply left off.
    queryReceiptAiStatus().catch((aiStatusError: unknown) => {
      console.error('Failed to load AI classification status for receipts workspace:', aiStatusError)
      return null
    }),
  ])

  if (error) {
    console.error('Failed to load receipts workspace:', error)
    throw error
  }

  if (monthError) {
    console.error('Failed to load month list for receipts workspace:', monthError)
  }

  if (cardMemberError) {
    console.error('Failed to load card member list for receipts workspace:', cardMemberError)
  }

  const attemptsByTransaction = await loadAiAttemptsForPage(
    supabase,
    (transactions ?? []).map((tx: any) => String(tx.id))
  )

  const shapedTransactions = (transactions ?? []).map((tx: any) => ({
    ...tx,
    files: tx.receipt_files ?? [],
    autoRule: tx.receipt_rules?.[0] ?? null,
    ...describeAiAttempts(tx, attemptsByTransaction.get(String(tx.id)) ?? []),
  }))

  const knownVendorSet = new Set<string>()

  ;(canonicalVendorRecords ?? []).forEach((record) => {
    const normalized = normalizeVendorInput(record.canonical_name)
    if (normalized) {
      knownVendorSet.add(normalized)
    }
  })


  const knownVendors = Array.from(knownVendorSet).sort((a: string, b: string) => a.localeCompare(b))

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
  monthRows.forEach((row: any) => {
    const value = typeof row?.month_start === 'string' ? row.month_start.slice(0, 7) : null
    if (value) {
      availableMonthsSet.add(value)
    }
  })

  if (filters.month) {
    availableMonthsSet.add(filters.month)
  }

  const availableMonths = Array.from(availableMonthsSet)
    .filter((value) => monthRows.some((row: any) => row?.month_start?.startsWith(value)))
    .sort((a, b) => b.localeCompare(a))

  // get_amex_card_members already returns DISTINCT, non-null members in sorted order.
  const availableCardMembers = (cardMemberRows ?? [])
    .map((row: any) => row.card_member)
    .filter((value: any): value is string => Boolean(value))

  return {
    transactions: shapedTransactions,
    aiStatus,
    rules: rules ?? [],
    ruleConflicts: governance.conflicts,
    ruleSuggestions: governance.suggestions,
    suggestionsTotal: governance.suggestionsTotal,
    summary: enrichedSummary,
    pagination: {
      page,
      pageSize,
      total: count ?? shapedTransactions.length,
    },
    knownVendors,
    availableMonths,
    availableCardMembers,
  }
}

// ---------------------------------------------------------------------------
// getReceiptBulkReviewData
// ---------------------------------------------------------------------------

export async function queryReceiptBulkReviewData(options: {
  limit?: number
  statuses?: BulkStatus[]
  onlyUnclassified?: boolean
  useFuzzyGrouping?: boolean
} = {}): Promise<ReceiptBulkReviewData> {
  const parsed = bulkGroupQuerySchema.safeParse(options ?? {})
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid bulk review filters')
  }

  const limit = parsed.data.limit ?? 10
  const statuses = parsed.data.statuses && parsed.data.statuses.length
    ? (Array.from(new Set(parsed.data.statuses)) as BulkStatus[])
    : (['pending'] as BulkStatus[])
  const onlyUnclassified = parsed.data.onlyUnclassified ?? true
  const useFuzzyGrouping = options.useFuzzyGrouping ?? false

  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('get_receipt_detail_groups', {
    limit_groups: limit,
    include_statuses: statuses,
    only_unclassified: onlyUnclassified,
    use_fuzzy_grouping: useFuzzyGrouping,
  })

  if (error) {
    console.error('Failed to fetch receipt detail groups', error)
    throw error
  }

  const rows = (data ?? []) as RpcDetailGroupRow[]
  const normalizedRows = rows.map(normalizeDetailGroupRow)
  const proposals = await loadStoredProposals(
    supabase,
    normalizedRows.flatMap((group) => group.transactionIds)
  )

  const groups: ReceiptDetailGroup[] = []

  for (const normalized of normalizedRows) {
    const suggestion = buildGroupSuggestion(normalized, proposals)

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
      useFuzzyGrouping,
    },
  }
}

// ---------------------------------------------------------------------------
// getReceiptSignedUrl
// ---------------------------------------------------------------------------

export async function queryReceiptSignedUrl(fileId: string): Promise<{ success?: boolean; url?: string; error?: string }> {
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
    .from('receipts')
    .createSignedUrl(receipt.storage_path, 60 * 5)

  if (urlError || !urlData?.signedUrl) {
    return { error: 'Unable to create download link' }
  }

  return { success: true, url: urlData.signedUrl }
}

// ---------------------------------------------------------------------------
// getMonthlyReceiptSummary
// ---------------------------------------------------------------------------

export async function queryMonthlyReceiptSummary(limit = 12): Promise<ReceiptMonthlySummaryItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_receipt_monthly_summary', {
    limit_months: limit,
  })

  if (error) {
    console.error('Failed to load monthly receipt summary', error)
    throw error
  }

  const rows = Array.isArray(data) ? data : []

  return rows.map((row: any) => ({
    monthStart: row.month_start,
    totalIncome: Number(row.total_income ?? 0),
    totalOutgoing: Number(row.total_outgoing ?? 0),
    topIncome: parseTopList(row.top_income),
    topOutgoing: parseTopList(row.top_outgoing),
  }))
}

// ---------------------------------------------------------------------------
// getReceiptBankBalanceHistory
// ---------------------------------------------------------------------------

export async function queryReceiptBankBalanceHistory(): Promise<ReceiptBankBalanceHistory> {
  const supabase = createAdminClient()
  const rows: BankBalanceRow[] = []

  for (let from = 0; ; from += RECEIPT_HISTORY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('receipt_transactions')
      .select('id, transaction_date, amount_in, amount_out, balance')
      .eq('source_type', 'bank')
      .not('balance', 'is', null)
      .order('transaction_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + RECEIPT_HISTORY_PAGE_SIZE - 1)

    if (error) {
      console.error('Failed to load bank balance history', error)
      throw error
    }

    const pageRows = (data ?? []) as BankBalanceRow[]
    rows.push(...pageRows)
    if (pageRows.length < RECEIPT_HISTORY_PAGE_SIZE) break
  }

  return {
    points: buildDailyBankBalanceSeries(rows),
    sourceRowCount: rows.length,
  }
}

// ---------------------------------------------------------------------------
// getMonthlyReceiptInsights
// ---------------------------------------------------------------------------

export async function queryMonthlyReceiptInsights(limit = 12): Promise<ReceiptMonthlyInsights> {
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

type VendorCanonicalJoin = { canonical_name?: string | null; vendor_key?: string | null }

type VendorTransactionRow = {
  id: string
  transaction_date: string
  details: string | null
  amount_in: number | string | null
  amount_out: number | string | null
  status: ReceiptTransaction['status']
  vendor_name: string | null
  vendor_source?: ReceiptTransaction['vendor_source']
  transaction_type: string | null
  expense_category?: ReceiptTransaction['expense_category']
  expense_category_source?: ReceiptTransaction['expense_category_source']
  receipt_vendors?: VendorCanonicalJoin | VendorCanonicalJoin[] | null
}

type VendorMonthlyTotalRow = {
  vendor_key?: string | null
  vendor_label?: string | null
  month_start?: string | null
  total_outgoing?: number | string | null
  total_income?: number | string | null
  transaction_count?: number | string | null
}

// The vendor a payment reports under is its own vendor, by id. This matches the database view
// `receipt_transaction_vendors`. The name a rule carries is not consulted: a payment says for
// itself which vendor it belongs to.
const VENDOR_TRANSACTION_SELECT = 'id, transaction_date, details, amount_in, amount_out, status, vendor_name, vendor_source, transaction_type, expense_category, expense_category_source, receipt_vendors(canonical_name, vendor_key)'
const VENDOR_HISTORY_FALLBACK_PAGE_SIZE = 1000

function getCanonicalVendorName(row: VendorTransactionRow): string | null {
  const join = row.receipt_vendors
  if (Array.isArray(join)) {
    return normalizeVendorInput(join[0]?.canonical_name)
  }
  return normalizeVendorInput(join?.canonical_name)
}

function getCanonicalVendorLabel(row: VendorTransactionRow): string | null {
  return getCanonicalVendorName(row) ?? normalizeVendorInput(row.vendor_name)
}

function getCanonicalVendorKey(row: VendorTransactionRow): string | null {
  const join = row.receipt_vendors
  const joinedKey = Array.isArray(join) ? join[0]?.vendor_key : join?.vendor_key
  return normalizeReceiptVendorKey(joinedKey ?? getCanonicalVendorLabel(row))
}

function transactionMonthStart(value: string): string {
  const date = new Date(value)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

function addUtcMonths(monthStart: string, offset: number): string {
  const date = new Date(monthStart)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)).toISOString().slice(0, 10)
}

function latestVendorSummaryMonth(vendors: ReceiptVendorSummary[]): string {
  const latest = vendors.reduce<string | null>((current, vendor) => {
    for (const month of vendor.months) {
      const monthStart = typeof month.monthStart === 'string' ? month.monthStart.slice(0, 10) : null
      if (monthStart && (!current || monthStart > current)) {
        current = monthStart
      }
    }
    return current
  }, null)

  if (latest) return latest

  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

function shapeVendorTransaction(row: VendorTransactionRow): ReceiptVendorDetailTransaction {
  return {
    id: row.id,
    transaction_date: row.transaction_date,
    details: row.details ?? '',
    amount_in: parseNumeric(row.amount_in) || null,
    amount_out: parseNumeric(row.amount_out) || null,
    status: row.status,
    transaction_type: row.transaction_type,
    vendor_name: getCanonicalVendorLabel(row),
    vendor_source: row.vendor_source ?? null,
    expense_category: coerceExpenseCategory(row.expense_category) ?? null,
    expense_category_source: row.expense_category_source ?? null,
  }
}

function aggregateVendorMonths(rows: VendorTransactionRow[]): ReceiptVendorTrendMonth[] {
  const monthMap = new Map<string, ReceiptVendorTrendMonth>()

  rows.forEach((row) => {
    const monthStart = transactionMonthStart(row.transaction_date)
    const existing = monthMap.get(monthStart) ?? {
      monthStart,
      totalOutgoing: 0,
      totalIncome: 0,
      transactionCount: 0,
    }

    existing.totalOutgoing += parseNumeric(row.amount_out)
    existing.totalIncome += parseNumeric(row.amount_in)
    existing.transactionCount += 1
    monthMap.set(monthStart, existing)
  })

  return Array.from(monthMap.values())
    .map((month) => ({
      ...month,
      totalOutgoing: roundToCurrency(month.totalOutgoing),
      totalIncome: roundToCurrency(month.totalIncome),
    }))
    .sort((a, b) => a.monthStart.localeCompare(b.monthStart))
}

function buildVendorExpenseBreakdown(rows: VendorTransactionRow[]): ReceiptVendorExpenseBreakdown[] {
  const categoryMap = new Map<string, ReceiptVendorExpenseBreakdown>()

  rows.forEach((row) => {
    const amountOut = parseNumeric(row.amount_out)
    if (amountOut <= 0) return

    const expenseCategory = coerceExpenseCategory(row.expense_category) ?? 'Uncategorised'
    const existing = categoryMap.get(expenseCategory) ?? {
      expenseCategory,
      totalOutgoing: 0,
      transactionCount: 0,
    }
    existing.totalOutgoing += amountOut
    existing.transactionCount += 1
    categoryMap.set(expenseCategory, existing)
  })

  return Array.from(categoryMap.values())
    .map((entry) => ({ ...entry, totalOutgoing: roundToCurrency(entry.totalOutgoing) }))
    .sort((a, b) => b.totalOutgoing - a.totalOutgoing)
}

function queryRangeMonthsForMovement(range: ReceiptVendorMovementRange): number | null {
  const rangeMonths = receiptVendorMovementRangeMonths(range)
  return rangeMonths === null ? null : rangeMonths + 12
}

function isMissingVendorMonthlyTotalsRpcError(error: any): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  return code === 'PGRST202' || code === '42883' || message.includes('get_receipt_vendor_monthly_totals')
}

function groupVendorMonthlyTotals(rows: VendorMonthlyTotalRow[]): Array<{ vendorLabel: string; months: ReceiptVendorTrendMonth[] }> {
  const grouped = new Map<string, { vendorLabel: string; months: Map<string, ReceiptVendorTrendMonth> }>()

  rows.forEach((row) => {
    const vendorLabel = normalizeVendorInput(row.vendor_label) ?? 'Uncategorised'
    const vendorKey = normalizeReceiptVendorKey(row.vendor_key ?? vendorLabel)
    const monthStart = typeof row.month_start === 'string' ? row.month_start.slice(0, 10) : null
    if (!vendorKey || !monthStart) return

    const group = grouped.get(vendorKey) ?? {
      vendorLabel,
      months: new Map<string, ReceiptVendorTrendMonth>(),
    }
    const month = group.months.get(monthStart) ?? {
      monthStart,
      totalOutgoing: 0,
      totalIncome: 0,
      transactionCount: 0,
    }
    month.totalOutgoing += parseNumeric(row.total_outgoing)
    month.totalIncome += parseNumeric(row.total_income)
    month.transactionCount += Number(row.transaction_count ?? 0)
    group.months.set(monthStart, month)
    grouped.set(vendorKey, group)
  })

  return Array.from(grouped.values())
    .map((group) => ({
      vendorLabel: group.vendorLabel,
      months: Array.from(group.months.values())
        .map((month) => ({
          ...month,
          totalOutgoing: roundToCurrency(month.totalOutgoing),
          totalIncome: roundToCurrency(month.totalIncome),
        }))
        .sort((a, b) => a.monthStart.localeCompare(b.monthStart)),
    }))
}

function groupVendorTransactionsByMonth(rows: VendorTransactionRow[]): Array<{ vendorLabel: string; months: ReceiptVendorTrendMonth[] }> {
  const grouped = new Map<string, { vendorLabel: string; rows: VendorTransactionRow[] }>()

  rows.forEach((row) => {
    const vendorLabel = getCanonicalVendorLabel(row) ?? 'Uncategorised'
    const vendorKey = normalizeReceiptVendorKey(vendorLabel)
    if (!vendorKey) return
    const group = grouped.get(vendorKey) ?? { vendorLabel, rows: [] }
    group.rows.push(row)
    grouped.set(vendorKey, group)
  })

  return Array.from(grouped.values()).map((group) => ({
    vendorLabel: group.vendorLabel,
    months: aggregateVendorMonths(group.rows),
  }))
}

async function queryReceiptVendorMonthlyMovementSources(
  range: ReceiptVendorMovementRange,
): Promise<{ sources: Array<{ vendorLabel: string; months: ReceiptVendorTrendMonth[] }>; error?: unknown }> {
  const supabase = createAdminClient()
  const rangeMonths = queryRangeMonthsForMovement(range)

  // Paged: the function returns 1,556 rows over a 48 month range, so a single
  // request stopped part-way through the alphabet and dropped 92 vendors. The
  // page error is kept so the missing-function fallback below still sees the
  // database error itself rather than the wrapped one the helper throws.
  let rpcPageError: unknown = null
  let totals: VendorMonthlyTotalRow[] | null = null

  try {
    totals = await fetchAllRows<VendorMonthlyTotalRow>(
      async (from, to) => {
        const page = await supabase
          .rpc('get_receipt_vendor_monthly_totals', { range_months: rangeMonths })
          .range(from, to)
        if (page.error) rpcPageError = page.error
        return page
      },
      { label: 'receipt vendor monthly totals' },
    )
  } catch (thrown) {
    const error = rpcPageError ?? thrown
    if (!isMissingVendorMonthlyTotalsRpcError(error)) {
      return { sources: [], error }
    }
  }

  if (totals) {
    return { sources: groupVendorMonthlyTotals(totals) }
  }

  console.warn('Receipt vendor monthly totals RPC is unavailable; falling back to paged transaction scan')

  let scanPageError: unknown = null

  try {
    const rows = await fetchAllRows<VendorTransactionRow>(
      async (from, to) => {
        const page = await supabase
          .from('receipt_transactions')
          .select(VENDOR_TRANSACTION_SELECT)
          .order('transaction_date', { ascending: false })
          .order('id')
          .range(from, to)
        if (page.error) scanPageError = page.error
        return page
      },
      { pageSize: VENDOR_HISTORY_FALLBACK_PAGE_SIZE, label: 'receipt vendor monthly totals fallback scan' },
    )

    return { sources: groupVendorTransactionsByMonth(rows) }
  } catch (thrown) {
    return { sources: [], error: scanPageError ?? thrown }
  }
}

function isMissingVendorHistoryRpcError(error: any): boolean {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  return code === 'PGRST202' || code === '42883' || message.includes('get_receipt_vendor_transactions')
}

async function queryReceiptVendorHistoryRows(
  supabase: AdminClient,
  vendorLabel: string,
  vendorKey: string,
): Promise<{ rows: VendorTransactionRow[]; error?: unknown }> {
  // Paged: the busiest vendor has 647 transactions today, but the function result
  // is capped at 1,000 rows like any other read, so an unpaged call would quietly
  // cut a longer history short. The page error is kept so the missing-function
  // fallback below still sees the database error itself rather than the wrapped
  // one the helper throws.
  let rpcPageError: unknown = null

  try {
    const rows = await fetchAllRows<VendorTransactionRow>(
      async (from, to) => {
        const page = await supabase
          .rpc('get_receipt_vendor_transactions', { target_vendor_label: vendorLabel })
          .range(from, to)
        if (page.error) rpcPageError = page.error
        return page
      },
      { label: 'receipt vendor transaction history' },
    )

    return { rows }
  } catch (thrown) {
    const error = rpcPageError ?? thrown
    if (!isMissingVendorHistoryRpcError(error)) {
      return { rows: [], error }
    }
  }

  console.warn('Receipt vendor history RPC is unavailable; falling back to paged transaction scan')

  let scanPageError: unknown = null

  try {
    const scanned = await fetchAllRows<VendorTransactionRow>(
      async (from, to) => {
        const page = await supabase
          .from('receipt_transactions')
          .select(VENDOR_TRANSACTION_SELECT)
          .order('transaction_date', { ascending: false })
          .order('id')
          .range(from, to)
        if (page.error) scanPageError = page.error
        return page
      },
      { pageSize: VENDOR_HISTORY_FALLBACK_PAGE_SIZE, label: 'receipt vendor history fallback scan' },
    )

    return { rows: scanned.filter((row) => getCanonicalVendorKey(row) === vendorKey) }
  } catch (thrown) {
    return { rows: [], error: scanPageError ?? thrown }
  }
}

// ---------------------------------------------------------------------------
// getReceiptVendorSummary
// ---------------------------------------------------------------------------

type VendorTrendRow = {
  vendor_label: string | null
  month_start: string
  total_outgoing: number | string | null
  total_income: number | string | null
  transaction_count: number | string | null
}

export async function queryReceiptVendorSummary(monthWindow = 12): Promise<ReceiptVendorSummary[]> {
  const supabase = createAdminClient()

  // Paged: the function returns 604 rows over a 12 month window and 1,154 over
  // 24, so a single request would quietly drop the tail as soon as the window
  // widened. The page error is kept so the caller still sees the database error
  // rather than the wrapped one the helper throws.
  let rpcPageError: unknown = null
  let rows: VendorTrendRow[]

  try {
    rows = await fetchAllRows<VendorTrendRow>(
      async (from, to) => {
        const page = await supabase
          .rpc('get_receipt_vendor_trends', { month_window: monthWindow })
          .range(from, to)
        if (page.error) rpcPageError = page.error
        return page
      },
      { label: 'receipt vendor trends' },
    )
  } catch (thrown) {
    const error = rpcPageError ?? thrown
    console.error('Failed to load vendor trends', error)
    throw error
  }

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

// ---------------------------------------------------------------------------
// getReceiptVendorMovements
// ---------------------------------------------------------------------------

export async function queryReceiptVendorMovements(input: {
  range?: ReceiptVendorMovementRange
  comparison?: ReceiptVendorMovementComparison
  watchedOnly?: boolean
  userId?: string
} = {}): Promise<{
  success: boolean
  movements: ReceiptVendorMovementSummary[]
  signals: ReceiptVendorMovementSignal[]
  error?: string
}> {
  const range = normalizeReceiptVendorMovementRange(input.range)
  const comparison = normalizeReceiptVendorMovementComparison(input.comparison)
  const sourceResult = await queryReceiptVendorMonthlyMovementSources(range)

  if (sourceResult.error) {
    console.error('Failed to load vendor movement totals', sourceResult.error)
    return {
      success: false,
      movements: [],
      signals: [],
      error: 'Failed to load vendor movement data.',
    }
  }

  let sources = sourceResult.sources

  if (input.watchedOnly) {
    if (!input.userId) {
      return {
        success: false,
        movements: [],
        signals: [],
        error: 'Unable to load watched vendors for this user.',
      }
    }

    const watchlist = await queryReceiptVendorWatchlist(input.userId)
    const watchedKeys = new Set(watchlist.map((item) => item.vendorKey))
    sources = sources.filter((source) => {
      const key = normalizeReceiptVendorKey(source.vendorLabel)
      return key ? watchedKeys.has(key) : false
    })
  }

  const movements = buildReceiptVendorMovementSummaries(sources, { range, comparison })
  const signals = movements
    .map((movement) => movement.signal)
    .filter((signal): signal is ReceiptVendorMovementSignal => Boolean(signal))

  return {
    success: true,
    movements,
    signals,
  }
}

// ---------------------------------------------------------------------------
// getReceiptVendorMonthTransactions
// ---------------------------------------------------------------------------

export async function queryReceiptVendorMonthTransactions(input: {
  vendorLabel: string
  monthStart: string
}): Promise<{ transactions: ReceiptVendorMonthTransaction[]; error?: string }> {
  const vendorKey = normalizeReceiptVendorKey(input.vendorLabel)
  if (!vendorKey) {
    return { transactions: [] }
  }

  const startDate = new Date(input.monthStart)
  if (Number.isNaN(startDate.getTime())) {
    return { transactions: [], error: 'Invalid month provided' }
  }

  const start = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))
  const end = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1))

  const supabase = createAdminClient()

  // The vendor's own payments, then the month. It used to read the first 1,000 payments of the
  // month for every vendor and filter afterwards, so a busy month lost payments without a word.
  const history = await queryReceiptVendorHistoryRows(supabase, input.vendorLabel, vendorKey)
  if (history.error) {
    console.error('Failed to load vendor month transactions', history.error)
    return { transactions: [], error: 'Failed to load transactions for this vendor.' }
  }

  const startDay = start.toISOString().slice(0, 10)
  const endDay = end.toISOString().slice(0, 10)
  const matchingRows = history.rows
    .filter((row) => {
      const day = String(row.transaction_date).slice(0, 10)
      return day >= startDay && day < endDay
    })
    .sort((left, right) => String(left.transaction_date).localeCompare(String(right.transaction_date)))

  return {
    transactions: matchingRows.map((row: VendorTransactionRow) => ({
      id: row.id,
      transaction_date: row.transaction_date,
      details: row.details ?? '',
      amount_in: parseNumeric(row.amount_in) || null,
      amount_out: parseNumeric(row.amount_out) || null,
      status: row.status,
      transaction_type: row.transaction_type,
      vendor_name: getCanonicalVendorLabel(row),
    })),
  }
}

// ---------------------------------------------------------------------------
// getReceiptVendorDetail
// ---------------------------------------------------------------------------

export async function queryReceiptVendorDetail(input: {
  vendorLabel: string
  monthWindow?: number
}): Promise<{ detail?: ReceiptVendorDetail; error?: string }> {
  const vendorKey = normalizeReceiptVendorKey(input.vendorLabel)
  if (!vendorKey) {
    return { error: 'Invalid vendor provided' }
  }

  const monthWindow = normalizeReceiptMonthWindow(input.monthWindow)
  const summaries = await queryReceiptVendorSummary(monthWindow)
  const matchingSummary = summaries.find((summary) => normalizeReceiptVendorKey(summary.vendorLabel) === vendorKey)
  const referenceMonthStart = latestVendorSummaryMonth(summaries)
  const supabase = createAdminClient()

  const historyResult = await queryReceiptVendorHistoryRows(supabase, input.vendorLabel, vendorKey)

  if (historyResult.error) {
    console.error('Failed to load vendor detail transactions', historyResult.error)
    return { error: 'Failed to load vendor details.' }
  }

  const matchingRows = historyResult.rows

  if (!matchingSummary && matchingRows.length === 0) {
    return { error: 'Vendor not found' }
  }

  const startMonth = addUtcMonths(referenceMonthStart, -(monthWindow - 1))
  const endMonth = addUtcMonths(referenceMonthStart, 1)
  const windowRows = matchingRows.filter((row) => row.transaction_date >= startMonth && row.transaction_date < endMonth)
  const months = matchingSummary?.months ?? aggregateVendorMonths(windowRows)
  const trendStats = calculateReceiptVendorTrendStats(months, {
    monthWindow,
    referenceMonthStart,
  })

  const summaryFallback: ReceiptVendorSummary = matchingSummary ?? {
    vendorLabel: input.vendorLabel,
    months,
    totalOutgoing: roundToCurrency(windowRows.reduce((sum, row) => sum + parseNumeric(row.amount_out), 0)),
    totalIncome: roundToCurrency(windowRows.reduce((sum, row) => sum + parseNumeric(row.amount_in), 0)),
    recentAverageOutgoing: trendStats.recentAverageOutgoing,
    previousAverageOutgoing: trendStats.previousAverageOutgoing,
    changePercentage: trendStats.percentageChange,
  }

  const allSignals = buildReceiptVendorCostSignals(summaries.length ? summaries : [summaryFallback], {
    monthWindow,
    referenceMonthStart,
  })
  const signals = allSignals.filter((signal) => normalizeReceiptVendorKey(signal.vendorLabel) === vendorKey)
  const detailVendorLabel = matchingSummary?.vendorLabel ?? getCanonicalVendorLabel(matchingRows[0]) ?? input.vendorLabel
  const movementMonths = buildReceiptVendorMovementMonthsForVendor(
    detailVendorLabel,
    aggregateVendorMonths(matchingRows),
    { range: 'all' },
  )
  const movementSignals = movementMonths
    .flatMap((month) => [month.momSignal, month.yoySignal])
    .filter((signal): signal is ReceiptVendorMovementSignal => Boolean(signal))
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1
      return b.absoluteDelta - a.absoluteDelta
    })
  const transactions = matchingRows.map(shapeVendorTransaction)
  const historyTotalOutgoing = roundToCurrency(matchingRows.reduce((sum, row) => sum + parseNumeric(row.amount_out), 0))
  const historyTotalIncome = roundToCurrency(matchingRows.reduce((sum, row) => sum + parseNumeric(row.amount_in), 0))
  const sortedDates = matchingRows
    .map((row) => row.transaction_date)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))

  return {
    detail: {
      vendorLabel: detailVendorLabel,
      months,
      totalOutgoing: matchingSummary?.totalOutgoing ?? summaryFallback.totalOutgoing,
      totalIncome: matchingSummary?.totalIncome ?? summaryFallback.totalIncome,
      transactionCount: months.reduce((sum, month) => sum + month.transactionCount, 0),
      historyTotalOutgoing,
      historyTotalIncome,
      historyTransactionCount: transactions.length,
      historyStartDate: sortedDates[0] ?? null,
      historyEndDate: sortedDates[sortedDates.length - 1] ?? null,
      recentAverageOutgoing: trendStats.recentAverageOutgoing,
      previousAverageOutgoing: trendStats.previousAverageOutgoing,
      changePercentage: trendStats.percentageChange,
      signals,
      movementMonths,
      movementSignals,
      categoryBreakdown: buildVendorExpenseBreakdown(matchingRows),
      transactions,
      recentTransactions: transactions.slice(0, 50),
    },
  }
}

// ---------------------------------------------------------------------------
// getReceiptVendorCostReview
// ---------------------------------------------------------------------------

export async function queryReceiptVendorCostReview(input: {
  monthWindow?: number
} = {}): Promise<{
  success: boolean
  signals: ReceiptVendorCostSignal[]
  review?: ReceiptVendorAiReview
  error?: string
}> {
  const monthWindow = normalizeReceiptMonthWindow(input.monthWindow)
  const summaries = await queryReceiptVendorSummary(monthWindow)
  const signals = buildReceiptVendorCostSignals(summaries, { monthWindow })
  const movementResult = await queryReceiptVendorMovements({ range: '36m', comparison: 'yoy' })
  const movementSignals = movementResult.success ? movementResult.signals : []
  const deterministicReview = buildDeterministicVendorAiReview(signals, { movementSignals })

  if (signals.length === 0 && movementSignals.length === 0) {
    return { success: true, signals, review: deterministicReview }
  }

  const supabase = createAdminClient()

  try {
    const outcome = await summarizeReceiptVendorCostReview({
      signals,
      movementSignals,
      monthWindow,
    })

    if (outcome?.result) {
      await recordAIUsage(supabase, outcome.usage, 'receipt_vendor_cost_review')
      return { success: true, signals, review: outcome.result }
    }
  } catch (error) {
    console.error('AI vendor cost review failed, using deterministic review', error)
  }

  return { success: true, signals, review: deterministicReview }
}

// ---------------------------------------------------------------------------
// getReceiptVendorAiSummary
// ---------------------------------------------------------------------------

export async function queryReceiptVendorAiSummary(input: {
  vendorLabel: string
  monthWindow?: number
}): Promise<{
  success: boolean
  review?: ReceiptVendorAiReview
  signals: ReceiptVendorCostSignal[]
  error?: string
}> {
  const monthWindow = normalizeReceiptMonthWindow(input.monthWindow)
  const detailResult = await queryReceiptVendorDetail({
    vendorLabel: input.vendorLabel,
    monthWindow,
  })

  if (detailResult.error || !detailResult.detail) {
    return {
      success: false,
      signals: [],
      error: detailResult.error ?? 'Vendor not found',
    }
  }

  const detail = detailResult.detail
  const deterministicReview = buildDeterministicVendorAiReview(detail.signals, {
    scopeLabel: detail.vendorLabel,
    movementSignals: detail.movementSignals,
  })
  const supabase = createAdminClient()

  try {
    const outcome = await summarizeReceiptVendorCostReview({
      signals: detail.signals,
      movementSignals: detail.movementSignals,
      monthWindow,
      vendorLabel: detail.vendorLabel,
      detail,
    })

    if (outcome?.result) {
      await recordAIUsage(supabase, outcome.usage, `receipt_vendor_cost_review:${hashDetails(detail.vendorLabel)}`)
      return {
        success: true,
        signals: detail.signals,
        review: outcome.result,
      }
    }
  } catch (error) {
    console.error('AI vendor detail summary failed, using deterministic review', error)
  }

  return {
    success: true,
    signals: detail.signals,
    review: deterministicReview,
  }
}

// ---------------------------------------------------------------------------
// getReceiptVendorWatchlist
// ---------------------------------------------------------------------------

export async function queryReceiptVendorWatchlist(userId: string): Promise<ReceiptVendorWatchlistItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('receipt_vendor_watchlist')
    .select('user_id, vendor_key, vendor_label, created_at, updated_at')
    .eq('user_id', userId)
    .order('vendor_label', { ascending: true })

  if (error) {
    if ((error as { code?: string }).code === '42P01') {
      console.warn('Receipt vendor watchlist table is not available yet; returning an empty watchlist.')
      return []
    }
    console.error('Failed to load receipt vendor watchlist', error)
    throw error
  }

  return ((data ?? []) as Array<{
    user_id: string
    vendor_key: string
    vendor_label: string
    created_at: string
    updated_at: string
  }>).map((row) => ({
    userId: row.user_id,
    vendorKey: row.vendor_key,
    vendorLabel: row.vendor_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function queryReceiptVendorReviews(userId: string): Promise<ReceiptVendorReviewItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('receipt_vendor_reviews')
    .select('user_id, vendor_key, vendor_label, comparison, month_start, status, created_at, updated_at')
    .eq('user_id', userId)
    .order('month_start', { ascending: false })

  if (error) {
    if ((error as { code?: string }).code === '42P01') {
      console.warn('Receipt vendor reviews table is not available yet; returning no review states.')
      return []
    }
    console.error('Failed to load receipt vendor reviews', error)
    throw error
  }

  return ((data ?? []) as Array<{
    user_id: string
    vendor_key: string
    vendor_label: string
    comparison: ReceiptVendorMovementComparison
    month_start: string
    status: ReceiptVendorReviewStatus
    created_at: string
    updated_at: string
  }>).map((row) => ({
    userId: row.user_id,
    vendorKey: row.vendor_key,
    vendorLabel: row.vendor_label,
    comparison: row.comparison,
    monthStart: String(row.month_start).slice(0, 10),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

// ---------------------------------------------------------------------------
// getReceiptMissingExpenseSummary
// ---------------------------------------------------------------------------

type MissingExpenseRow = {
  vendor_name: string | null
  receipt_vendors?: VendorCanonicalJoin | VendorCanonicalJoin[] | null
  amount_out: number | string | null
  amount_in: number | string | null
  transaction_date: string | null
}

export async function queryReceiptMissingExpenseSummary(): Promise<ReceiptMissingExpenseSummaryItem[]> {
  const supabase = createAdminClient()

  // Paged: 3,387 rows match today, so a single request would silently return the
  // first 1,000 and under-report the backlog. `id` is the unique tiebreak that
  // keeps the page boundaries stable.
  const rows = await fetchAllRows<MissingExpenseRow>(
    (from, to) =>
      supabase
        .from('receipt_transactions')
        .select('vendor_name, amount_out, amount_in, transaction_date, receipt_vendors(canonical_name)')
        .is('expense_category', null)
        .eq('no_category_applies', false)
        .not('amount_out', 'is', null)
        .order('id')
        .range(from, to),
    { label: 'receipt missing expense summary' },
  )

  const summaryMap = new Map<string, ReceiptMissingExpenseSummaryItem>()

  rows.forEach((row) => {
    // Grouped under the vendor's own name, so two spellings of one vendor are one line.
    const vendorJoin = Array.isArray(row.receipt_vendors) ? row.receipt_vendors[0] : row.receipt_vendors
    const normalizedVendorName = normalizeVendorInput(vendorJoin?.canonical_name) ?? normalizeVendorInput(row.vendor_name)
    const label = normalizedVendorName ?? 'Unassigned vendor'
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

// ---------------------------------------------------------------------------
// getAIUsageBreakdown
// ---------------------------------------------------------------------------

function readAiUsage(data: unknown): AIUsageBreakdown {
  const usage = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return {
    total_cost: Number(usage.total_cost ?? 0),
    this_month_cost: Number(usage.this_month_cost ?? 0),
    total_calls: Number(usage.total_calls ?? 0),
    this_month_calls: Number(usage.this_month_calls ?? 0),
  }
}

export async function queryAIUsageBreakdown(): Promise<{ success: boolean; breakdown?: AIUsageBreakdown; error?: string }> {
  const supabase = createAdminClient()
  const { data, error } = await (supabase as any).rpc('get_receipt_ai_usage')

  if (error) {
    console.error('Failed to fetch receipts AI usage', error)
    return { success: false, error: 'Failed to load AI usage data' }
  }

  return { success: true, breakdown: readAiUsage(data) }
}

// ---------------------------------------------------------------------------
// previewReceiptRule
// ---------------------------------------------------------------------------

type RulePreviewTransactionRow = Pick<
  ReceiptTransaction,
  'id' | 'details' | 'transaction_type' | 'amount_in' | 'amount_out' | 'status' | 'vendor_name' | 'expense_category'
>

export async function queryPreviewReceiptRule(ruleData: {
  name: string
  // Null when the form is clearing the description; the preview only reads the match fields.
  description?: string | null
  match_description?: string
  match_transaction_type?: string
  match_direction: string
  match_min_amount?: number
  match_max_amount?: number
  auto_status: string
  set_vendor_name?: string
  set_expense_category?: string
}): Promise<RulePreviewResult> {
  const supabase = createAdminClient()

  // Every transaction, not a sample. The old single request returned the newest
  // 1,000 of 8,202, so the "would change" figures described about 12% of the
  // history while an "all" retro run applies the rule to the lot. `id` is the
  // unique tiebreak that keeps the page boundaries stable.
  const [{ data: activeRules }, txRows] = await Promise.all([
    supabase
      .from('receipt_rules')
      .select('*')
      .eq('is_active', true),
    fetchAllRows<RulePreviewTransactionRow>(
      (from, to) =>
        supabase
          .from('receipt_transactions')
          .select('id, details, transaction_type, amount_in, amount_out, status, vendor_name, expense_category')
          .order('transaction_date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      { maxRows: 20000, label: 'receipt rule preview transactions' },
    ),
  ])

  const rules = (activeRules ?? []) as ReceiptRule[]

  const candidateRule = {
    id: '__preview__',
    match_description: ruleData.match_description ?? null,
    match_transaction_type: ruleData.match_transaction_type ?? null,
    match_direction: ruleData.match_direction,
    match_min_amount: ruleData.match_min_amount ?? null,
    match_max_amount: ruleData.match_max_amount ?? null,
    auto_status: ruleData.auto_status,
    set_vendor_name: ruleData.set_vendor_name ?? null,
    set_expense_category: ruleData.set_expense_category ?? null,
    is_active: true,
    name: ruleData.name,
  } as ReceiptRule

  let totalMatching = 0
  let pendingMatching = 0
  let wouldChangeStatus = 0
  let wouldChangeVendor = 0
  let wouldChangeExpense = 0

  const overlapMap = new Map<string, number>()

  for (const tx of txRows) {
    const direction = getTransactionDirection(tx as ReceiptTransaction)
    const amountValue = guessAmountValue(tx as ReceiptTransaction)
    const matchContext = { direction, amountValue }

    const match = getRuleMatch(candidateRule, tx, matchContext)
    if (!match.matched) continue

    totalMatching++
    if (tx.status === 'pending') pendingMatching++

    if (ruleData.auto_status && tx.status !== ruleData.auto_status) wouldChangeStatus++
    if (ruleData.set_vendor_name && tx.vendor_name !== ruleData.set_vendor_name) wouldChangeVendor++
    if (ruleData.set_expense_category && tx.expense_category !== ruleData.set_expense_category) wouldChangeExpense++

    // Check which existing rules also match (overlap detection)
    for (const existingRule of rules) {
      const existingMatch = getRuleMatch(existingRule, tx, matchContext)
      if (existingMatch.matched) {
        overlapMap.set(existingRule.id, (overlapMap.get(existingRule.id) ?? 0) + 1)
      }
    }
  }

  const overlappingRules = Array.from(overlapMap.entries())
    .map(([id, count]) => {
      const ruleRecord = rules.find((r) => r.id === id)
      return { id, name: ruleRecord?.name ?? id, overlapCount: count }
    })
    .filter((entry) => entry.overlapCount > 0)
    .sort((a, b) => b.overlapCount - a.overlapCount)
    .slice(0, 5)

  return {
    totalMatching,
    pendingMatching,
    wouldChangeStatus,
    wouldChangeVendor,
    wouldChangeExpense,
    overlappingRules,
  }
}
