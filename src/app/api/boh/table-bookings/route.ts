import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { getLondonDateIso, requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'

type BohViewMode = 'day' | 'week' | 'month'

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeViewMode(value: string | null): BohViewMode {
  if (value === 'week' || value === 'month') {
    return value
  }
  return 'day'
}

function parseIsoDateMidday(value: string): Date | null {
  if (!isIsoDate(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) ? date : null
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function computeRange(dateIso: string, view: BohViewMode): {
  focusDate: string
  startDate: string
  endDate: string
} {
  const parsed = parseIsoDateMidday(dateIso) ?? parseIsoDateMidday(getLondonDateIso())

  if (!parsed) {
    const fallback = getLondonDateIso()
    return { focusDate: fallback, startDate: fallback, endDate: fallback }
  }

  const focusDate = toIsoDate(parsed)

  if (view === 'day') {
    return { focusDate, startDate: focusDate, endDate: focusDate }
  }

  if (view === 'week') {
    const start = new Date(parsed)
    const dayOffsetFromMonday = (start.getUTCDay() + 6) % 7
    start.setUTCDate(start.getUTCDate() - dayOffsetFromMonday)

    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 6)

    return {
      focusDate,
      startDate: toIsoDate(start),
      endDate: toIsoDate(end)
    }
  }

  const start = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1, 12, 0, 0))
  const end = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0, 12, 0, 0))

  return {
    focusDate,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end)
  }
}

function normalizeCustomer(customer: any): {
  id: string | null
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  sms_status: string | null
} | null {
  if (!customer) return null

  const source = Array.isArray(customer) && customer.length > 0 ? customer[0] : customer
  if (!source || typeof source !== 'object') return null

  return {
    id: typeof source.id === 'string' ? source.id : null,
    first_name: typeof source.first_name === 'string' ? source.first_name : null,
    last_name: typeof source.last_name === 'string' ? source.last_name : null,
    mobile_number: typeof source.mobile_number === 'string' ? source.mobile_number : null,
    sms_status: typeof source.sms_status === 'string' ? source.sms_status : null
  }
}

function buildGuestName(customer: ReturnType<typeof normalizeCustomer>): string | null {
  if (!customer) return null

  const firstName = customer.first_name?.trim() || ''
  const lastName = customer.last_name?.trim() || ''
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

  return fullName || null
}

function normalizeClock(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 5)
}

function deriveStartIso(booking: any): string | null {
  if (typeof booking.start_datetime === 'string' && booking.start_datetime) {
    return booking.start_datetime
  }

  if (!isIsoDate(String(booking.booking_date || ''))) {
    return null
  }

  const clock = normalizeClock(booking.booking_time)
  if (!clock) return null

  try {
    return fromZonedTime(`${booking.booking_date}T${clock}:00`, 'Europe/London').toISOString()
  } catch {
    return null
  }
}

function deriveEndIso(booking: any, startIso: string | null): string | null {
  if (typeof booking.end_datetime === 'string' && booking.end_datetime) {
    return booking.end_datetime
  }

  if (!startIso) return null

  const startMs = Date.parse(startIso)
  if (!Number.isFinite(startMs)) return null

  const durationMinutes = Math.max(
    30,
    Number(booking.duration_minutes || (booking.booking_type === 'sunday_lunch' ? 120 : 90))
  )

  return new Date(startMs + durationMinutes * 60 * 1000).toISOString()
}

function deriveVisualStatus(booking: {
  status: string | null
  seated_at?: string | null
  left_at?: string | null
  no_show_at?: string | null
}): string {
  if (booking.status === 'no_show' || booking.no_show_at) return 'no_show'
  if (booking.left_at) return 'left'
  if (booking.seated_at) return 'seated'
  return booking.status || 'unknown'
}

