import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { getLondonDateIso, requireFohPermission } from '@/lib/foh/api-auth'

type EventCapacityRow = {
  event_id: string
  seats_remaining: number | null
  is_full: boolean
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function toEventStartIso(row: {
  start_datetime: string | null
  date: string | null
  time: string | null
}): string | null {
  if (row.start_datetime) {
    const parsed = Date.parse(row.start_datetime)
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString()
    }
  }

  if (!row.date || !row.time) return null
  const eventTime = row.time.length === 5 ? `${row.time}:00` : row.time
  const zoned = fromZonedTime(`${row.date}T${eventTime}`, 'Europe/London')
  const parsed = zoned.getTime()
  if (!Number.isFinite(parsed)) return null
  return zoned.toISOString()
}

function toEventEndIso(row: {
  date: string | null
  end_time: string | null
  startIso: string | null
  duration_minutes: number | null
}): string | null {
  const startMs = row.startIso ? Date.parse(row.startIso) : Number.NaN
  if (!Number.isFinite(startMs)) {
    return null
  }

  if (row.date && row.end_time) {
    const eventEndTime = row.end_time.length === 5 ? `${row.end_time}:00` : row.end_time
    const zonedEnd = fromZonedTime(`${row.date}T${eventEndTime}`, 'Europe/London')
    let endMs = zonedEnd.getTime()
    if (Number.isFinite(endMs)) {
      while (endMs <= startMs) {
        endMs += 24 * 60 * 60 * 1000
      }
      return new Date(endMs).toISOString()
    }
  }

  const durationMinutes =
    typeof row.duration_minutes === 'number' && row.duration_minutes > 0
      ? row.duration_minutes
      : 180
  return new Date(startMs + durationMinutes * 60 * 1000).toISOString()
}

export async function GET(request: NextRequest) {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const dateParam = request.nextUrl.searchParams.get('date')
  const bookingDate = dateParam && isIsoDate(dateParam) ? dateParam : getLondonDateIso()

  const { data: events, error } = await (auth.supabase.from('events') as any)
    .select(
      'id, name, date, time, end_time, start_datetime, duration_minutes, payment_mode, price_per_seat, price, capacity, booking_open, event_status, booking_mode'
    )
    .eq('date', bookingDate)
    .or('booking_open.is.null,booking_open.eq.true')
    .not('event_status', 'in', '(cancelled,draft)')
    .order('time', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true, nullsFirst: false })
    .limit(120)

  if (error) {
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }

  const rows = Array.isArray(events) ? events : []
  const eventIds = rows.map((row) => row.id).filter(Boolean)

  const capacityByEventId = new Map<string, EventCapacityRow>()
  if (eventIds.length > 0) {
    const { data: capacityRows, error: capacityError } = await auth.supabase.rpc(
      'get_event_capacity_snapshot_v05',
      { p_event_ids: eventIds }
    )

    if (!capacityError && Array.isArray(capacityRows)) {
      for (const row of capacityRows as EventCapacityRow[]) {
        capacityByEventId.set(row.event_id, row)
      }
    }
  }

  const payload = rows.map((row) => {
    const capacityRow = capacityByEventId.get(row.id)
    const seatsRemaining =
      capacityRow?.seats_remaining ??
      (typeof row.capacity === 'number' ? row.capacity : null)
    const isFull =
      capacityRow?.is_full ??
      (typeof seatsRemaining === 'number' ? seatsRemaining <= 0 : false)
    const paymentMode = row.payment_mode || ((Number(row.price || 0) > 0) ? 'cash_only' : 'free')
    const eventStartIso = toEventStartIso({
      start_datetime: row.start_datetime || null,
      date: row.date || null,
      time: row.time || null
    })
    const eventEndIso = toEventEndIso({
      date: row.date || null,
      end_time: row.end_time || null,
      startIso: eventStartIso,
      duration_minutes: typeof row.duration_minutes === 'number' ? row.duration_minutes : null
    })

    return {
      id: row.id,
      name: row.name || 'Untitled event',
      date: row.date || bookingDate,
      time: row.time || null,
      start_datetime: eventStartIso,
      end_datetime: eventEndIso,
      payment_mode: paymentMode,
      booking_mode: ['table', 'general', 'mixed'].includes(String(row.booking_mode))
        ? row.booking_mode
        : 'table',
      price_per_seat:
        typeof row.price_per_seat === 'number'
          ? row.price_per_seat
          : typeof row.price === 'number'
            ? row.price
            : null,
      capacity: typeof row.capacity === 'number' ? row.capacity : null,
      seats_remaining: seatsRemaining,
      is_full: isFull
    }
  })

  return NextResponse.json({
    success: true,
    data: payload
  })
}
