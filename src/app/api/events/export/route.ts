import { NextRequest, NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEventPaymentMode, resolveEventTicketPriceAmount } from '@/lib/events/pricing'
import { escapeCsvCell } from '@/lib/receipts/export/csv-helpers'

export const runtime = 'nodejs'

type EventRow = {
  id: string
  name: string
  date: string
  time: string | null
  end_time: string | null
  doors_time: string | null
  last_entry_time: string | null
  duration_minutes: number | null
  capacity: number | null
  brief: string | null
  short_description: string | null
  long_description: string | null
  event_status: string | null
  performer_name: string | null
  performer_type: string | null
  price: number | null
  price_per_seat: number | null
  is_free: boolean | null
  payment_mode: string | null
  booking_url: string | null
  category?: { name: string | null } | { name: string | null }[] | null
}

/**
 * Bookings and money for each event (BK-218, customer bookings review of 24 October 2026), so the
 * accountant can use the export for event takings. Seats are counted from real bookings; who came
 * is the check-ins (the door kiosk or the staff 'Who came?' list); online tickets come from the
 * online income view (BK-117), net of refunds; door money is what staff recorded per booking
 * (cash or card, prepaid nights) and the till total kept for a pay-on-arrival night (D13).
 */
type EventMoney = {
  seatsBooked: number
  seatsCame: number
  seatsDidNotCome: number
  onlineNet: number
  onlineRefunded: number
  doorRecorded: number
  doorTillTotal: number | null
  comps: number
}

/** Bookings that held seats for the night, a later no-show included. */
const BOOKED_STATUSES = new Set(['confirmed', 'visited_waiting_for_review', 'review_clicked', 'completed', 'no_show'])
const ID_CHUNK = 100

function emptyMoney(): EventMoney {
  return { seatsBooked: 0, seatsCame: 0, seatsDidNotCome: 0, onlineNet: 0, onlineRefunded: 0, doorRecorded: 0, doorTillTotal: null, comps: 0 }
}

function pounds(value: unknown): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0
}

