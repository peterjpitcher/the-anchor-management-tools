/**
 * Read-only receipt query operations.
 *
 * All functions in this module perform SELECT-only database operations.
 * Auth checks are performed by the caller (server action layer).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { classifyReceiptTransaction } from '@/lib/openai'
import { getOpenAIConfig } from '@/lib/openai/config'
import { getRuleMatch } from '@/lib/receipts/rule-matching'
import { recordAIUsage } from '@/lib/receipts/ai-classification'
import type { ReceiptRule, ReceiptTransaction } from '@/types/database'

import type {
  AdminClient,
  ReceiptWorkspaceFilters,
  ReceiptWorkspaceData,
  ReceiptWorkspaceSummary,
  ReceiptBulkReviewData,
  ReceiptDetailGroup,
  ReceiptDetailGroupSuggestion,
  NormalizedDetailGroupRow,
  ReceiptMonthlySummaryItem,
  ReceiptMonthlyInsights,
  ReceiptMonthlyInsightMonth,
  ReceiptVendorSummary,
  ReceiptVendorTrendMonth,
  ReceiptVendorMonthTransaction,
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
  deriveDirection,
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

// ---------------------------------------------------------------------------
// buildGroupSuggestion — AI-assisted classification for bulk review groups
// ---------------------------------------------------------------------------

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

  let outcome
  try {
    outcome = await classifyReceiptTransaction({
      details: group.details,
      amountIn,
      amountOut,
      transactionType: sample?.transactionType ?? null,
      categories: EXPENSE_CATEGORY_OPTIONS,
      direction,
      existingVendor: existingVendor ?? undefined,
      existingExpenseCategory: existingExpense ?? undefined,
    })
  } catch (aiError) {
    console.error('AI classification failed for group, falling back to existing data', aiError)
    return suggestion
  }

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

// ---------------------------------------------------------------------------
// fetchSummary — dashboard summary data
// ---------------------------------------------------------------------------

export async function fetchSummary(): Promise<ReceiptWorkspaceSummary> {
  const supabase = createAdminClient()
  const [{ data: statusCounts }, { data: lastBatch }, { data: costData, error: costError }, { data: breakdownData, error: breakdownError }, { count: failedJobCount, error: failedJobsError }] = await Promise.all([
    supabase.rpc('count_receipt_statuses'),
    supabase
      .from('receipt_batches')
      .select('id, uploaded_at, uploaded_by, original_filename, source_hash, row_count, notes, created_at')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc('get_openai_usage_total'),
    supabase.rpc('get_ai_usage_breakdown'),
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'classify_receipt_transactions')
      .eq('status', 'failed'),
  ])

  const counts = Array.isArray(statusCounts) ? statusCounts[0] : statusCounts

  if (costError) {
    console.error('Failed to fetch OpenAI usage total', costError)
  }

  if (breakdownError) {
    console.error('Failed to fetch AI usage breakdown', breakdownError)
  }

  if (failedJobsError) {
    console.error('Failed to fetch failed AI job count:', failedJobsError)
  }

  const pending = Number(counts?.pending ?? 0)
  const completed = Number(counts?.completed ?? 0)
  const autoCompleted = Number(counts?.auto_completed ?? 0)
  const noReceiptRequired = Number(counts?.no_receipt_required ?? 0)
  const cantFind = Number(counts?.cant_find ?? 0)
  const openAICost = costError ? 0 : Number(costData ?? 0)

  let aiUsageBreakdown: AIUsageBreakdown | null = null
  if (!breakdownError && breakdownData && typeof breakdownData === 'object') {
    const bd = breakdownData as Record<string, unknown>
    aiUsageBreakdown = {
      total_cost: Number(bd.total_cost ?? 0),
      this_month_cost: Number(bd.this_month_cost ?? 0),
      total_classifications: Number(bd.total_classifications ?? 0),
      this_month_classifications: Number(bd.this_month_classifications ?? 0),
      model_breakdown: Array.isArray(bd.model_breakdown) ? (bd.model_breakdown as AIUsageBreakdown['model_breakdown']) : null,
    }
  }

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
    aiUsageBreakdown,
    failedAiJobCount: failedJobCount ?? 0,
  }
}

// ---------------------------------------------------------------------------
// getReceiptWorkspaceData
// ---------------------------------------------------------------------------

export async function queryReceiptWorkspaceData(filters: ReceiptWorkspaceFilters = {}): Promise<ReceiptWorkspaceData> {
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

  const shapedTransactions = (transactions ?? []).map((tx: any) => ({
    ...tx,
    files: tx.receipt_files ?? [],
    autoRule: tx.receipt_rules?.[0] ?? null,
  }))

  const knownVendorSet = new Set<string>()

  ;(vendorRecords ?? []).forEach((record: any) => {
    const normalized = normalizeVendorInput(record.vendor_name)
    if (normalized) {
      knownVendorSet.add(normalized)
    }
  })

  shapedTransactions.forEach((tx: any) => {
    const normalized = normalizeVendorInput(tx.vendor_name)
    if (normalized) {
      knownVendorSet.add(normalized)
    }
  })

  ;(rules ?? []).forEach((rule: any) => {
    const normalized = normalizeVendorInput(rule.set_vendor_name)
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

// ---------------------------------------------------------------------------
// getReceiptVendorSummary
// ---------------------------------------------------------------------------

export async function queryReceiptVendorSummary(monthWindow = 12): Promise<ReceiptVendorSummary[]> {
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

  rows.forEach((row: any) => {
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
// getReceiptVendorMonthTransactions
// ---------------------------------------------------------------------------

export async function queryReceiptVendorMonthTransactions(input: {
  vendorLabel: string
  monthStart: string
}): Promise<{ transactions: ReceiptVendorMonthTransaction[]; error?: string }> {
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
    .eq('vendor_name', normalizedVendor)
    .gte('transaction_date', start.toISOString())
    .lt('transaction_date', end.toISOString())
    .order('transaction_date', { ascending: true })
    .limit(1000)

  if (error) {
    console.error('Failed to load vendor month transactions', error)
    return { transactions: [], error: 'Failed to load transactions for this vendor.' }
  }

  const rows = Array.isArray(data) ? data : []

  return {
    transactions: rows.map((row: any) => ({
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

// ---------------------------------------------------------------------------
// getReceiptMissingExpenseSummary
// ---------------------------------------------------------------------------

export async function queryReceiptMissingExpenseSummary(): Promise<ReceiptMissingExpenseSummaryItem[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('receipt_transactions')
    .select('vendor_name, amount_out, amount_in, transaction_date')
    .is('expense_category', null)
    .not('amount_out', 'is', null)
    .limit(5000)

  if (error) {
    console.error('Failed to load missing expense summary', error)
    throw error
  }

  const summaryMap = new Map<string, ReceiptMissingExpenseSummaryItem>()

  ;(data ?? []).forEach((row: any) => {
    const normalizedVendorName = normalizeVendorInput(row.vendor_name)
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

export async function queryAIUsageBreakdown(): Promise<{ success: boolean; breakdown?: AIUsageBreakdown; error?: string }> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_ai_usage_breakdown')

  if (error) {
    console.error('Failed to fetch AI usage breakdown', error)
    return { success: false, error: 'Failed to load AI usage data' }
  }

  if (!data || typeof data !== 'object') {
    return { success: true, breakdown: { total_cost: 0, this_month_cost: 0, total_classifications: 0, this_month_classifications: 0, model_breakdown: null } }
  }

  const bd = data as Record<string, unknown>
  return {
    success: true,
    breakdown: {
      total_cost: Number(bd.total_cost ?? 0),
      this_month_cost: Number(bd.this_month_cost ?? 0),
      total_classifications: Number(bd.total_classifications ?? 0),
      this_month_classifications: Number(bd.this_month_classifications ?? 0),
      model_breakdown: Array.isArray(bd.model_breakdown) ? (bd.model_breakdown as AIUsageBreakdown['model_breakdown']) : null,
    },
  }
}

// ---------------------------------------------------------------------------
// previewReceiptRule
// ---------------------------------------------------------------------------

export async function queryPreviewReceiptRule(ruleData: {
  name: string
  description?: string
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

  // Load active rules and sample transactions in parallel
  const [{ data: activeRules }, { data: transactions }] = await Promise.all([
    supabase
      .from('receipt_rules')
      .select('*')
      .eq('is_active', true),
    supabase
      .from('receipt_transactions')
      .select('id, details, transaction_type, amount_in, amount_out, status, vendor_name, expense_category')
      .order('transaction_date', { ascending: false })
      .limit(2000),
  ])

  const rules = (activeRules ?? []) as ReceiptRule[]

  const txRows = (transactions ?? []) as Array<Pick<ReceiptTransaction, 'id' | 'details' | 'transaction_type' | 'amount_in' | 'amount_out' | 'status' | 'vendor_name' | 'expense_category'>>

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
