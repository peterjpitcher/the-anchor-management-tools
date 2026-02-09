import { createAdminClient } from '@/lib/supabase/admin'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const THREE_SIXTY_FIVE_DAYS_MS = 365 * 24 * 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_WEEK_MS = 7 * ONE_DAY_MS
const NON_PRODUCTION_MARKERS = ['api_test', 'test', 'dummy', 'demo', 'sample', 'seed', 'sandbox', 'staging']

const EVENT_BOOKING_ALLOWED_SOURCES = new Set([
  'direct_booking',
  'bulk_add',
  'customer_portal',
  'sms_reply'
])

const TABLE_BOOKING_ALLOWED_SOURCES = new Set([
  'website',
  'website_wizard',
  'phone',
  'walk-in',
  'admin',
  'brand_site'
])

const PRIVATE_BOOKING_ALLOWED_SOURCES = new Set([
  'website',
  'walk-in',
  'whatsapp',
  'phone',
  'email',
  'admin',
  'brand_site',
  'referral',
  'other'
])

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
  'last_name.ilike.%sandbox%'
].join(',')

export type TableBookingReportsWindow = 'day' | 'week' | 'month' | 'year'

const REPORT_WINDOW_DAYS: Record<TableBookingReportsWindow, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365
}

const REPORT_WINDOW_LABELS: Record<TableBookingReportsWindow, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  year: 'Year'
}

type TimestampedCustomerRecord = {
  customer_id: string | null
  created_at: string | null
}

type NonProductionCustomerRow = {
  id: string
}

type CoverTrendBucket = {
  label: string
  startMs: number
  endMs: number
}

type EventCoverRow = {
  customer_id: string | null
  created_at: string | null
  seats: number | null
  booking_source: string | null
}

type TableCoverRow = {
  customer_id: string | null
  created_at: string | null
  party_size: number | null
  source: string | null
}

type PrivateCoverRow = {
  customer_id: string | null
  created_at: string | null
  guest_count: number | null
  source: string | null
}

type EngagementRow = {
  customer_id: string
  total_score: number
  last_booking_date: string | null
  bookings_last_30: number
  bookings_last_90: number
  bookings_last_365: number
  booking_breakdown: Record<string, number> | null
  customer?: {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_e164: string | null
    mobile_number: string | null
  } | {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_e164: string | null
    mobile_number: string | null
  }[] | null
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toRate(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0
  return Number(((numerator / denominator) * 100).toFixed(1))
}

function resolveCustomerRelation(
  customer: EngagementRow['customer']
): {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_e164: string | null
  mobile_number: string | null
} | null {
  if (!customer) return null
  if (Array.isArray(customer)) {
    return customer[0] || null
  }
  return customer
}

function normalizeEventType(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : 'Uncategorized'
}

function normalizeSource(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function isAllowedSource(value: string | null | undefined, allowedSources: Set<string>): boolean {
  const normalized = normalizeSource(value)
  if (!normalized) return true
  return allowedSources.has(normalized)
}

function buildSourceOrFilter(column: string, allowedSources: Set<string>): string {
  const allowedChecks = Array.from(allowedSources.values()).map((source) => `${column}.eq.${source}`)
  return [`${column}.is.null`, ...allowedChecks].join(',')
}

function hasNonProductionMarker(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return false
  return NON_PRODUCTION_MARKERS.some((marker) => normalized.includes(marker))
}

function isNonProductionCustomerName(firstName: string | null | undefined, lastName: string | null | undefined): boolean {
  return hasNonProductionMarker(firstName) || hasNonProductionMarker(lastName)
}

export function resolveTableBookingReportsWindow(value: string | null | undefined): TableBookingReportsWindow {
  if (value === 'day' || value === 'week' || value === 'month' || value === 'year') {
    return value
  }
  return 'month'
}

function formatShortLondonDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short'
  }).format(new Date(iso))
}