function createSearchBlob(input: {
  booking_reference: string | null
  guest_name: string | null
  event_name: string | null
  notes: string | null
  booking_date: string
  booking_time: string
  status: string | null
  visual_status: string
  customer_mobile: string | null
  table_names: string[]
}): string {
  return [
    input.booking_reference,
    input.guest_name,
    input.event_name,
    input.notes,
    input.booking_date,
    input.booking_time,
    input.status,
    input.visual_status,
    input.customer_mobile,
    input.table_names.join(' ')
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function isSchemaCompatibilityError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message || '').toLowerCase()
  return (
    message.includes('does not exist')
    || message.includes('unknown column')
    || message.includes('undefined column')
    || message.includes('undefined table')
  )
}

async function loadBookingsRows(
  supabase: any,
  input: { startDate: string; endDate: string }
): Promise<{ data: any[]; error: unknown | null }> {
  const attempts = [
    'id, booking_reference, booking_date, booking_time, party_size, committed_party_size, booking_type, booking_purpose, status, special_requirements, seated_at, left_at, no_show_at, cancelled_at, cancelled_by, start_datetime, end_datetime, duration_minutes, hold_expires_at, created_at, updated_at, customer_id, event_id, customer:customers!table_bookings_customer_id_fkey(id,first_name,last_name,mobile_number,sms_status)',
    'id, booking_reference, booking_date, booking_time, party_size, booking_type, status, special_requirements, seated_at, left_at, no_show_at, cancelled_at, start_datetime, end_datetime, duration_minutes, created_at, updated_at, customer_id, event_id, customer:customers!table_bookings_customer_id_fkey(id,first_name,last_name,mobile_number,sms_status)',
    'id, booking_reference, booking_date, booking_time, party_size, booking_type, status, special_requirements, duration_minutes, no_show_at, cancelled_at, created_at, updated_at, customer_id, customer:customers!table_bookings_customer_id_fkey(id,first_name,last_name,mobile_number,sms_status)',
    'id, booking_reference, booking_date, booking_time, party_size, booking_type, status, special_requirements, duration_minutes, no_show_at, cancelled_at, created_at, updated_at, customer_id, customer:customers!table_bookings_customer_id_fkey(id,first_name,last_name,mobile_number)'
  ]

  let lastError: unknown | null = null

  for (const select of attempts) {
    const result = await (supabase.from('table_bookings') as any)
      .select(select)
      .gte('booking_date', input.startDate)
      .lte('booking_date', input.endDate)
      .order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true })

    if (!result.error) {
      return { data: (result.data || []) as any[], error: null }
    }

    lastError = result.error

    if (!isSchemaCompatibilityError(result.error)) {
      break
    }
  }

  return { data: [], error: lastError }
}

async function loadTablesRows(
  supabase: any
): Promise<{ data: any[]; error: unknown | null }> {
  const attempts = [
    'id, name, table_number, capacity, area, area_id, is_bookable',
    'id, name, table_number, capacity, area, is_bookable',
    'id, table_number, capacity, area'
  ]

  let lastError: unknown | null = null

  for (const select of attempts) {
    const result = await (supabase.from('tables') as any)
      .select(select)
      .order('table_number', { ascending: true, nullsFirst: false })

    if (!result.error) {
      return { data: (result.data || []) as any[], error: null }
    }

    lastError = result.error

    if (!isSchemaCompatibilityError(result.error)) {
      break
    }
  }

  return { data: [], error: lastError }
}

