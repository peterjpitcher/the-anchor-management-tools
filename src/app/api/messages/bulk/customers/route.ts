import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logger } from '@/lib/logger'

type SmsOptInFilter = 'all' | 'opted_in' | 'not_opted_out'
type BookingPresenceFilter = 'all' | 'with_bookings' | 'without_bookings'
type EventAttendanceFilter = 'all' | 'attending' | 'not_attending'
type BookingTypeFilter = 'all' | 'bookings_only' | 'reminders_only'
type CategoryAttendanceFilter = 'all' | 'regulars' | 'never_attended'

interface FilterOptions {
  smsOptIn: SmsOptInFilter
  hasBookings: BookingPresenceFilter
  createdAfter: string
  createdBefore: string
  searchTerm: string
  eventId: string
  eventAttendance: EventAttendanceFilter
  bookingType: BookingTypeFilter
  categoryId: string
  categoryAttendance: CategoryAttendanceFilter
}

interface RawCustomerRow {
  id: string
  first_name: string
  last_name: string | null
  mobile_number: string
  sms_opt_in: boolean | null
  created_at: string
  bookings?: Array<{ count?: number }>
  event_bookings?: Array<{
    event_id: string | null
    seats: number | null
    is_reminder_only: boolean | null
  }>
  category_preferences?: Array<{
    category_id: string
    times_attended: number
  }>
}

interface NormalizedCustomer {
  id: string
  first_name: string
  last_name: string | null
  mobile_number: string
  sms_opt_in: boolean | null
  created_at: string
  total_bookings: number
  event_bookings: Array<{
    event_id: string
    seats: number | null
    is_reminder_only: boolean
  }>
  category_preferences: Array<{
    category_id: string
    times_attended: number
  }>
}

interface BulkCustomersResponse {
  customers: NormalizedCustomer[]
  page: number
  pageSize: number
  hasMore: boolean
  totalMatches: number | null
  approximateMatches: number
  truncated: boolean
}

const DEFAULT_FILTERS: FilterOptions = {
  smsOptIn: 'opted_in',
  hasBookings: 'all',
  createdAfter: '',
  createdBefore: '',
  searchTerm: '',
  eventId: '',
  eventAttendance: 'all',
  bookingType: 'all',
  categoryId: '',
  categoryAttendance: 'all',
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 150
const BATCH_SIZE = 200
const MAX_BATCHES = 10 // Prevent scanning the full table in one request

function sanitizeFilters(raw: Partial<FilterOptions> | undefined): FilterOptions {
  return {
    smsOptIn: raw?.smsOptIn ?? DEFAULT_FILTERS.smsOptIn,
    hasBookings: raw?.hasBookings ?? DEFAULT_FILTERS.hasBookings,
    createdAfter: raw?.createdAfter ?? '',
    createdBefore: raw?.createdBefore ?? '',
    searchTerm: raw?.searchTerm ?? '',
    eventId: raw?.eventId ?? '',
    eventAttendance: raw?.eventAttendance ?? DEFAULT_FILTERS.eventAttendance,
    bookingType: raw?.bookingType ?? DEFAULT_FILTERS.bookingType,
    categoryId: raw?.categoryId ?? '',
    categoryAttendance: raw?.categoryAttendance ?? DEFAULT_FILTERS.categoryAttendance,
  }
}

function escapeIlikeTerm(term: string): string {
  return term.replace(/[%_]/g, (match) => `\\${match}`)
}

function endOfDayIso(date: string): string {
  const parsed = new Date(date)
  parsed.setHours(23, 59, 59, 999)
  return parsed.toISOString()
}

function normalizeCustomer(row: RawCustomerRow): NormalizedCustomer {
  const totalBookings = row.bookings?.[0]?.count ?? 0
  const eventBookings =
    row.event_bookings?.map((booking) => ({
      event_id: booking.event_id ?? '',
      seats: booking.seats,
      is_reminder_only:
        booking.is_reminder_only ??
        ((booking.seats ?? 0) === 0),
    })) ?? []

  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    mobile_number: row.mobile_number,
    sms_opt_in: row.sms_opt_in ?? null,
    created_at: row.created_at,
    total_bookings: totalBookings,
    event_bookings: eventBookings,
    category_preferences:
      row.category_preferences?.map((pref) => ({
        category_id: pref.category_id,
        times_attended: pref.times_attended,
      })) ?? [],
  }
}

