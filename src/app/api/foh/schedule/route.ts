import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { getLondonDateIso, requireFohPermission } from '@/lib/foh/api-auth'

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeClock(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 5)
}

function toDayOfWeek(dateIso: string): number {
  const parsed = new Date(`${dateIso}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime())) {
    return 0
  }
  return parsed.getUTCDay()
}

function buildGuestName(customer: any): string | null {
  if (!customer) return null

  const source =
    Array.isArray(customer) && customer.length > 0
      ? customer[0]
      : customer

  const firstName = typeof source?.first_name === 'string' ? source.first_name.trim() : ''
  const lastName = typeof source?.last_name === 'string' ? source.last_name.trim() : ''
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

  return fullName || null
}

function buildPrivateBookingGuestName(privateBooking: any): string {
  const firstName =
    typeof privateBooking?.customer_first_name === 'string'
      ? privateBooking.customer_first_name.trim()
      : ''
  const lastName =
    typeof privateBooking?.customer_last_name === 'string'
      ? privateBooking.customer_last_name.trim()
      : ''
  const explicitName =
    typeof privateBooking?.customer_name === 'string'
      ? privateBooking.customer_name.trim()
      : ''

  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()
  return fullName || explicitName || 'Private booking'
}

function shiftIsoDate(dateIso: string, dayDelta: number): string {
  const parsed = new Date(`${dateIso}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime())) return dateIso
  parsed.setUTCDate(parsed.getUTCDate() + dayDelta)
  return parsed.toISOString().slice(0, 10)
}

function toLondonIso(dateIso: string | null, clock: string | null, fallbackClock: string): string | null {
  if (!dateIso || !isIsoDate(dateIso)) return null
  const normalizedClock = normalizeClock(clock) || fallbackClock
  const zoned = fromZonedTime(`${dateIso}T${normalizedClock}:00`, 'Europe/London')
  const parsedMs = zoned.getTime()
  if (!Number.isFinite(parsedMs)) return null
  return zoned.toISOString()
}