/** Every row of a query, a page at a time: PostgREST returns at most 1,000 rows per request. */
async function readAll<T>(
  label: string,
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(`${label}: ${error.message}`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < 1000) return rows
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

async function loadEventMoney(
  supabase: ReturnType<typeof createAdminClient>,
  eventIds: string[]
): Promise<Map<string, EventMoney>> {
  const byEvent = new Map<string, EventMoney>(eventIds.map((id) => [id, emptyMoney()]))
  if (eventIds.length === 0) return byEvent

  type BookingRow = { id: string; event_id: string; customer_id: string; seats: number | null; status: string | null; is_reminder_only: boolean | null }
  const bookings: BookingRow[] = []
  const checkIns: Array<{ event_id: string | null; booking_id: string | null; customer_id: string | null }> = []
  const doorTakings: Array<{ event_id: string; till_total: number | string; free_entries: number }> = []
  for (const ids of chunk(eventIds, ID_CHUNK)) {
    const [bookingRows, checkInRows, doorRows] = await Promise.all([
      readAll('bookings', (from, to) =>
        supabase.from('bookings').select('id, event_id, customer_id, seats, status, is_reminder_only').in('event_id', ids).order('id', { ascending: true }).range(from, to)),
      readAll('check-ins', (from, to) =>
        supabase.from('event_check_ins').select('event_id, booking_id, customer_id').in('event_id', ids).order('id', { ascending: true }).range(from, to)),
      readAll('door money', (from, to) =>
        supabase.from('event_door_takings').select('event_id, till_total, free_entries').in('event_id', ids).order('event_id', { ascending: true }).range(from, to)),
    ])
    bookings.push(...(bookingRows as BookingRow[]))
    checkIns.push(...checkInRows)
    doorTakings.push(...(doorRows as typeof doorTakings))
  }

  const cameBookingIds = new Set(checkIns.map((row) => row.booking_id).filter((id): id is string => Boolean(id)))
  const cameCustomerKeys = new Set(
    checkIns.filter((row) => !row.booking_id && row.customer_id && row.event_id).map((row) => `${row.event_id}:${row.customer_id}`)
  )
  const bookingEvent = new Map<string, string>()
  // A comp is recorded once for the whole booking, so it counts that booking's seats.
  const bookingSeats = new Map<string, number>()
  for (const booking of bookings) {
    if (booking.is_reminder_only === true) continue
    bookingEvent.set(booking.id, booking.event_id)
    bookingSeats.set(booking.id, Math.max(0, Number(booking.seats ?? 0)))
    const money = byEvent.get(booking.event_id)
    if (!money || !BOOKED_STATUSES.has(String(booking.status ?? ''))) continue
    const seats = Math.max(0, Number(booking.seats ?? 0))
    money.seatsBooked += seats
    if (cameBookingIds.has(booking.id) || cameCustomerKeys.has(`${booking.event_id}:${booking.customer_id}`)) {
      money.seatsCame += seats
    } else if (booking.status === 'no_show') {
      money.seatsDidNotCome += seats
    }
  }

  for (const row of doorTakings) {
    const money = byEvent.get(row.event_id)
    if (!money) continue
    money.doorTillTotal = pounds(row.till_total)
    money.comps += Math.max(0, Number(row.free_entries ?? 0))
  }

  const bookingIds = [...bookingEvent.keys()]
  for (const ids of chunk(bookingIds, ID_CHUNK)) {
    const [paymentRows, onlineRows] = await Promise.all([
      // Door payments recorded by hand: cash and card count as money taken, comps as free places.
      readAll('door payments', (from, to) =>
        supabase
          .from('payments')
          .select('event_booking_id, amount, status, payment_method')
          .in('event_booking_id', ids)
          .eq('payment_provider', 'manual')
          .eq('charge_type', 'prepaid_event')
          .order('id', { ascending: true })
          .range(from, to)),
      readAll('online tickets', (from, to) =>
        supabase
          .from('online_income_movements')
          .select('source_id, refunded, net')
          .eq('source', 'event_ticket')
          .in('source_id', ids)
          .order('source_id', { ascending: true })
          .range(from, to)),
    ])
    for (const payment of paymentRows) {
      const money = byEvent.get(bookingEvent.get(payment.event_booking_id ?? '') ?? '')
      if (!money || payment.status !== 'succeeded') continue
      if (payment.payment_method === 'comp') money.comps += Math.max(1, bookingSeats.get(payment.event_booking_id ?? '') ?? 1)
      else money.doorRecorded = pounds(money.doorRecorded + pounds(payment.amount))
    }
    for (const row of onlineRows) {
      const money = byEvent.get(bookingEvent.get(row.source_id ?? '') ?? '')
      if (!money) continue
      money.onlineNet = pounds(money.onlineNet + pounds(row.net))
      money.onlineRefunded = pounds(money.onlineRefunded + pounds(row.refunded))
    }
  }

  return byEvent
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 2,
})

function isValidDate(value: string | null): value is string {
  if (!value) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

function sanitizeFilename(value: string, fallback: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback
  return trimmed
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 120) || fallback
}