export async function GET(request: NextRequest) {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const view = normalizeViewMode(request.nextUrl.searchParams.get('view'))
  const dateParam = request.nextUrl.searchParams.get('date')
  const statusFilterRaw = request.nextUrl.searchParams.get('status')
  const searchQuery = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() || ''

  const requestedDate = dateParam && isIsoDate(dateParam) ? dateParam : getLondonDateIso()
  const range = computeRange(requestedDate, view)

  const [bookingsLoad, tablesLoad, tableAreasResult] = await Promise.all([
    loadBookingsRows(auth.supabase, {
      startDate: range.startDate,
      endDate: range.endDate
    }),
    loadTablesRows(auth.supabase),
    (auth.supabase.from('table_areas') as any)
      .select('id, name')
      .order('name', { ascending: true })
  ])

  if (bookingsLoad.error) {
    logger.error('[boh/table-bookings] failed to load bookings', {
      error: bookingsLoad.error instanceof Error
        ? bookingsLoad.error
        : new Error(String((bookingsLoad.error as { message?: string } | null)?.message || bookingsLoad.error)),
      metadata: {
        rangeStart: range.startDate,
        rangeEnd: range.endDate
      }
    })
    return NextResponse.json({ error: 'Failed to load table bookings' }, { status: 500 })
  }

  if (tablesLoad.error) {
    logger.error('[boh/table-bookings] failed to load tables', {
      error: tablesLoad.error instanceof Error
        ? tablesLoad.error
        : new Error(String((tablesLoad.error as { message?: string } | null)?.message || tablesLoad.error)),
      metadata: {
        rangeStart: range.startDate,
        rangeEnd: range.endDate
      }
    })
    return NextResponse.json({ error: 'Failed to load tables' }, { status: 500 })
  }

  const bookingRows = bookingsLoad.data

  const bookingIds = bookingRows
    .map((row) => (typeof row.id === 'string' ? row.id : null))
    .filter((value): value is string => Boolean(value))

  const assignmentsByBookingId = new Map<string, any[]>()
  if (bookingIds.length > 0) {
    const { data: assignmentRows, error: assignmentError } = await (auth.supabase.from('booking_table_assignments') as any)
      .select('table_booking_id, table_id, start_datetime, end_datetime')
      .in('table_booking_id', bookingIds)

    if (assignmentError) {
      logger.warn('[boh/table-bookings] assignments unavailable; continuing without assignments', {
        metadata: {
          bookingIdsCount: bookingIds.length,
          error: assignmentError.message
        }
      })
    } else {
      for (const row of (assignmentRows || []) as any[]) {
        const bookingId = row?.table_booking_id
        if (typeof bookingId !== 'string') continue

        const current = assignmentsByBookingId.get(bookingId) || []
        current.push(row)
        assignmentsByBookingId.set(bookingId, current)
      }
    }
  }

  const eventIds = Array.from(
    new Set(
      bookingRows
        .map((row) => (typeof row.event_id === 'string' ? row.event_id : null))
        .filter((value): value is string => Boolean(value))
    )
  )

  const eventNameById = new Map<string, string>()
  if (eventIds.length > 0) {
    const { data: eventRows, error: eventError } = await (auth.supabase.from('events') as any)
      .select('id, name')
      .in('id', eventIds)

    if (!eventError) {
      for (const row of (eventRows || []) as any[]) {
        if (typeof row?.id === 'string' && typeof row?.name === 'string' && row.name.trim().length > 0) {
          eventNameById.set(row.id, row.name.trim())
        }
      }
    }
  }

  const areaNameById = new Map<string, string>()
  if (!tableAreasResult.error) {
    for (const row of (tableAreasResult.data || []) as any[]) {
      if (typeof row?.id === 'string' && typeof row?.name === 'string') {
        areaNameById.set(row.id, row.name)
      }
    }
  }

  const tableRows = tablesLoad.data
  const tableById = new Map<string, {
    id: string
    name: string
    table_number: string | null
    capacity: number | null
    area_id: string | null
    area: string | null
    is_bookable: boolean
  }>()

  const allTables = tableRows.map((row) => {
    const record = {
      id: row.id,
      name: row.name || row.table_number || 'Unnamed table',
      table_number: typeof row.table_number === 'string' ? row.table_number : null,
      capacity: typeof row.capacity === 'number' ? row.capacity : null,
      area_id: typeof row.area_id === 'string' ? row.area_id : null,
      area: typeof row.area_id === 'string'
        ? areaNameById.get(row.area_id) || row.area || null
        : row.area || null,
      is_bookable: row.is_bookable !== false
    }

    if (typeof record.id === 'string') {
      tableById.set(record.id, record)
    }

    return record
  })

  const tableNumberCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  const parsedStatusFilters = statusFilterRaw
    ? new Set(
        statusFilterRaw
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      )
    : null

  const showingCancelledExplicitly = parsedStatusFilters !== null && parsedStatusFilters.has('cancelled')

  const mappedBookings = bookingRows
    .map((row) => {
      const customer = normalizeCustomer(row.customer)
      const guestName = buildGuestName(customer)
      const eventName = typeof row.event_id === 'string' ? eventNameById.get(row.event_id) || null : null
      const assignments = assignmentsByBookingId.get(row.id) || []

      const assignedTables = assignments
        .map((assignment) => {
          const table = tableById.get(assignment.table_id)
          if (!table) return null

          return {
            id: table.id,
            name: table.name,
            table_number: table.table_number,
            capacity: table.capacity,
            area_id: table.area_id,
            area: table.area,
            is_bookable: table.is_bookable,
            start_datetime: assignment.start_datetime || null,
            end_datetime: assignment.end_datetime || null
          }
        })
        .filter((value): value is {
          id: string
          name: string
          table_number: string | null
          capacity: number | null
          area_id: string | null
          area: string | null
          is_bookable: boolean
          start_datetime: string | null
          end_datetime: string | null
        } => Boolean(value))
        .sort((a, b) => {
          const aNumber = a.table_number || ''
          const bNumber = b.table_number || ''
          if (aNumber && bNumber) {
            const byNumber = tableNumberCollator.compare(aNumber, bNumber)
            if (byNumber !== 0) return byNumber
          }

          return tableNumberCollator.compare(a.name || '', b.name || '')
        })

      const startIso = deriveStartIso(row)
      const endIso = deriveEndIso(row, startIso)
      const visualStatus = deriveVisualStatus({
        status: row.status || null,
        seated_at: row.seated_at || null,
        left_at: row.left_at || null,
        no_show_at: row.no_show_at || null
      })

      const tableNames = assignedTables.map((table) => table.name || table.table_number || 'Unknown table')

      return {
        id: row.id,
        booking_reference: row.booking_reference || null,
        booking_date: row.booking_date,
        booking_time: row.booking_time,
        party_size: row.party_size ?? null,
        committed_party_size: row.committed_party_size ?? null,
        booking_type: row.booking_type || null,
        booking_purpose: row.booking_purpose || null,
        status: row.status || null,
        visual_status: visualStatus,
        special_requirements: row.special_requirements || null,
        seated_at: row.seated_at || null,
        left_at: row.left_at || null,
        no_show_at: row.no_show_at || null,
        cancelled_at: row.cancelled_at || null,
        cancelled_by: row.cancelled_by || null,
        hold_expires_at: row.hold_expires_at || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
        customer,
        guest_name: guestName,
        event_id: row.event_id || null,
        event_name: eventName,
        assigned_tables: assignedTables,
        table_names: tableNames,
        assignment_count: assignedTables.length,
        start_datetime: startIso,
        end_datetime: endIso,
        _sort_key: startIso || `${row.booking_date}T${row.booking_time || '00:00'}`,
        _search_blob: createSearchBlob({
          booking_reference: row.booking_reference || null,
          guest_name: guestName,
          event_name: eventName,
          notes: row.special_requirements || null,
          booking_date: row.booking_date,
          booking_time: row.booking_time,
          status: row.status || null,
          visual_status: visualStatus,
          customer_mobile: customer?.mobile_number || null,
          table_names: tableNames
        })
      }
    })
    .filter((booking) => {
      if (parsedStatusFilters && parsedStatusFilters.size > 0) {
        const status = (booking.status || '').toLowerCase()
        const visualStatus = booking.visual_status.toLowerCase()
        if (!parsedStatusFilters.has(status) && !parsedStatusFilters.has(visualStatus)) {
          return false
        }
      } else if (!showingCancelledExplicitly) {
        if ((booking.status || '').toLowerCase() === 'cancelled') {
          return false
        }
      }

      if (searchQuery && !booking._search_blob.includes(searchQuery)) {
        return false
      }

      return true
    })
    .sort((a, b) => a._sort_key.localeCompare(b._sort_key))

  const bookings = mappedBookings.map(({ _sort_key: _ignoredSortKey, _search_blob: _ignoredSearchBlob, ...booking }) => booking)

  return NextResponse.json({
    success: true,
    data: {
      view,
      focus_date: range.focusDate,
      range_start_date: range.startDate,
      range_end_date: range.endDate,
      total: bookings.length,
      tables: allTables,
      bookings
    }
  })
}
