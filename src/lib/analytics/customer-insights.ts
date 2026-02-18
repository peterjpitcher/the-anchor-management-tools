import { createAdminClient } from '@/lib/supabase/admin'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const NINETY_DAYS_MS = 90 * ONE_DAY_MS
const SUPABASE_PAGE_SIZE = 1000
const HIGH_VALUE_SCORE_THRESHOLD = 60
const TOP_WIN_BACK_CANDIDATES_LIMIT = 15
const TOP_CATEGORIES_LIMIT = 8

const NON_PRODUCTION_MARKERS = ['api_test', 'test', 'dummy', 'demo', 'sample', 'seed', 'sandbox', 'staging']
const NON_PRODUCTION_CUSTOMER_FILTER = [
  'first_name.ilike.%test%',
  'last_name.ilike.%test%',
  'first_name.ilike.%dummy%',
  'last_name.ilike.%dummy%',
  'first_name.ilike.%demo%',
  'last_name.ilike.%demo%',
  'first_name.ilike.%sample%',
  'last_name.ilike.%sample%',
  'first_name.ilike.%seed%',
  'last_name.ilike.%seed%',
  'first_name.ilike.%sandbox%',
  'last_name.ilike.%sandbox%',
  'first_name.ilike.%staging%',
  'last_name.ilike.%staging%',
  'first_name.ilike.%api_test%',
  'last_name.ilike.%api_test%'
].join(',')

const WINDOW_DAYS: Record<CustomerInsightsWindow, number> = {
  '30d': 30,
  '90d': 90,
  '365d': 365
}

const WINDOW_LABELS: Record<CustomerInsightsWindow, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '365d': 'Last 12 months'
}

type QueryError = { message: string } | null

type PagedQueryResult<T> = {
  data: T[] | null
  error: QueryError
}

type CustomerCountResult = {
  count: number | null
  error: QueryError
}

type CustomerCreatedRow = {
  id: string
  created_at: string | null
}

type BookingActivityRow = {
  customer_id: string | null
  created_at: string | null
}

type MessagingHealthRow = {
  id: string | null
  first_name: string | null
  last_name: string | null
  sms_opt_in: boolean | null
  consecutive_failures: number | string | null
  total_failures_30d: number | string | null
  delivery_rate: number | string | null
  messaging_status: string | null
  last_failure_type: string | null
}

type CategoryStatsRow = {
  customer_id: string
  category_id: string
  times_attended: number | string | null
  event_categories:
    | {
        id: string
        name: string
      }
    | {
        id: string
        name: string
      }[]
    | null
}

type ScoreCustomerRelation = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_e164: string | null
  mobile_number: string | null
}

type CustomerScoreRow = {
  customer_id: string
  total_score: number | string
  last_booking_date: string | null
  bookings_last_30: number | string
  bookings_last_90: number | string
  bookings_last_365: number | string
  booking_breakdown: Record<string, number | string> | null
  customer: ScoreCustomerRelation | ScoreCustomerRelation[] | null
}

export type CustomerInsightsWindow = '30d' | '90d' | '365d'

export type StrategicSignalSeverity = 'positive' | 'watch' | 'risk' | 'info'

export type StrategicSignal = {
  key: 'acquisition_momentum' | 'repeat_strength' | 'dormant_vip_risk' | 'sms_health_risk' | 'category_concentration' | 'data_quality'
  title: string
  severity: StrategicSignalSeverity
  detail: string
  recommendation: string
}