function buildCoverTrendBuckets(window: TableBookingReportsWindow, now: Date): CoverTrendBucket[] {
  const nowMs = now.getTime()

  if (window === 'day') {
    const currentHourStartMs = Math.floor(nowMs / ONE_HOUR_MS) * ONE_HOUR_MS
    const startMs = currentHourStartMs - 23 * ONE_HOUR_MS
    return Array.from({ length: 24 }, (_, index) => {
      const bucketStartMs = startMs + index * ONE_HOUR_MS
      const bucketEndMs =
        index === 23
          ? nowMs
          : bucketStartMs + ONE_HOUR_MS
      const label = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(new Date(bucketStartMs))

      return {
        label,
        startMs: bucketStartMs,
        endMs: bucketEndMs
      }
    })
  }

  if (window === 'week') {
    const startMs = nowMs - ONE_WEEK_MS
    return Array.from({ length: 7 }, (_, index) => {
      const bucketStartMs = startMs + index * ONE_DAY_MS
      const bucketEndMs = index === 6 ? nowMs : bucketStartMs + ONE_DAY_MS
      const label = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'short',
        day: 'numeric'
      }).format(new Date(bucketStartMs))

      return {
        label,
        startMs: bucketStartMs,
        endMs: bucketEndMs
      }
    })
  }

  if (window === 'month') {
    const startMs = nowMs - THIRTY_DAYS_MS
    return Array.from({ length: 5 }, (_, index) => {
      const bucketStartMs = startMs + index * ONE_WEEK_MS
      const bucketEndMs = index === 4 ? nowMs : Math.min(nowMs, bucketStartMs + ONE_WEEK_MS)
      const endLabelMs = Math.max(bucketStartMs, bucketEndMs - 1)
      const label = `${formatShortLondonDate(new Date(bucketStartMs).toISOString())} - ${formatShortLondonDate(new Date(endLabelMs).toISOString())}`

      return {
        label,
        startMs: bucketStartMs,
        endMs: bucketEndMs
      }
    }).filter((bucket) => bucket.endMs > bucket.startMs)
  }

  const firstMonthStartUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1, 0, 0, 0, 0)
  const yearBuckets: CoverTrendBucket[] = []
  for (let index = 0; index < 12; index += 1) {
    const bucketStartMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - 11 + index,
      1,
      0,
      0,
      0,
      0
    )
    const nominalEndMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - 10 + index,
      1,
      0,
      0,
      0,
      0
    )
    const bucketEndMs = index === 11 ? nowMs : nominalEndMs
    if (bucketEndMs <= bucketStartMs) continue

    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      month: 'short'
    }).format(new Date(bucketStartMs))

    yearBuckets.push({
      label,
      startMs: Math.max(bucketStartMs, firstMonthStartUtcMs),
      endMs: bucketEndMs
    })
  }

  return yearBuckets
}

function mapCoverTrendGranularity(window: TableBookingReportsWindow): 'hour' | 'day' | 'week' | 'month' {
  switch (window) {
    case 'day':
      return 'hour'
    case 'week':
      return 'day'
    case 'month':
      return 'week'
    case 'year':
      return 'month'
  }
}

function aggregateCoverTrend(
  buckets: CoverTrendBucket[],
  rows: Array<{ created_at: string | null; covers: number; customer_id: string | null }>,
  excludedCustomerIds: Set<string>
) {
  const totals = new Array<number>(buckets.length).fill(0)

  for (const row of rows) {
    if (!row.created_at || !Number.isFinite(row.covers) || row.covers <= 0) continue
    if (row.customer_id && excludedCustomerIds.has(row.customer_id)) continue
    const timestampMs = Date.parse(row.created_at)
    if (!Number.isFinite(timestampMs)) continue

    for (let index = 0; index < buckets.length; index += 1) {
      const bucket = buckets[index]
      if (timestampMs >= bucket.startMs && timestampMs < bucket.endMs) {
        totals[index] += row.covers
        break
      }
    }
  }

  return buckets.map((bucket, index) => ({
    label: bucket.label,
    covers: totals[index]
  }))
}