function formatTime(value: string | null): string {
  if (!value) return ''
  const [hours, minutes] = value.split(':')
  if (!hours || !minutes) return value
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`
}

function formatTimes(event: EventRow): string {
  const parts = [
    ['Doors', event.doors_time],
    ['Start', event.time],
    ['End', event.end_time],
    ['Last entry', event.last_entry_time],
  ]
    .map(([label, value]) => {
      const formatted = formatTime(value as string | null)
      return formatted ? `${label}: ${formatted}` : null
    })
    .filter(Boolean)

  if (event.duration_minutes) {
    parts.push(`Duration: ${event.duration_minutes} mins`)
  }

  return parts.join(' | ')
}

// Price and how paid follow the app's shared pricing rule (BK-218): a priced event marked 'free'
// is cash on arrival, as every booking screen already shows it.
function formatPrice(event: EventRow): string {
  const price = resolveEventTicketPriceAmount(event)
  if (price > 0) return currencyFormatter.format(price)
  return resolveEventPaymentMode(event) === 'free' ? 'Free' : ''
}

function formatPaymentMode(event: EventRow): string {
  switch (resolveEventPaymentMode(event)) {
    case 'free':
      return 'Free'
    case 'cash_only':
      return 'Cash on arrival'
    case 'prepaid':
      return 'Prepaid online'
    default:
      return ''
  }
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function amount(value: number | null): string {
  return value === null ? '' : value.toFixed(2)
}

function buildExportCsv(events: EventRow[], moneyByEvent: Map<string, EventMoney>): string {
  const headers = [
    'Event Name', 'Date', 'Times', 'Host', 'Price', 'How Paid',
    'Seats Booked', 'Seats Came', 'Seats Did Not Come',
    'Online Tickets (net)', 'Online Refunds', 'Door Payments Recorded', 'Door Till Total', 'Comps', 'Total Taken (net)',
    'Brief',
  ]
  const rows = events.map((event) => {
    const money = moneyByEvent.get(event.id) ?? emptyMoney()
    const total = pounds(money.onlineNet + money.doorRecorded + (money.doorTillTotal ?? 0))
    return [
      escapeCsvCell(event.name),
      event.date,
      formatTimes(event),
      escapeCsvCell(event.performer_name ?? ''),
      formatPrice(event),
      formatPaymentMode(event),
      money.seatsBooked,
      money.seatsCame,
      money.seatsDidNotCome,
      amount(money.onlineNet),
      amount(money.onlineRefunded),
      amount(money.doorRecorded),
      amount(money.doorTillTotal),
      money.comps,
      amount(total),
      escapeCsvCell(event.brief ?? ''),
    ]
  })

  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n')
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const startDate = searchParams.get('start_date')
  const endDate = searchParams.get('end_date')
  const eventId = searchParams.get('event_id')

  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return new NextResponse('Start and end dates are required (YYYY-MM-DD).', { status: 400 })
  }

  if (startDate > endDate) {
    return new NextResponse('Start date must be before end date.', { status: 400 })
  }

  const canExport = await checkUserPermission('events', 'export')
  const canManage = await checkUserPermission('events', 'manage')

  if (!canExport && !canManage) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  try {
    const supabase = createAdminClient()

    let query = supabase
      .from('events')
      .select(
        `
        id,
        name,
        date,
        time,
        end_time,
        doors_time,
        last_entry_time,
        duration_minutes,
        capacity,
        brief,
        short_description,
        long_description,
        event_status,
        performer_name,
        performer_type,
        price,
        price_per_seat,
        is_free,
        payment_mode,
        booking_url,
        category:event_categories(name)
      `
      )
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    if (eventId) {
      query = query.eq('id', eventId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Failed to export events:', error)
      return new NextResponse('Failed to export events.', { status: 500 })
    }

    const events = (data ?? []) as EventRow[]

    if (events.length === 0) {
      return new NextResponse('No events found for the selected criteria.', { status: 404 })
    }

    const moneyByEvent = await loadEventMoney(supabase, events.map((event) => event.id))
    const exportCsv = buildExportCsv(events, moneyByEvent)
    const buffer = Buffer.from(`\uFEFF${exportCsv}`, 'utf-8')
    const baseFilename = eventId
      ? sanitizeFilename(`event-${events[0]?.name ?? eventId}`, `event-${eventId}`)
      : `events_${startDate}_to_${endDate}`
    const filename = `${baseFilename}.csv`

    const userInfo = await getCurrentUser()
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'export',
      resource_type: 'events',
      operation_status: 'success',
      additional_info: {
        start_date: startDate,
        end_date: endDate,
        event_id: eventId ?? null,
        total: events.length,
      },
    })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename=\"${filename}\"`,
        'Cache-Control': 'no-store',
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (error) {
    console.error('Events export failed:', error)
    return new NextResponse('Failed to export events.', { status: 500 })
  }
}