function addMinutesToClock(clock: string, minutesToAdd: number): string {
  const [hoursRaw, minutesRaw] = clock.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return '23:59'
  }

  const total = (hours * 60 + minutes + minutesToAdd + 1440) % 1440
  const nextHours = Math.floor(total / 60)
  const nextMinutes = total % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`
}

function computePrivateBookingWindow(privateBooking: any): { startIso: string; endIso: string } | null {
  const eventDate =
    typeof privateBooking?.event_date === 'string' ? privateBooking.event_date : null
  const setupDate =
    typeof privateBooking?.setup_date === 'string' ? privateBooking.setup_date : null
  const startTime = normalizeClock(privateBooking?.start_time) || '12:00'
  const setupTime = normalizeClock(privateBooking?.setup_time)
  const endTime = normalizeClock(privateBooking?.end_time)

  const startDate = setupDate && isIsoDate(setupDate) ? setupDate : eventDate
  const startIso = toLondonIso(startDate, setupTime || startTime, startTime)
  if (!startIso) return null

  const fallbackEnd = addMinutesToClock(startTime, 240)
  const endIsoRaw = toLondonIso(eventDate, endTime || fallbackEnd, fallbackEnd)
  if (!endIsoRaw) return null

  const startMs = Date.parse(startIso)
  let endMs = Date.parse(endIsoRaw)

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null
  }

  if (endMs <= startMs) {
    endMs += 24 * 60 * 60 * 1000
  }

  const bufferedStartMs = startMs - 30 * 60 * 1000
  const bufferedEndMs = endMs + 30 * 60 * 1000

  return {
    startIso: new Date(bufferedStartMs).toISOString(),
    endIso: new Date(bufferedEndMs).toISOString()
  }
}

type ServiceWindow = {
  start_time: string
  end_time: string
  end_next_day: boolean
  kitchen_start_time: string | null
  kitchen_end_time: string | null
  kitchen_end_next_day: boolean
  kitchen_closed: boolean
  source: 'fallback' | 'business_hours'
}

type PrivateBlockForTable = {
  table_id: string
  block: {
    id: string
    booking_reference: string
    guest_name: string
    booking_time: string
    party_size: null
    booking_type: 'private'
    booking_purpose: 'private_hire'
    status: 'private_block'
    notes: string | null
    seated_at: null
    left_at: null
    no_show_at: null
    assigned_table_ids: string[]
    assignment_count: number
    start_datetime: string
    end_datetime: string
    is_private_block: true
    private_booking_id: string
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const dateParam = request.nextUrl.searchParams.get('date')
  const date = dateParam && isIsoDate(dateParam) ? dateParam : getLondonDateIso()
  const dayOfWeek = toDayOfWeek(date)

  const { supabase } = auth

  const [tablesResult, bookingsResult, businessHoursResult, specialHoursResult, tableAreasResult] = await Promise.all([
    (supabase.from('tables') as any)
      .select('id, table_number, name, capacity, area, area_id, is_bookable')
      .order('table_number', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true, nullsFirst: false }),
    (supabase.from('table_bookings') as any)
      .select(
        'id, booking_reference, booking_date, booking_time, party_size, booking_type, booking_purpose, status, special_requirements, seated_at, left_at, no_show_at, start_datetime, end_datetime, event_id, customer:customers!table_bookings_customer_id_fkey(first_name,last_name)'
      )
      .eq('booking_date', date)
      .order('booking_time', { ascending: true }),
    (supabase.from('business_hours') as any)
      .select('opens, closes, is_closed, kitchen_opens, kitchen_closes, is_kitchen_closed')
      .eq('day_of_week', dayOfWeek)
      .maybeSingle(),
    (supabase.from('special_hours') as any)
      .select('opens, closes, is_closed, kitchen_opens, kitchen_closes, is_kitchen_closed')
      .eq('date', date)
      .maybeSingle(),
    (supabase.from('table_areas') as any)
      .select('id, name')
      .order('name', { ascending: true })
  ])

  if (tablesResult.error) {
    return NextResponse.json({ error: 'Failed to load tables' }, { status: 500 })
  }

  if (bookingsResult.error) {
    return NextResponse.json({ error: 'Failed to load schedule bookings' }, { status: 500 })
  }

  const areaNameById = new Map<string, string>()
  if (!tableAreasResult.error) {
    for (const row of ((tableAreasResult.data || []) as any[])) {
      if (row?.id && row?.name) {
        areaNameById.set(row.id, row.name)
      }
    }
  }

  const fallbackServiceWindow: ServiceWindow = {
    start_time: '09:00',
    end_time: '23:00',
    end_next_day: false,
    kitchen_start_time: null,
    kitchen_end_time: null,
    kitchen_end_next_day: false,
    kitchen_closed: false,
    source: 'fallback'
  }

  let serviceWindow: ServiceWindow = fallbackServiceWindow

  if (!businessHoursResult.error && !specialHoursResult.error) {
    const specialHours = (specialHoursResult.data || null) as any
    const businessHours = (businessHoursResult.data || null) as any
    const isClosed = Boolean(
      specialHours
        ? specialHours.is_closed
        : businessHours?.is_closed
    )
    const isKitchenClosed = Boolean(
      specialHours
        ? specialHours.is_kitchen_closed
        : businessHours?.is_kitchen_closed
    )
    const opens = normalizeClock(specialHours?.opens ?? businessHours?.opens ?? null)
    const closes = normalizeClock(specialHours?.closes ?? businessHours?.closes ?? null)
    const kitchenOpens = normalizeClock(specialHours?.kitchen_opens ?? businessHours?.kitchen_opens ?? null)
    const kitchenCloses = normalizeClock(specialHours?.kitchen_closes ?? businessHours?.kitchen_closes ?? null)

    if (!isClosed && opens && closes) {
      serviceWindow = {
        start_time: opens,
        end_time: closes,
        end_next_day: closes <= opens,
        kitchen_start_time: !isKitchenClosed && kitchenOpens ? kitchenOpens : null,
        kitchen_end_time: !isKitchenClosed && kitchenCloses ? kitchenCloses : null,
        kitchen_end_next_day:
          Boolean(!isKitchenClosed && kitchenOpens && kitchenCloses && kitchenCloses <= kitchenOpens),
        kitchen_closed: isKitchenClosed,
        source: 'business_hours'
      }
    }
  }

  const tableNumberCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
  const tables = ((tablesResult.data || []) as any[])
    .map((table) => {
      const areaName = table.area_id ? areaNameById.get(table.area_id) || null : null
      return {
        id: table.id,
        name: table.name || table.table_number,
        table_number: table.table_number || null,
        capacity: table.capacity,
        area_id: table.area_id || null,
        area: areaName || table.area || null,
        is_bookable: table.is_bookable !== false
      }
    })
    .filter((table) => table.is_bookable)
    .sort((a, b) => {
      const aNumber = a.table_number || ''
      const bNumber = b.table_number || ''

      if (aNumber && bNumber) {
        const byNumber = tableNumberCollator.compare(aNumber, bNumber)
        if (byNumber !== 0) return byNumber
      } else if (aNumber && !bNumber) {
        return -1
      } else if (!aNumber && bNumber) {
        return 1
      }

      return tableNumberCollator.compare(a.name || '', b.name || '')
    })
  const visibleTableIds = new Set(tables.map((table) => table.id))

  const bookings = (bookingsResult.data || []) as any[]
  const eventNameById = new Map<string, string>()
  const eventIds = Array.from(
    new Set(
      bookings
        .map((booking) => (typeof booking.event_id === 'string' ? booking.event_id : null))
        .filter((value): value is string => Boolean(value))
    )
  )

  if (eventIds.length > 0) {
    const { data: eventRows, error: eventRowsError } = await (supabase.from('events') as any)
      .select('id, name')
      .in('id', eventIds)

    if (!eventRowsError) {
      for (const row of (eventRows || []) as any[]) {
        if (typeof row?.id === 'string' && typeof row?.name === 'string' && row.name.trim().length > 0) {
          eventNameById.set(row.id, row.name.trim())
        }
      }
    }
  }

  const bookingIds = bookings.map((booking) => booking.id)

  let assignmentsByBooking = new Map<string, any[]>()
  if (bookingIds.length > 0) {
    const { data: assignmentRows, error: assignmentsError } = await (supabase.from('booking_table_assignments') as any)
      .select('table_booking_id, table_id, start_datetime, end_datetime')
      .in('table_booking_id', bookingIds)

    if (assignmentsError) {
      return NextResponse.json({ error: 'Failed to load table assignments' }, { status: 500 })
    }

    assignmentsByBooking = new Map<string, any[]>()
    for (const row of (assignmentRows || []) as any[]) {
      const current = assignmentsByBooking.get(row.table_booking_id) || []
      current.push(row)
      assignmentsByBooking.set(row.table_booking_id, current)
    }
  }

  const privateBlocksByTableId = new Map<string, PrivateBlockForTable['block'][]>()
  const privateRangeStart = shiftIsoDate(date, -1)
  const privateRangeEnd = shiftIsoDate(date, 1)

  const { data: privateBookingsRows, error: privateBookingsError } = await (supabase.from('private_bookings') as any)
    .select(
      'id, customer_name, customer_first_name, customer_last_name, event_type, status, event_date, start_time, end_time, setup_date, setup_time'
    )
    .in('status', ['draft', 'confirmed'])
    .gte('event_date', privateRangeStart)
    .lte('event_date', privateRangeEnd)

  if (!privateBookingsError && Array.isArray(privateBookingsRows) && privateBookingsRows.length > 0) {
    const privateBookingIds = privateBookingsRows.map((row: any) => row.id).filter(Boolean)

    const [privateBookingItemsResult, spaceAreaLinksResult] = await Promise.all([
      (supabase.from('private_booking_items') as any)
        .select('booking_id, space_id, item_type')
        .eq('item_type', 'space')
        .in('booking_id', privateBookingIds)
        .not('space_id', 'is', null),
      (supabase.from('venue_space_table_areas') as any)
        .select('venue_space_id, table_area_id')
    ])

    if (!privateBookingItemsResult.error && !spaceAreaLinksResult.error) {
      const areaIdsBySpaceId = new Map<string, Set<string>>()
      for (const row of (spaceAreaLinksResult.data || []) as any[]) {
        const venueSpaceId = row?.venue_space_id
        const tableAreaId = row?.table_area_id
        if (!venueSpaceId || !tableAreaId) continue

        const current = areaIdsBySpaceId.get(venueSpaceId) || new Set<string>()
        current.add(tableAreaId)
        areaIdsBySpaceId.set(venueSpaceId, current)
      }

      const spaceIdsByPrivateBookingId = new Map<string, Set<string>>()
      for (const row of (privateBookingItemsResult.data || []) as any[]) {
        const bookingId = row?.booking_id
        const spaceId = row?.space_id
        if (!bookingId || !spaceId) continue

        const current = spaceIdsByPrivateBookingId.get(bookingId) || new Set<string>()
        current.add(spaceId)
        spaceIdsByPrivateBookingId.set(bookingId, current)
      }

      const tableIdsByAreaId = new Map<string, string[]>()
      for (const table of tables) {
        if (!table.area_id) continue
        const current = tableIdsByAreaId.get(table.area_id) || []
        current.push(table.id)
        tableIdsByAreaId.set(table.area_id, current)
      }

      for (const privateBooking of privateBookingsRows as any[]) {
        const bookingWindow = computePrivateBookingWindow(privateBooking)
        if (!bookingWindow) continue

        const bookingSpaceIds = spaceIdsByPrivateBookingId.get(privateBooking.id)
        if (!bookingSpaceIds || bookingSpaceIds.size === 0) continue

        const areaIds = new Set<string>()
        for (const spaceId of bookingSpaceIds) {
          const mappedAreas = areaIdsBySpaceId.get(spaceId)
          if (!mappedAreas) continue
          for (const areaId of mappedAreas) {
            areaIds.add(areaId)
          }
        }

        if (areaIds.size === 0) continue

        const guestName = buildPrivateBookingGuestName(privateBooking)
        const bookingReference = `PB-${String(privateBooking.id).slice(0, 8).toUpperCase()}`
        const noteParts = ['Private booking']
        if (privateBooking.event_type) {
          noteParts.push(String(privateBooking.event_type))
        }

        for (const areaId of areaIds) {
          const tableIds = tableIdsByAreaId.get(areaId) || []
          for (const tableId of tableIds) {
            const block = {
              id: `private-${privateBooking.id}-${tableId}`,
              booking_reference: bookingReference,
              guest_name: guestName,
              booking_time: normalizeClock(privateBooking.start_time) || '00:00',
              party_size: null,
              booking_type: 'private' as const,
              booking_purpose: 'private_hire' as const,
              status: 'private_block' as const,
              notes: noteParts.join(' · '),
              seated_at: null,
              left_at: null,
              no_show_at: null,
              assigned_table_ids: [tableId],
              assignment_count: 1,
              start_datetime: bookingWindow.startIso,
              end_datetime: bookingWindow.endIso,
              is_private_block: true as const,
              private_booking_id: privateBooking.id
            }

            const current = privateBlocksByTableId.get(tableId) || []
            current.push(block)
            privateBlocksByTableId.set(tableId, current)
          }
        }
      }
    }
  }

  const lanes = tables.map((table) => {
    const tableBookings = bookings
      .filter((booking) => {
        const assignments = assignmentsByBooking.get(booking.id) || []
        return assignments.some((row) => row.table_id === table.id)
      })
      .map((booking) => {
        const assignments = assignmentsByBooking.get(booking.id) || []
        const visibleAssignments = assignments.filter((row) => visibleTableIds.has(row.table_id))
        const assignment = visibleAssignments.find((row) => row.table_id === table.id) || null
        const eventName = booking.event_id ? eventNameById.get(booking.event_id) || null : null
        const derivedBookingType = booking.event_id ? 'event' : booking.booking_type
        const derivedBookingPurpose = booking.event_id ? 'event' : booking.booking_purpose
        const combinedNotes =
          booking.event_id && eventName
            ? [booking.special_requirements || null, `Event: ${eventName}`]
                .filter((part) => typeof part === 'string' && part.trim().length > 0)
                .join(' · ')
            : booking.special_requirements || null
        return {
          id: booking.id,
          booking_reference: booking.booking_reference,
          guest_name: buildGuestName(booking.customer),
          booking_time: booking.booking_time,
          party_size: booking.party_size,
          booking_type: derivedBookingType,
          booking_purpose: derivedBookingPurpose,
          status: booking.status,
          notes: combinedNotes || null,
          seated_at: booking.seated_at || null,
          left_at: booking.left_at || null,
          no_show_at: booking.no_show_at || null,
          assigned_table_ids: visibleAssignments.map((row) => row.table_id),
          assignment_count: visibleAssignments.length,
          start_datetime: assignment?.start_datetime || booking.start_datetime || null,
          end_datetime: assignment?.end_datetime || booking.end_datetime || null,
          is_private_block: false
        }
      })

    const privateBlocks = privateBlocksByTableId.get(table.id) || []
    const combinedBookings = [...tableBookings, ...privateBlocks].sort((a, b) =>
      (a.start_datetime || '').localeCompare(b.start_datetime || '')
    )

    return {
      table_id: table.id,
      table_name: table.name,
      table_number: table.table_number,
      capacity: table.capacity,
      area_id: table.area_id,
      area: table.area,
      is_bookable: table.is_bookable,
      bookings: combinedBookings
    }
  })

  const unassignedBookings = bookings
    .filter((booking) => {
      const assignments = assignmentsByBooking.get(booking.id)
      if (!assignments || assignments.length === 0) {
        return true
      }
      const hasVisibleAssignment = assignments.some((row) => visibleTableIds.has(row.table_id))
      return !hasVisibleAssignment
    })
    .map((booking) => ({
      event_name: booking.event_id ? eventNameById.get(booking.event_id) || null : null,
      id: booking.id,
      booking_reference: booking.booking_reference,
      guest_name: buildGuestName(booking.customer),
      booking_time: booking.booking_time,
      party_size: booking.party_size,
      booking_type: booking.event_id ? 'event' : booking.booking_type,
      booking_purpose: booking.event_id ? 'event' : booking.booking_purpose,
      status: booking.status,
      notes:
        booking.event_id && eventNameById.get(booking.event_id)
          ? [booking.special_requirements || null, `Event: ${eventNameById.get(booking.event_id)}`]
              .filter((part: string | null) => typeof part === 'string' && part.trim().length > 0)
              .join(' · ')
          : booking.special_requirements || null,
      seated_at: booking.seated_at || null,
      left_at: booking.left_at || null,
      no_show_at: booking.no_show_at || null,
      start_datetime: booking.start_datetime || null,
      end_datetime: booking.end_datetime || null,
      is_private_block: false
    }))

  return NextResponse.json({
    success: true,
    data: {
      date,
      service_window: serviceWindow,
      lanes,
      unassigned_bookings: unassignedBookings
    }
  })
}
