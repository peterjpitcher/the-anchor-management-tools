import type { SupabaseClient } from '@supabase/supabase-js'
import { parseLondonDateTimeLocal, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { loadParkingBalances } from '@/lib/parking/balance'

/**
 * Parking as the till sees it (owner request, 23 November 2026): which cars are due, which are on
 * site and which are leaving, so the bar can answer "is that car meant to be here?". Read only,
 * and with NO money: the shared FOH login holds no parking permission and must never see a price,
 * a rate, an amount or a payment record. It gets one fact about payment, paid or not paid.
 *
 * One exception, by owner decision D5 (24 November 2026, spec
 * tasks/spec-2026-11-24-parking-change-time-and-settle.md): when a paid booking's dates were changed
 * and the customer still owes extra, the till sees "owes £X" so it is collected with the car. That
 * figure is worked out server side from the payment rows and is the only amount in the response.
 *
 * Otherwise that is enforced here in two places. The column list below is the only thing read from
 * parking_bookings, and it names no money column (calculated_price, override_price and
 * pricing_breakdown are never selected). And each row is rebuilt field by field, so a column added
 * to the select by mistake still would not reach the response. tests/api/fohParkingRoute.test.ts
 * fails on any response key that looks like money.
 */

/** Every column read from parking_bookings. Explicit, never '*'. No money columns. */
export const FOH_PARKING_COLUMNS =
  'id, reference, customer_first_name, customer_last_name, customer_mobile, vehicle_registration, vehicle_make, vehicle_model, vehicle_colour, start_at, end_at, status, payment_status'

/** Bookings that still mean a car: cancelled, expired and completed ones are left out. */
export const FOH_PARKING_LIVE_STATUSES = ['pending_payment', 'confirmed'] as const

/** How far ahead "Coming up" looks. */
export const FOH_PARKING_DAYS_AHEAD = 14

export type FohParkingBooking = {
  reference: string
  guest_name: string
  phone: string | null
  vehicle_registration: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_colour: string | null
  /** ISO instants. The screen shows them on the London clock. */
  arrives_at: string
  leaves_at: string
  /** 'confirmed', or 'pending_payment' for a booking still waiting to be paid. */
  status: string
  /** Whether the booking is paid. */
  paid: boolean
  /**
   * What is still to collect on a paid booking whose dates were changed (D5), as "£30.00", or null.
   * The only figure the till ever gets.
   */
  owes: string | null
}

export type FohParkingView = {
  /** The day being worked (the trading day), as YYYY-MM-DD. */
  today: string
  arriving_today: FohParkingBooking[]
  on_site_now: FohParkingBooking[]
  leaving_today: FohParkingBooking[]
  /** The next 14 days, one entry per day that has an arrival, in date order. */
  coming_up: Array<{ date: string; bookings: FohParkingBooking[] }>
}

type Row = Record<string, unknown>

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

/** Rebuilds a row from the named fields only, so nothing else can ride along. */
function toBooking(row: Row, owing: Map<string, number>): FohParkingBooking | null {
  const reference = text(row.reference)
  const arrivesAt = text(row.start_at)
  const leavesAt = text(row.end_at)
  if (!reference || !arrivesAt || !leavesAt) return null
  if (!Number.isFinite(Date.parse(arrivesAt)) || !Number.isFinite(Date.parse(leavesAt))) return null
  const name = [text(row.customer_first_name), text(row.customer_last_name)].filter(Boolean).join(' ')
  return {
    reference,
    guest_name: name || 'Guest',
    phone: text(row.customer_mobile),
    vehicle_registration: text(row.vehicle_registration) ?? 'Not given',
    vehicle_make: text(row.vehicle_make),
    vehicle_model: text(row.vehicle_model),
    vehicle_colour: text(row.vehicle_colour),
    arrives_at: new Date(arrivesAt).toISOString(),
    leaves_at: new Date(leavesAt).toISOString(),
    status: text(row.status) ?? 'confirmed',
    paid: row.payment_status === 'paid',
    owes: (() => {
      const amount = typeof row.id === 'string' ? owing.get(row.id) : undefined
      return amount && amount > 0 ? `£${amount.toFixed(2)}` : null
    })(),
  }
}

/**
 * Sorts the bookings into the till's four lists. Days are London days: a car due at 00:30 on the
 * 24th arrives on the 24th whatever zone the server runs in.
 */
export function buildFohParkingView(
  rows: Row[],
  todayIso: string,
  now: Date,
  owing: Map<string, number> = new Map()
): FohParkingView {
  const bookings = rows
    .map((row) => toBooking(row, owing))
    .filter((booking): booking is FohParkingBooking => booking !== null)
  const byArrival = (a: FohParkingBooking, b: FohParkingBooking) => a.arrives_at.localeCompare(b.arrives_at)
  const byDeparture = (a: FohParkingBooking, b: FohParkingBooking) => a.leaves_at.localeCompare(b.leaves_at)
  const arrivalDay = (booking: FohParkingBooking) => toLocalIsoDate(new Date(booking.arrives_at))
  const departureDay = (booking: FohParkingBooking) => toLocalIsoDate(new Date(booking.leaves_at))
  const lastDay = shiftIsoDate(todayIso, FOH_PARKING_DAYS_AHEAD) ?? todayIso
  const nowMs = now.getTime()

  const comingUp = new Map<string, FohParkingBooking[]>()
  for (const booking of [...bookings].sort(byArrival)) {
    const day = arrivalDay(booking)
    if (day <= todayIso || day > lastDay) continue
    comingUp.set(day, [...(comingUp.get(day) ?? []), booking])
  }

  return {
    today: todayIso,
    arriving_today: bookings.filter((booking) => arrivalDay(booking) === todayIso).sort(byArrival),
    on_site_now: bookings
      .filter((booking) => Date.parse(booking.arrives_at) <= nowMs && Date.parse(booking.leaves_at) > nowMs)
      .sort(byDeparture),
    leaving_today: bookings.filter((booking) => departureDay(booking) === todayIso).sort(byDeparture),
    coming_up: Array.from(comingUp.entries()).map(([date, dayBookings]) => ({ date, bookings: dayBookings })),
  }
}

/**
 * Reads the live parking bookings that touch today or the next 14 days. `supabase` is the client
 * the FOH permission check hands back; the caller has already checked table_bookings view.
 */
export async function loadFohParkingView(
  supabase: SupabaseClient<any, 'public', any>,
  todayIso: string,
  now: Date = new Date()
): Promise<FohParkingView> {
  const windowStart = parseLondonDateTimeLocal(`${todayIso}T00:00:00`)
  const lastDay = shiftIsoDate(todayIso, FOH_PARKING_DAYS_AHEAD + 1)
  const windowEnd = lastDay ? parseLondonDateTimeLocal(`${lastDay}T00:00:00`) : null
  if (!windowStart || !windowEnd) throw new Error(`Invalid day for the parking view: ${todayIso}`)

  const { data, error } = await supabase
    .from('parking_bookings')
    .select(FOH_PARKING_COLUMNS)
    .in('status', [...FOH_PARKING_LIVE_STATUSES])
    // Anything still on site today, or arriving within the window.
    .gte('end_at', windowStart.toISOString())
    .lt('start_at', windowEnd.toISOString())
    .order('start_at', { ascending: true })
    .limit(500)

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Row[]
  return buildFohParkingView(rows, todayIso, now, await loadOwing(rows))
}

/**
 * The amount still owed on each confirmed, paid booking (D5). Read with the admin client because
 * the FOH login cannot read prices or payments, and only the "to pay" figure leaves here. If it
 * cannot be read the view still loads, without the flags.
 */
async function loadOwing(rows: Row[]): Promise<Map<string, number>> {
  const ids = rows
    .filter((row) => row.status === 'confirmed' && row.payment_status === 'paid' && typeof row.id === 'string')
    .map((row) => row.id as string)
  const owing = new Map<string, number>()
  if (ids.length === 0) return owing
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('parking_bookings')
      .select('id, status, payment_status, calculated_price, override_price')
      .in('id', ids)
    if (error) throw new Error(error.message)
    const balances = await loadParkingBalances(admin, (data ?? []) as Parameters<typeof loadParkingBalances>[1])
    for (const [id, balance] of balances) {
      if (balance.state === 'to_pay') owing.set(id, balance.balance)
    }
  } catch (error) {
    logger.error('FOH parking view could not read what is owed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
  }
  return owing
}