export type CustomerInsightsSnapshot = {
  generated_at: string
  selected_window: {
    key: CustomerInsightsWindow
    label: string
    days: number
    since_iso: string
    previous_since_iso: string
  }
  kpis: {
    total_customers: number
    new_customers: number
    previous_new_customers: number
    new_customer_growth_percent: number
    active_customers: number
    repeat_active_customers: number
    repeat_rate_percent: number
    dormant_customers_90d: number
    dormant_high_value_customers_90d: number
  }
  booking_mix: {
    total_bookings: number
    by_type: {
      event: number
      table: number
      private: number
      parking: number
    }
    shares_percent: {
      event: number
      table: number
      private: number
      parking: number
    }
  }
  top_interest_categories: Array<{
    category_id: string
    category_name: string
    customer_count: number
    average_times_attended: number
  }>
  sms_health: {
    available: boolean
    opted_in_customers: number
    sms_opt_in_rate_percent: number
    sms_at_risk_count: number
    sms_at_risk_rate_percent: number
    top_failure_reasons: Array<{
      reason: string
      count: number
    }>
  }
  win_back_candidates: Array<{
    customer_id: string
    name: string
    mobile: string | null
    total_score: number
    last_booking_date: string | null
    days_since_last_booking: number | null
    bookings_last_90: number
    bookings_last_365: number
  }>
  strategic_signals: StrategicSignal[]
  data_warnings: string[]
}

export type StrategicSignalInput = {
  newCustomerGrowthPercent: number
  repeatRatePercent: number
  dormantHighValueSharePercent: number
  smsAtRiskRatePercent: number
  topCategorySharePercent: number
  dataWarnings: string[]
}

export type CustomerInsightsBuildInput = {
  now: Date
  selectedWindow: CustomerInsightsWindow
  totalCustomerCount: number
  excludedCustomerIds: Set<string>
  customerRows: CustomerCreatedRow[]
  bookingRowsByType: {
    event: BookingActivityRow[]
    table: BookingActivityRow[]
    private: BookingActivityRow[]
    parking: BookingActivityRow[]
  }
  messagingHealthRows?: MessagingHealthRow[] | null
  categoryStatsRows?: CategoryStatsRow[] | null
  customerScoreRows?: CustomerScoreRow[] | null
  messagingHealthAvailable: boolean
  categoryStatsAvailable: boolean
  customerScoresAvailable: boolean
  dataWarnings: string[]
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Number(((numerator / denominator) * 100).toFixed(1))
}

function hasNonProductionMarker(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return false
  return NON_PRODUCTION_MARKERS.some((marker) => normalized.includes(marker))
}

function isNonProductionCustomerName(firstName: string | null | undefined, lastName: string | null | undefined): boolean {
  return hasNonProductionMarker(firstName) || hasNonProductionMarker(lastName)
}

function resolveCustomerRelation(customer: CustomerScoreRow['customer']): ScoreCustomerRelation | null {
  if (!customer) return null
  if (Array.isArray(customer)) return customer[0] ?? null
  return customer
}

function resolveCategoryRelation(
  category: CategoryStatsRow['event_categories']
): {
  id: string
  name: string
} | null {
  if (!category) return null
  if (Array.isArray(category)) return category[0] ?? null
  return category
}

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>
): Promise<{ data: T[]; error: QueryError }> {
  const rows: T[] = []

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1
    const { data, error } = await buildQuery(from, to)

    if (error) {
      return { data: [], error }
    }

    const pageRows = data || []
    rows.push(...pageRows)

    if (pageRows.length < SUPABASE_PAGE_SIZE) {
      break
    }
  }

  return { data: rows, error: null }
}

function normalizeLastBookingDateToIso(value: string | null): string | null {
  if (!value) return null
  if (value.includes('T')) return value
  return `${value}T00:00:00.000Z`
}

function calculateDaysSince(lastBookingIso: string | null, nowMs: number): number | null {
  if (!lastBookingIso) return null
  const timestamp = Date.parse(lastBookingIso)
  if (!Number.isFinite(timestamp)) return null
  const diff = nowMs - timestamp
  if (diff < 0) return 0
  return Math.floor(diff / ONE_DAY_MS)
}