export type TableBookingReportsSnapshot = {
  generated_at: string
  selected_window: {
    key: TableBookingReportsWindow
    label: string
    days: number
    since_iso: string
  }
  lookback_days: {
    thirty: number
    ninety: number
    year: number
  }
  new_vs_returning: {
    active_guests_last_30: number
    new_guests_last_30: number
    returning_guests_last_30: number
    active_guests_selected_window: number
    new_guests_selected_window: number
    returning_guests_selected_window: number
  }
  bookings_by_type: {
    all_time: {
      event: number
      table: number
      private: number
      total: number
    }
    last_30_days: {
      event: number
      table: number
      private: number
      total: number
    }
    selected_window: {
      event: number
      table: number
      private: number
      total: number
    }
  }
  event_conversion_and_waitlist: {
    bookings_created: number
    bookings_confirmed: number
    bookings_cancelled: number
    waitlist_joined: number
    waitlist_offers_sent: number
    waitlist_offers_accepted: number
    waitlist_offers_expired: number
    waitlist_acceptance_rate_percent: number
  }
  charge_request_outcomes: {
    total_requests: number
    approved: number
    waived: number
    pending: number
    succeeded: number
    failed: number
    total_amount_gbp: number
    succeeded_amount_gbp: number
  }
  top_engaged_guests: Array<{
    customer_id: string
    name: string
    mobile: string | null
    total_score: number
    last_booking_date: string | null
    bookings_last_30: number
    bookings_last_90: number
    bookings_last_365: number
    booking_breakdown: Record<string, number>
  }>
  event_type_interest_segments: Array<{
    event_type: string
    guest_count: number
  }>
  review_sms_vs_clicks: {
    event: {
      sent: number
      clicked: number
      click_rate_percent: number
    }
    table: {
      sent: number
      clicked: number
      click_rate_percent: number
    }
    total: {
      sent: number
      clicked: number
      click_rate_percent: number
    }
  }
  covers_trend: {
    granularity: 'hour' | 'day' | 'week' | 'month'
    buckets: Array<{
      label: string
      covers: number
    }>
    total_covers: number
  }
}