function customerMatchesFilters(customer: NormalizedCustomer, filters: FilterOptions): boolean {
  if (filters.hasBookings === 'with_bookings' && customer.total_bookings === 0) {
    return false
  }
  if (filters.hasBookings === 'without_bookings' && customer.total_bookings > 0) {
    return false
  }

  if (filters.eventId) {
    const bookingsForEvent = customer.event_bookings.filter(
      (booking) => booking.event_id === filters.eventId,
    )

    if (filters.eventAttendance === 'attending' && bookingsForEvent.length === 0) {
      return false
    }

    if (filters.eventAttendance === 'not_attending' && bookingsForEvent.length > 0) {
      return false
    }

    if (filters.eventAttendance === 'attending') {
      if (filters.bookingType === 'bookings_only') {
        const hasTickets = bookingsForEvent.some((booking) => !booking.is_reminder_only && (booking.seats ?? 0) > 0)
        if (!hasTickets) {
          return false
        }
      }

      if (filters.bookingType === 'reminders_only') {
        const onlyReminders = bookingsForEvent.every((booking) => booking.is_reminder_only || (booking.seats ?? 0) === 0)
        if (!onlyReminders || bookingsForEvent.length === 0) {
          return false
        }
      }
    }
  }

  if (filters.categoryId) {
    const preference = customer.category_preferences.find(
      (pref) => pref.category_id === filters.categoryId,
    )

    if (filters.categoryAttendance === 'regulars') {
      if (!preference || preference.times_attended <= 0) {
        return false
      }
    }

    if (filters.categoryAttendance === 'never_attended') {
      if (preference && preference.times_attended > 0) {
        return false
      }
    }
  }

  return true
}

function applyBaseFilters(
  admin: ReturnType<typeof createAdminClient>,
  filters: FilterOptions,
  includeCount: boolean,
) {
  const selectClause = `
    id,
    first_name,
    last_name,
    mobile_number,
    sms_opt_in,
    created_at,
    bookings(count),
    event_bookings:bookings(event_id, seats, is_reminder_only),
    category_preferences:customer_category_stats(category_id, times_attended)
  `

  const builder = includeCount
    ? admin
        .from('customers')
        .select(selectClause, { count: 'estimated' })
    : admin
        .from('customers')
        .select(selectClause)

  let query = builder
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true })

  if (filters.smsOptIn === 'opted_in') {
    query = query.eq('sms_opt_in', true)
  } else if (filters.smsOptIn === 'not_opted_out') {
    query = query.or('sms_opt_in.eq.true,sms_opt_in.is.null')
  }

  if (filters.createdAfter) {
    query = query.gte('created_at', filters.createdAfter)
  }

  if (filters.createdBefore) {
    query = query.lte('created_at', endOfDayIso(filters.createdBefore))
  }

  const trimmedSearch = filters.searchTerm.trim()
  if (trimmedSearch) {
    const escaped = escapeIlikeTerm(trimmedSearch)
    const pattern = `%${escaped}%`
    query = query.or(
      `first_name.ilike.${pattern},last_name.ilike.${pattern},mobile_number.ilike.${pattern}`,
    )
  }

  return query
}

export async function POST(request: NextRequest) {
  try {
    const canSend = await checkUserPermission('messages', 'send')
    if (!canSend) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
    }

    const filters = sanitizeFilters(body.filters)
    const rawPage = typeof body.page === 'number' ? body.page : 1
    const rawPageSize = typeof body.pageSize === 'number' ? body.pageSize : DEFAULT_PAGE_SIZE

    const page = Math.max(1, rawPage)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawPageSize))
    const offset = (page - 1) * pageSize
    const desiredMatchCount = offset + pageSize

    const matches: NormalizedCustomer[] = []
    let totalMatchesKnown: number | null = null
    let approximateMatches = 0
    let batchIndex = 0
    let reachedEnd = false
    let rowsScanned = 0

    const admin = createAdminClient()

    while (
      !reachedEnd &&
      matches.length < desiredMatchCount &&
      batchIndex < MAX_BATCHES
    ) {
      const start = batchIndex * BATCH_SIZE
      const end = start + BATCH_SIZE - 1

      let query = applyBaseFilters(admin, filters, batchIndex === 0)
      query = query.range(start, end)

      const { data, error, count } = await query

      if (error) {
        logger.error('Failed to load bulk messaging customers', { error, metadata: { batchIndex } })
        return NextResponse.json({ error: 'Failed to load customers' }, { status: 500 })
      }

      if (batchIndex === 0 && typeof count === 'number') {
        approximateMatches = count
      }

      if (!data || data.length === 0) {
        reachedEnd = true
        break
      }

      rowsScanned += data.length

      const normalized = data.map(normalizeCustomer)
      const filtered = normalized.filter((customer) =>
        customerMatchesFilters(customer, filters),
      )

      matches.push(...filtered)

      if (data.length < BATCH_SIZE) {
        reachedEnd = true
      }

      batchIndex += 1
    }

    // If we reached the end of the dataset, we know the exact number of matches
    if (reachedEnd) {
      totalMatchesKnown = matches.length
    }

    // Determine if more matches likely exist beyond what we scanned
    const truncated = !reachedEnd
    const hasMore =
      matches.length > desiredMatchCount || (!reachedEnd && matches.length >= desiredMatchCount)

    const startIndex = Math.min(offset, matches.length)
    const endIndex = Math.min(startIndex + pageSize, matches.length)
    const pageItems = matches.slice(startIndex, endIndex)

    const response: BulkCustomersResponse = {
      customers: pageItems,
      page,
      pageSize,
      hasMore,
      totalMatches: totalMatchesKnown,
      approximateMatches: truncated ? Math.max(matches.length, approximateMatches) : matches.length,
      truncated,
    }

    return NextResponse.json(response)
  } catch (error) {
    logger.error('Unexpected failure fetching bulk messaging customers', { error: error as Error })
    return NextResponse.json({ error: 'Unexpected failure' }, { status: 500 })
  }
}