function isSmsAtRisk(row: MessagingHealthRow): boolean {
  const normalizedStatus = row.messaging_status?.toLowerCase().trim() || ''

  if (normalizedStatus === 'failed' || normalizedStatus === 'degraded' || normalizedStatus === 'blocked') {
    return true
  }

  const consecutiveFailures = asNumber(row.consecutive_failures)
  if (consecutiveFailures >= 2) {
    return true
  }

  const totalFailures30d = asNumber(row.total_failures_30d)
  if (totalFailures30d >= 3) {
    return true
  }

  const deliveryRate = asNumber(row.delivery_rate)
  if (deliveryRate > 0 && deliveryRate < 85) {
    return true
  }

  return false
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatSignedPercent(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

export function resolveCustomerInsightsWindow(value: string | null | undefined): CustomerInsightsWindow {
  if (value === '30d' || value === '90d' || value === '365d') {
    return value
  }

  return '30d'
}

export function calculateGrowthPercent(current: number, previous: number): number {
  if (previous <= 0) {
    return current <= 0 ? 0 : 100
  }

  return Number((((current - previous) / previous) * 100).toFixed(1))
}

export function buildStrategicSignals(input: StrategicSignalInput): StrategicSignal[] {
  const signals: StrategicSignal[] = []

  const acquisitionSeverity: StrategicSignalSeverity =
    input.newCustomerGrowthPercent >= 15
      ? 'positive'
      : input.newCustomerGrowthPercent <= -10
        ? 'risk'
        : 'watch'

  signals.push({
    key: 'acquisition_momentum',
    title: 'Acquisition momentum',
    severity: acquisitionSeverity,
    detail: `New-customer growth is ${formatSignedPercent(input.newCustomerGrowthPercent)} versus the previous period.`,
    recommendation:
      acquisitionSeverity === 'risk'
        ? 'Increase high-performing channel investment and refresh acquisition offers this month.'
        : acquisitionSeverity === 'watch'
          ? 'Track weekly growth by campaign and test one new acquisition lever.'
          : 'Maintain momentum by scaling channels that drive the strongest first-time guests.'
  })

  const repeatSeverity: StrategicSignalSeverity =
    input.repeatRatePercent >= 45 ? 'positive' : input.repeatRatePercent < 25 ? 'risk' : 'watch'

  signals.push({
    key: 'repeat_strength',
    title: 'Repeat customer strength',
    severity: repeatSeverity,
    detail: `${formatPercent(input.repeatRatePercent)} of active customers booked more than once in-window.`,
    recommendation:
      repeatSeverity === 'risk'
        ? 'Prioritize a short-cycle retention campaign for first-time guests after their first visit.'
        : repeatSeverity === 'watch'
          ? 'Identify top-performing repeat segments and replicate their journey in weaker segments.'
          : 'Continue reinforcing repeat behavior with loyalty and targeted post-visit messaging.'
  })

  const dormantSeverity: StrategicSignalSeverity =
    input.dormantHighValueSharePercent >= 30
      ? 'risk'
      : input.dormantHighValueSharePercent >= 15
        ? 'watch'
        : 'positive'

  signals.push({
    key: 'dormant_vip_risk',
    title: 'Dormant high-value customer risk',
    severity: dormantSeverity,
    detail: `${formatPercent(input.dormantHighValueSharePercent)} of scored customers are high-value and dormant for 90+ days.`,
    recommendation:
      dormantSeverity === 'risk'
        ? 'Launch a focused win-back sequence for dormant high-value customers immediately.'
        : dormantSeverity === 'watch'
          ? 'Build a monthly win-back cadence and monitor conversion back to active.'
          : 'Current dormant high-value risk is controlled; maintain proactive reactivation nudges.'
  })

  const smsSeverity: StrategicSignalSeverity =
    input.smsAtRiskRatePercent >= 20 ? 'risk' : input.smsAtRiskRatePercent >= 10 ? 'watch' : 'positive'

  signals.push({
    key: 'sms_health_risk',
    title: 'SMS deliverability risk',
    severity: smsSeverity,
    detail: `${formatPercent(input.smsAtRiskRatePercent)} of opted-in customers are currently at SMS risk.`,
    recommendation:
      smsSeverity === 'risk'
        ? 'Audit message quality and phone hygiene now; suppress high-risk segments until stabilized.'
        : smsSeverity === 'watch'
          ? 'Review failure reasons weekly and proactively clean phone and consent data.'
          : 'Deliverability is healthy; continue monitoring weekly to prevent regressions.'
  })

  const categorySeverity: StrategicSignalSeverity =
    input.topCategorySharePercent >= 50 ? 'risk' : input.topCategorySharePercent >= 35 ? 'watch' : 'positive'

  signals.push({
    key: 'category_concentration',
    title: 'Interest concentration',
    severity: categorySeverity,
    detail: `Top category concentration is ${formatPercent(input.topCategorySharePercent)} of tracked category interest.`,
    recommendation:
      categorySeverity === 'risk'
        ? 'Reduce dependency risk by diversifying event programming and cross-category promotion.'
        : categorySeverity === 'watch'
          ? 'Pilot one adjacent-category promotion to broaden participation mix.'
          : 'Category mix is balanced; keep rotating offers to maintain broad engagement.'
  })

  if (input.dataWarnings.length > 0) {
    signals.push({
      key: 'data_quality',
      title: 'Data completeness',
      severity: 'info',
      detail: `${input.dataWarnings.length} optional dataset(s) were unavailable.`,
      recommendation: 'Treat related sections as directional until those datasets are restored.'
    })
  }

  return signals
}

export function buildCustomerInsightsSnapshot(input: CustomerInsightsBuildInput): CustomerInsightsSnapshot {
  const nowMs = input.now.getTime()
  const windowDays = WINDOW_DAYS[input.selectedWindow]
  const selectedWindowSinceMs = nowMs - windowDays * ONE_DAY_MS
  const previousWindowSinceMs = nowMs - windowDays * 2 * ONE_DAY_MS

  const totalCustomers = Math.max(0, input.totalCustomerCount - input.excludedCustomerIds.size)

  let newCustomers = 0
  let previousNewCustomers = 0

  for (const row of input.customerRows) {
    if (input.excludedCustomerIds.has(row.id)) continue
    if (!row.created_at) continue

    const createdAtMs = Date.parse(row.created_at)
    if (!Number.isFinite(createdAtMs)) continue

    if (createdAtMs >= selectedWindowSinceMs && createdAtMs <= nowMs) {
      newCustomers += 1
      continue
    }

    if (createdAtMs >= previousWindowSinceMs && createdAtMs < selectedWindowSinceMs) {
      previousNewCustomers += 1
    }
  }

  const bookingTypeCounts = {
    event: 0,
    table: 0,
    private: 0,
    parking: 0
  }

  const activeCustomers = new Set<string>()
  const bookingCountByCustomer = new Map<string, number>()

  const appendBookings = (
    rows: BookingActivityRow[],
    bookingType: keyof typeof bookingTypeCounts
  ) => {
    for (const row of rows) {
      if (!row.customer_id || input.excludedCustomerIds.has(row.customer_id)) continue
      if (!row.created_at) continue

      const createdAtMs = Date.parse(row.created_at)
      if (!Number.isFinite(createdAtMs)) continue
      if (createdAtMs < selectedWindowSinceMs || createdAtMs > nowMs) continue

      bookingTypeCounts[bookingType] += 1
      activeCustomers.add(row.customer_id)
      bookingCountByCustomer.set(row.customer_id, (bookingCountByCustomer.get(row.customer_id) ?? 0) + 1)
    }
  }

  appendBookings(input.bookingRowsByType.event, 'event')
  appendBookings(input.bookingRowsByType.table, 'table')
  appendBookings(input.bookingRowsByType.private, 'private')
  appendBookings(input.bookingRowsByType.parking, 'parking')

  const repeatActiveCustomers = Array.from(bookingCountByCustomer.values()).filter((count) => count >= 2).length
  const totalBookings = bookingTypeCounts.event + bookingTypeCounts.table + bookingTypeCounts.private + bookingTypeCounts.parking

  const messagingRows = (input.messagingHealthRows || []).filter((row) => {
    if (!row.id) return false
    if (input.excludedCustomerIds.has(row.id)) return false
    if (isNonProductionCustomerName(row.first_name, row.last_name)) return false
    return true
  })

  const optedInCustomers = messagingRows.filter((row) => row.sms_opt_in === true).length
  const smsAtRiskCount = messagingRows.filter((row) => row.sms_opt_in === true && isSmsAtRisk(row)).length

  const failureReasonCounts = new Map<string, number>()
  for (const row of messagingRows) {
    if (!row.last_failure_type) continue
    if (!isSmsAtRisk(row)) continue
    failureReasonCounts.set(row.last_failure_type, (failureReasonCounts.get(row.last_failure_type) ?? 0) + 1)
  }

  const topFailureReasons = Array.from(failureReasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const categoryRows = input.categoryStatsRows || []
  const categoryMap = new Map<string, { category_id: string; category_name: string; customer_ids: Set<string>; total_times_attended: number }>()

  for (const row of categoryRows) {
    if (!row.customer_id || input.excludedCustomerIds.has(row.customer_id)) continue

    const category = resolveCategoryRelation(row.event_categories)
    if (!category) continue

    const current = categoryMap.get(category.id) || {
      category_id: category.id,
      category_name: category.name,
      customer_ids: new Set<string>(),
      total_times_attended: 0
    }

    current.customer_ids.add(row.customer_id)
    current.total_times_attended += Math.max(0, Math.round(asNumber(row.times_attended)))

    categoryMap.set(category.id, current)
  }

  const topInterestCategories = Array.from(categoryMap.values())
    .map((entry) => {
      const customerCount = entry.customer_ids.size
      const averageTimes = customerCount > 0 ? Number((entry.total_times_attended / customerCount).toFixed(1)) : 0

      return {
        category_id: entry.category_id,
        category_name: entry.category_name,
        customer_count: customerCount,
        average_times_attended: averageTimes
      }
    })
    .sort((a, b) => {
      if (b.customer_count !== a.customer_count) {
        return b.customer_count - a.customer_count
      }

      return b.average_times_attended - a.average_times_attended
    })
    .slice(0, TOP_CATEGORIES_LIMIT)

  const scoreRows = (input.customerScoreRows || []).filter((row) => {
    if (input.excludedCustomerIds.has(row.customer_id)) return false

    const customer = resolveCustomerRelation(row.customer)
    if (isNonProductionCustomerName(customer?.first_name, customer?.last_name)) return false

    return true
  })

  const dormantCutoffMs = nowMs - NINETY_DAYS_MS
  let dormantCustomers90d = 0
  let dormantHighValueCustomers90d = 0

  const winBackCandidates = scoreRows
    .map((row) => {
      const totalScore = asNumber(row.total_score)
      const bookingsLast90 = asNumber(row.bookings_last_90)
      const bookingsLast365 = asNumber(row.bookings_last_365)
      const lastBookingIso = normalizeLastBookingDateToIso(row.last_booking_date)
      const lastBookingMs = lastBookingIso ? Date.parse(lastBookingIso) : Number.NaN
      const isDormant = !Number.isFinite(lastBookingMs) || lastBookingMs < dormantCutoffMs
      const isHighValue = totalScore >= HIGH_VALUE_SCORE_THRESHOLD

      if (isDormant) {
        dormantCustomers90d += 1
      }

      if (isDormant && isHighValue) {
        dormantHighValueCustomers90d += 1
      }

      const customer = resolveCustomerRelation(row.customer)
      const firstName = customer?.first_name?.trim() || ''
      const lastName = customer?.last_name?.trim() || ''

      return {
        customer_id: row.customer_id,
        name: `${firstName} ${lastName}`.trim() || 'Unknown customer',
        mobile: customer?.mobile_e164 || customer?.mobile_number || null,
        total_score: totalScore,
        last_booking_date: row.last_booking_date,
        days_since_last_booking: calculateDaysSince(lastBookingIso, nowMs),
        bookings_last_90: bookingsLast90,
        bookings_last_365: bookingsLast365,
        is_dormant: isDormant,
        is_high_value: isHighValue
      }
    })
    .filter((candidate) => candidate.is_dormant && candidate.is_high_value)
    .sort((a, b) => {
      if (b.total_score !== a.total_score) {
        return b.total_score - a.total_score
      }

      if (b.bookings_last_365 !== a.bookings_last_365) {
        return b.bookings_last_365 - a.bookings_last_365
      }

      const aDays = a.days_since_last_booking ?? Number.MAX_SAFE_INTEGER
      const bDays = b.days_since_last_booking ?? Number.MAX_SAFE_INTEGER
      return bDays - aDays
    })
    .slice(0, TOP_WIN_BACK_CANDIDATES_LIMIT)
    .map(({ is_dormant: _isDormant, is_high_value: _isHighValue, ...candidate }) => candidate)

  const topCategoryTotalCustomers = topInterestCategories.reduce((sum, item) => sum + item.customer_count, 0)
  const topCategorySharePercent =
    topInterestCategories.length > 0
      ? toRate(topInterestCategories[0].customer_count, topCategoryTotalCustomers)
      : 0

  const dormantHighValueSharePercent = toRate(dormantHighValueCustomers90d, scoreRows.length)
  const newCustomerGrowthPercent = calculateGrowthPercent(newCustomers, previousNewCustomers)
  const repeatRatePercent = toRate(repeatActiveCustomers, activeCustomers.size)
  const smsOptInRatePercent = toRate(optedInCustomers, totalCustomers)
  const smsAtRiskRatePercent = toRate(smsAtRiskCount, optedInCustomers)

  const strategicSignals = buildStrategicSignals({
    newCustomerGrowthPercent,
    repeatRatePercent,
    dormantHighValueSharePercent,
    smsAtRiskRatePercent,
    topCategorySharePercent,
    dataWarnings: input.dataWarnings
  })

  return {
    generated_at: input.now.toISOString(),
    selected_window: {
      key: input.selectedWindow,
      label: WINDOW_LABELS[input.selectedWindow],
      days: windowDays,
      since_iso: new Date(selectedWindowSinceMs).toISOString(),
      previous_since_iso: new Date(previousWindowSinceMs).toISOString()
    },
    kpis: {
      total_customers: totalCustomers,
      new_customers: newCustomers,
      previous_new_customers: previousNewCustomers,
      new_customer_growth_percent: newCustomerGrowthPercent,
      active_customers: activeCustomers.size,
      repeat_active_customers: repeatActiveCustomers,
      repeat_rate_percent: repeatRatePercent,
      dormant_customers_90d: dormantCustomers90d,
      dormant_high_value_customers_90d: dormantHighValueCustomers90d
    },
    booking_mix: {
      total_bookings: totalBookings,
      by_type: bookingTypeCounts,
      shares_percent: {
        event: toRate(bookingTypeCounts.event, totalBookings),
        table: toRate(bookingTypeCounts.table, totalBookings),
        private: toRate(bookingTypeCounts.private, totalBookings),
        parking: toRate(bookingTypeCounts.parking, totalBookings)
      }
    },
    top_interest_categories: topInterestCategories,
    sms_health: {
      available: input.messagingHealthAvailable,
      opted_in_customers: optedInCustomers,
      sms_opt_in_rate_percent: smsOptInRatePercent,
      sms_at_risk_count: smsAtRiskCount,
      sms_at_risk_rate_percent: smsAtRiskRatePercent,
      top_failure_reasons: topFailureReasons
    },
    win_back_candidates: winBackCandidates,
    strategic_signals: strategicSignals,
    data_warnings: input.dataWarnings
  }
}

export async function loadCustomerInsightsSnapshot(input: {
  window?: string | null
} = {}): Promise<CustomerInsightsSnapshot> {
  const supabase = createAdminClient()
  const now = new Date()
  const selectedWindow = resolveCustomerInsightsWindow(input.window)
  const selectedWindowDays = WINDOW_DAYS[selectedWindow]

  const selectedSinceIso = new Date(now.getTime() - selectedWindowDays * ONE_DAY_MS).toISOString()
  const previousSinceIso = new Date(now.getTime() - selectedWindowDays * 2 * ONE_DAY_MS).toISOString()

  const [
    totalCustomersResult,
    nonProductionCustomersResult,
    customerRowsResult,
    eventBookingRowsResult,
    tableBookingRowsResult,
    privateBookingRowsResult,
    parkingBookingRowsResult,
    messagingHealthRowsResult,
    categoryStatsRowsResult,
    customerScoreRowsResult
  ] = await Promise.all([
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true }) as PromiseLike<CustomerCountResult>,
    fetchAllRows((from, to) =>
      supabase
        .from('customers')
        .select('id')
        .or(NON_PRODUCTION_CUSTOMER_FILTER)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('customers')
        .select('id, created_at')
        .gte('created_at', previousSinceIso)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('bookings')
        .select('customer_id, created_at')
        .not('customer_id', 'is', null)
        .gte('created_at', selectedSinceIso)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('table_bookings')
        .select('customer_id, created_at')
        .not('customer_id', 'is', null)
        .gte('created_at', selectedSinceIso)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('private_bookings')
        .select('customer_id, created_at')
        .not('customer_id', 'is', null)
        .gte('created_at', selectedSinceIso)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('parking_bookings')
        .select('customer_id, created_at')
        .not('customer_id', 'is', null)
        .gte('created_at', selectedSinceIso)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('customer_messaging_health')
        .select('id, first_name, last_name, sms_opt_in, consecutive_failures, total_failures_30d, delivery_rate, messaging_status, last_failure_type')
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('customer_category_stats')
        .select('customer_id, category_id, times_attended, event_categories(id, name)')
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from('customer_scores')
        .select(
          `
            customer_id,
            total_score,
            last_booking_date,
            bookings_last_30,
            bookings_last_90,
            bookings_last_365,
            booking_breakdown,
            customer:customers(id, first_name, last_name, mobile_e164, mobile_number)
          `
        )
        .range(from, to)
    )
  ])

  const coreErrors = [
    totalCustomersResult.error,
    nonProductionCustomersResult.error,
    customerRowsResult.error,
    eventBookingRowsResult.error,
    tableBookingRowsResult.error,
    privateBookingRowsResult.error,
    parkingBookingRowsResult.error
  ].filter((error): error is { message: string } => Boolean(error))

  if (coreErrors.length > 0) {
    throw new Error(`Failed to load customer insights: ${coreErrors.map((error) => error.message).join('; ')}`)
  }

  const dataWarnings: string[] = []

  let messagingHealthAvailable = true
  let categoryStatsAvailable = true
  let customerScoresAvailable = true

  if (messagingHealthRowsResult.error) {
    messagingHealthAvailable = false
    dataWarnings.push('SMS health metrics are temporarily unavailable.')
  }

  if (categoryStatsRowsResult.error) {
    categoryStatsAvailable = false
    dataWarnings.push('Category-interest metrics are temporarily unavailable.')
  }

  if (customerScoreRowsResult.error) {
    customerScoresAvailable = false
    dataWarnings.push('Customer engagement scoring metrics are temporarily unavailable.')
  }

  const excludedCustomerIds = new Set(
    (nonProductionCustomersResult.data as Array<{ id: string }> | null | undefined)?.map((row) => row.id) || []
  )

  return buildCustomerInsightsSnapshot({
    now,
    selectedWindow,
    totalCustomerCount: totalCustomersResult.count ?? 0,
    excludedCustomerIds,
    customerRows: (customerRowsResult.data as CustomerCreatedRow[] | null) || [],
    bookingRowsByType: {
      event: (eventBookingRowsResult.data as BookingActivityRow[] | null) || [],
      table: (tableBookingRowsResult.data as BookingActivityRow[] | null) || [],
      private: (privateBookingRowsResult.data as BookingActivityRow[] | null) || [],
      parking: (parkingBookingRowsResult.data as BookingActivityRow[] | null) || []
    },
    messagingHealthRows: (messagingHealthRowsResult.data as MessagingHealthRow[] | null) || [],
    categoryStatsRows: (categoryStatsRowsResult.data as CategoryStatsRow[] | null) || [],
    customerScoreRows: (customerScoreRowsResult.data as CustomerScoreRow[] | null) || [],
    messagingHealthAvailable,
    categoryStatsAvailable,
    customerScoresAvailable,
    dataWarnings
  })
}