export async function loadTableBookingReportsSnapshot(input: {
  window?: string | null
} = {}): Promise<TableBookingReportsSnapshot> {
  const supabase = createAdminClient()
  const now = new Date()
  const selectedWindowKey = resolveTableBookingReportsWindow(input.window)
  const selectedWindowDays = REPORT_WINDOW_DAYS[selectedWindowKey]
  const selectedWindowSinceMs = now.getTime() - selectedWindowDays * ONE_DAY_MS
  const sinceSelectedWindow = new Date(selectedWindowSinceMs).toISOString()
  const coverTrendBuckets = buildCoverTrendBuckets(selectedWindowKey, now)
  const coverTrendSinceIso =
    coverTrendBuckets.length > 0
      ? new Date(coverTrendBuckets[0].startMs).toISOString()
      : sinceSelectedWindow
  const since30 = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString()
  const eventBookingSourceFilter = buildSourceOrFilter('booking_source', EVENT_BOOKING_ALLOWED_SOURCES)
  const tableBookingSourceFilter = buildSourceOrFilter('source', TABLE_BOOKING_ALLOWED_SOURCES)
  const privateBookingSourceFilter = buildSourceOrFilter('source', PRIVATE_BOOKING_ALLOWED_SOURCES)

  const [
    eventAllCountResult,
    tableAllCountResult,
    privateAllCountResult,
    eventSelectedCountResult,
    tableSelectedCountResult,
    privateSelectedCountResult,
    event30CountResult,
    table30CountResult,
    private30CountResult,
    eventStatusRowsResult,
    waitlistEntriesRowsResult,
    waitlistOffersRowsResult,
    chargeRequestsRowsResult,
    eventReviewSentCountResult,
    eventReviewClickedCountResult,
    tableReviewSentCountResult,
    tableReviewClickedCountResult,
    topEngagedResult,
    eventInterestBookingsResult,
    eventInterestWaitlistResult,
    eventCustomerActivityResult,
    tableCustomerActivityResult,
    privateCustomerActivityResult,
    nonProductionCustomersResult,
    eventCoverRowsResult,
    tableCoverRowsResult,
    privateCoverRowsResult
  ] = await Promise.all([
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .or(eventBookingSourceFilter),
    supabase
      .from('table_bookings')
      .select('id', { count: 'exact', head: true })
      .or(tableBookingSourceFilter),
    supabase
      .from('private_bookings')
      .select('id', { count: 'exact', head: true })
      .or(privateBookingSourceFilter),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceSelectedWindow)
      .or(eventBookingSourceFilter),
    supabase
      .from('table_bookings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceSelectedWindow)
      .or(tableBookingSourceFilter),
    supabase
      .from('private_bookings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceSelectedWindow)
      .or(privateBookingSourceFilter),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since30)
      .or(eventBookingSourceFilter),
    supabase
      .from('table_bookings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since30)
      .or(tableBookingSourceFilter),
    supabase
      .from('private_bookings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since30)
      .or(privateBookingSourceFilter),
    supabase
      .from('bookings')
      .select('id, status, booking_source')
      .or(eventBookingSourceFilter),
    supabase.from('waitlist_entries').select('id, status'),
    supabase.from('waitlist_offers').select('id, status'),
    supabase.from('charge_requests').select('amount, manager_decision, charge_status'),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .not('review_sms_sent_at', 'is', null)
      .or(eventBookingSourceFilter),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .not('review_clicked_at', 'is', null)
      .or(eventBookingSourceFilter),
    supabase
      .from('table_bookings')
      .select('id', { count: 'exact', head: true })
      .not('review_sms_sent_at', 'is', null)
      .or(tableBookingSourceFilter),
    supabase
      .from('table_bookings')
      .select('id', { count: 'exact', head: true })
      .not('review_clicked_at', 'is', null)
      .or(tableBookingSourceFilter),
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
      .order('total_score', { ascending: false })
      .limit(10),
    supabase
      .from('bookings')
      .select('customer_id, event:events(event_type)')
      .not('customer_id', 'is', null)
      .not('event_id', 'is', null)
      .or(eventBookingSourceFilter),
    supabase
      .from('waitlist_entries')
      .select('customer_id, event:events(event_type)')
      .not('customer_id', 'is', null)
      .not('event_id', 'is', null),
    supabase
      .from('bookings')
      .select('customer_id, created_at')
      .not('customer_id', 'is', null)
      .or(eventBookingSourceFilter),
    supabase
      .from('table_bookings')
      .select('customer_id, created_at')
      .not('customer_id', 'is', null)
      .or(tableBookingSourceFilter),
    supabase
      .from('private_bookings')
      .select('customer_id, created_at')
      .not('customer_id', 'is', null)
      .or(privateBookingSourceFilter),
    supabase
      .from('customers')
      .select('id')
      .or(NON_PRODUCTION_CUSTOMER_FILTER),
    supabase
      .from('bookings')
      .select('customer_id, created_at, seats, booking_source')
      .gte('created_at', coverTrendSinceIso)
      .or(eventBookingSourceFilter),
    supabase
      .from('table_bookings')
      .select('customer_id, created_at, party_size, source')
      .gte('created_at', coverTrendSinceIso)
      .or(tableBookingSourceFilter),
    supabase
      .from('private_bookings')
      .select('customer_id, created_at, guest_count, source')
      .gte('created_at', coverTrendSinceIso)
      .or(privateBookingSourceFilter)
  ])

  const errors: string[] = []
  const allResults = [
    eventAllCountResult,
    tableAllCountResult,
    privateAllCountResult,
    eventSelectedCountResult,
    tableSelectedCountResult,
    privateSelectedCountResult,
    event30CountResult,
    table30CountResult,
    private30CountResult,
    eventStatusRowsResult,
    waitlistEntriesRowsResult,
    waitlistOffersRowsResult,
    chargeRequestsRowsResult,
    eventReviewSentCountResult,
    eventReviewClickedCountResult,
    tableReviewSentCountResult,
    tableReviewClickedCountResult,
    topEngagedResult,
    eventInterestBookingsResult,
    eventInterestWaitlistResult,
    eventCustomerActivityResult,
    tableCustomerActivityResult,
    privateCustomerActivityResult,
    nonProductionCustomersResult,
    eventCoverRowsResult,
    tableCoverRowsResult,
    privateCoverRowsResult
  ]

  for (const result of allResults) {
    if (result.error) {
      errors.push(result.error.message)
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to load table booking reports: ${errors.join('; ')}`)
  }

  const eventAllCount = eventAllCountResult.count || 0
  const tableAllCount = tableAllCountResult.count || 0
  const privateAllCount = privateAllCountResult.count || 0
  const eventSelectedCount = eventSelectedCountResult.count || 0
  const tableSelectedCount = tableSelectedCountResult.count || 0
  const privateSelectedCount = privateSelectedCountResult.count || 0
  const event30Count = event30CountResult.count || 0
  const table30Count = table30CountResult.count || 0
  const private30Count = private30CountResult.count || 0

  const nonProductionCustomers = (nonProductionCustomersResult.data || []) as NonProductionCustomerRow[]
  const excludedCustomerIds = new Set(nonProductionCustomers.map((row) => row.id))

  const eventStatusRows = (eventStatusRowsResult.data || []) as Array<{
    status: string | null
    booking_source: string | null
  }>
  const productionEventStatusRows = eventStatusRows.filter((row) =>
    isAllowedSource(row.booking_source, EVENT_BOOKING_ALLOWED_SOURCES)
  )
  const eventBookingsCreated = productionEventStatusRows.length
  const eventBookingsConfirmed = productionEventStatusRows.filter((row) => row.status === 'confirmed').length
  const eventBookingsCancelled = productionEventStatusRows.filter((row) => row.status === 'cancelled').length

  const waitlistEntriesRows = (waitlistEntriesRowsResult.data || []) as Array<{ status: string | null }>
  const waitlistOffersRows = (waitlistOffersRowsResult.data || []) as Array<{ status: string | null }>

  const waitlistJoined = waitlistEntriesRows.length
  const waitlistOffersSent = waitlistOffersRows.length
  const waitlistOffersAccepted = waitlistOffersRows.filter((row) => row.status === 'accepted').length
  const waitlistOffersExpired = waitlistOffersRows.filter((row) => row.status === 'expired').length

  const chargeRows =
    (chargeRequestsRowsResult.data || []) as Array<{
      amount: number | string | null
      manager_decision: string | null
      charge_status: string | null
    }>
  const chargeApproved = chargeRows.filter((row) => row.manager_decision === 'approved').length
  const chargeWaived = chargeRows.filter((row) => row.manager_decision === 'waived' || row.charge_status === 'waived').length
  const chargePending = chargeRows.filter((row) => row.charge_status === 'pending').length
  const chargeSucceeded = chargeRows.filter((row) => row.charge_status === 'succeeded').length
  const chargeFailed = chargeRows.filter((row) => row.charge_status === 'failed').length
  const chargeTotalAmount = chargeRows.reduce((sum, row) => sum + asNumber(row.amount), 0)
  const chargeSucceededAmount = chargeRows
    .filter((row) => row.charge_status === 'succeeded')
    .reduce((sum, row) => sum + asNumber(row.amount), 0)

  const eventReviewSent = eventReviewSentCountResult.count || 0
  const eventReviewClicked = eventReviewClickedCountResult.count || 0
  const tableReviewSent = tableReviewSentCountResult.count || 0
  const tableReviewClicked = tableReviewClickedCountResult.count || 0

  const topEngagedRows = (topEngagedResult.data || []) as EngagementRow[]
  const topEngagedGuests: TableBookingReportsSnapshot['top_engaged_guests'] = []

  for (const row of topEngagedRows) {
    if (excludedCustomerIds.has(row.customer_id)) {
      continue
    }

    const customer = resolveCustomerRelation(row.customer)
    if (isNonProductionCustomerName(customer?.first_name, customer?.last_name)) {
      continue
    }

    const firstName = customer?.first_name?.trim() || ''
    const lastName = customer?.last_name?.trim() || ''
    const name = `${firstName} ${lastName}`.trim() || 'Unknown guest'

    topEngagedGuests.push({
      customer_id: row.customer_id,
      name,
      mobile: customer?.mobile_e164 || customer?.mobile_number || null,
      total_score: asNumber(row.total_score),
      last_booking_date: row.last_booking_date,
      bookings_last_30: asNumber(row.bookings_last_30),
      bookings_last_90: asNumber(row.bookings_last_90),
      bookings_last_365: asNumber(row.bookings_last_365),
      booking_breakdown: (row.booking_breakdown || {}) as Record<string, number>
    })
  }

  const interestMap = new Map<string, Set<string>>()
  const bookingInterestRows = (eventInterestBookingsResult.data || []) as Array<{
    customer_id: string | null
    event?: { event_type?: string | null } | { event_type?: string | null }[] | null
  }>
  const waitlistInterestRows = (eventInterestWaitlistResult.data || []) as Array<{
    customer_id: string | null
    event?: { event_type?: string | null } | { event_type?: string | null }[] | null
  }>

  const appendInterest = (
    rows: Array<{
      customer_id: string | null
      event?: { event_type?: string | null } | { event_type?: string | null }[] | null
    }>
  ) => {
    for (const row of rows) {
      if (!row.customer_id) continue
      if (excludedCustomerIds.has(row.customer_id)) continue
      const event = Array.isArray(row.event) ? row.event[0] : row.event
      const eventType = normalizeEventType(event?.event_type)

      const set = interestMap.get(eventType) || new Set<string>()
      set.add(row.customer_id)
      interestMap.set(eventType, set)
    }
  }

  appendInterest(bookingInterestRows)
  appendInterest(waitlistInterestRows)

  const eventTypeInterestSegments = Array.from(interestMap.entries())
    .map(([event_type, customerSet]) => ({
      event_type,
      guest_count: customerSet.size
    }))
    .sort((a, b) => b.guest_count - a.guest_count)

  const customerActivityRecords = [
    ...((eventCustomerActivityResult.data || []) as TimestampedCustomerRecord[]),
    ...((tableCustomerActivityResult.data || []) as TimestampedCustomerRecord[]),
    ...((privateCustomerActivityResult.data || []) as TimestampedCustomerRecord[])
  ]

  const firstBookingByCustomer = new Map<string, number>()
  const activeLast30Customers = new Set<string>()
  const activeSelectedWindowCustomers = new Set<string>()

  for (const record of customerActivityRecords) {
    if (!record.customer_id || !record.created_at) continue
    if (excludedCustomerIds.has(record.customer_id)) continue
    const timestamp = Date.parse(record.created_at)
    if (!Number.isFinite(timestamp)) continue

    const currentFirst = firstBookingByCustomer.get(record.customer_id)
    if (currentFirst === undefined || timestamp < currentFirst) {
      firstBookingByCustomer.set(record.customer_id, timestamp)
    }

    if (timestamp >= now.getTime() - THIRTY_DAYS_MS) {
      activeLast30Customers.add(record.customer_id)
    }

    if (timestamp >= selectedWindowSinceMs) {
      activeSelectedWindowCustomers.add(record.customer_id)
    }
  }

  const splitGuests = (activeCustomers: Set<string>, sinceMs: number) => {
    let newGuests = 0
    let returningGuests = 0

    for (const customerId of activeCustomers) {
      const firstBookingAt = firstBookingByCustomer.get(customerId)
      if (!firstBookingAt) continue

      if (firstBookingAt >= sinceMs) {
        newGuests += 1
      } else {
        returningGuests += 1
      }
    }

    return {
      newGuests,
      returningGuests
    }
  }

  const last30GuestSplit = splitGuests(activeLast30Customers, now.getTime() - THIRTY_DAYS_MS)
  const selectedWindowGuestSplit =
    selectedWindowDays === 30
      ? last30GuestSplit
      : splitGuests(activeSelectedWindowCustomers, selectedWindowSinceMs)

  const selectedWindowLabel = REPORT_WINDOW_LABELS[selectedWindowKey]
  const eventCoverRows = (eventCoverRowsResult.data || []) as EventCoverRow[]
  const tableCoverRows = (tableCoverRowsResult.data || []) as TableCoverRow[]
  const privateCoverRows = (privateCoverRowsResult.data || []) as PrivateCoverRow[]

  const normalizedCoverRows = [
    ...eventCoverRows
      .filter((row) => isAllowedSource(row.booking_source, EVENT_BOOKING_ALLOWED_SOURCES))
      .map((row) => ({
        customer_id: row.customer_id,
        created_at: row.created_at,
        covers: Math.max(0, Math.round(asNumber(row.seats)))
      })),
    ...tableCoverRows
      .filter((row) => isAllowedSource(row.source, TABLE_BOOKING_ALLOWED_SOURCES))
      .map((row) => ({
        customer_id: row.customer_id,
        created_at: row.created_at,
        covers: Math.max(0, Math.round(asNumber(row.party_size)))
      })),
    ...privateCoverRows
      .filter((row) => isAllowedSource(row.source, PRIVATE_BOOKING_ALLOWED_SOURCES))
      .map((row) => ({
        customer_id: row.customer_id,
        created_at: row.created_at,
        covers: Math.max(0, Math.round(asNumber(row.guest_count)))
      }))
  ]

  const coverTrend = aggregateCoverTrend(
    coverTrendBuckets,
    normalizedCoverRows,
    excludedCustomerIds
  )
  const totalCoversInTrend = coverTrend.reduce((sum, bucket) => sum + bucket.covers, 0)

  return {
    generated_at: now.toISOString(),
    selected_window: {
      key: selectedWindowKey,
      label: selectedWindowLabel,
      days: selectedWindowDays,
      since_iso: sinceSelectedWindow
    },
    lookback_days: {
      thirty: 30,
      ninety: 90,
      year: 365
    },
    new_vs_returning: {
      active_guests_last_30: activeLast30Customers.size,
      new_guests_last_30: last30GuestSplit.newGuests,
      returning_guests_last_30: last30GuestSplit.returningGuests,
      active_guests_selected_window: activeSelectedWindowCustomers.size,
      new_guests_selected_window: selectedWindowGuestSplit.newGuests,
      returning_guests_selected_window: selectedWindowGuestSplit.returningGuests
    },
    bookings_by_type: {
      all_time: {
        event: eventAllCount,
        table: tableAllCount,
        private: privateAllCount,
        total: eventAllCount + tableAllCount + privateAllCount
      },
      last_30_days: {
        event: event30Count,
        table: table30Count,
        private: private30Count,
        total: event30Count + table30Count + private30Count
      },
      selected_window: {
        event: eventSelectedCount,
        table: tableSelectedCount,
        private: privateSelectedCount,
        total: eventSelectedCount + tableSelectedCount + privateSelectedCount
      }
    },
    event_conversion_and_waitlist: {
      bookings_created: eventBookingsCreated,
      bookings_confirmed: eventBookingsConfirmed,
      bookings_cancelled: eventBookingsCancelled,
      waitlist_joined: waitlistJoined,
      waitlist_offers_sent: waitlistOffersSent,
      waitlist_offers_accepted: waitlistOffersAccepted,
      waitlist_offers_expired: waitlistOffersExpired,
      waitlist_acceptance_rate_percent: toRate(waitlistOffersAccepted, waitlistOffersSent)
    },
    charge_request_outcomes: {
      total_requests: chargeRows.length,
      approved: chargeApproved,
      waived: chargeWaived,
      pending: chargePending,
      succeeded: chargeSucceeded,
      failed: chargeFailed,
      total_amount_gbp: Number(chargeTotalAmount.toFixed(2)),
      succeeded_amount_gbp: Number(chargeSucceededAmount.toFixed(2))
    },
    top_engaged_guests: topEngagedGuests,
    event_type_interest_segments: eventTypeInterestSegments,
    review_sms_vs_clicks: {
      event: {
        sent: eventReviewSent,
        clicked: eventReviewClicked,
        click_rate_percent: toRate(eventReviewClicked, eventReviewSent)
      },
      table: {
        sent: tableReviewSent,
        clicked: tableReviewClicked,
        click_rate_percent: toRate(tableReviewClicked, tableReviewSent)
      },
      total: {
        sent: eventReviewSent + tableReviewSent,
        clicked: eventReviewClicked + tableReviewClicked,
        click_rate_percent: toRate(eventReviewClicked + tableReviewClicked, eventReviewSent + tableReviewSent)
      }
    },
    covers_trend: {
      granularity: mapCoverTrendGranularity(selectedWindowKey),
      buckets: coverTrend,
      total_covers: totalCoversInTrend
    }
  }
}

export function summarizeLookbackCounts(snapshot: TableBookingReportsSnapshot) {
  const now = Date.now()
  return {
    generatedMinutesAgo: Math.max(0, Math.floor((now - Date.parse(snapshot.generated_at)) / (60 * 1000))),
    thirtyDaysMs: THIRTY_DAYS_MS,
    ninetyDaysMs: NINETY_DAYS_MS,
    yearMs: THREE_SIXTY_FIVE_DAYS_MS
  }
}
