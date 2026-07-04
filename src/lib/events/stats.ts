import { resolveEventPriceAmount } from './pricing'

type EventLike = {
  capacity?: number | null
  seated_capacity?: number | null
  standing_capacity?: number | null
  booking_mode?: string | null
  price?: number | string | null
  price_per_seat?: number | string | null
  online_discount_type?: string | null
  online_discount_value?: number | string | null
  is_free?: boolean | null
  payment_mode?: string | null
}

type BookingLike = {
  seats?: number | null
  status?: string | null
  is_reminder_only?: boolean | null
  /** Payment-hold expiry for pending_payment bookings; unexpired holds count as booked. */
  hold_expires_at?: string | null
  /**
   * The booking's authoritative charge (sum of its booking_items lines), when the
   * caller has it. Falls back to event price × seats when absent.
   */
  charge_total?: number | null
}

type LinkLike = {
  clickCount?: number | null
}

const BOOKED_BOOKING_STATUSES = new Set([
  'confirmed',
  'visited_waiting_for_review',
  'review_clicked',
  'completed',
])

export type EventBookingStats = {
  activeBookings: number
  totalSeats: number
  capacity: number | null
  capacityPct: number | null
  estimatedRevenue: number
  totalLinkClicks: number
}

function hasUnexpiredPaymentHold(booking: BookingLike, now: Date): boolean {
  if (String(booking.status || '').toLowerCase() !== 'pending_payment') return false
  if (!booking.hold_expires_at) return false
  const expires = new Date(booking.hold_expires_at)
  return Number.isFinite(expires.getTime()) && expires.getTime() > now.getTime()
}

function isActiveBooking(booking: BookingLike, now: Date): boolean {
  if (booking.is_reminder_only === true) return false
  if (BOOKED_BOOKING_STATUSES.has(String(booking.status || '').toLowerCase())) return true
  // Unexpired payment holds occupy capacity (matches the booking-creation RPC),
  // so count them towards booked seats too.
  return hasUnexpiredPaymentHold(booking, now)
}

export function resolveEventCapacity(event: EventLike): number | null {
  if (event.booking_mode === 'communal') {
    const seated = typeof event.seated_capacity === 'number' ? event.seated_capacity : 0
    const standing = typeof event.standing_capacity === 'number' ? event.standing_capacity : 0
    const splitTotal = seated + standing
    if (splitTotal > 0) return splitTotal
  }

  return typeof event.capacity === 'number' && event.capacity > 0 ? event.capacity : null
}

export function buildEventBookingStats(
  event: EventLike,
  bookings: BookingLike[],
  links: LinkLike[] = [],
  now: Date = new Date()
): EventBookingStats {
  const activeBookings = bookings.filter((booking) => isActiveBooking(booking, now))
  const totalSeats = activeBookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.seats ?? 0)), 0)
  const capacity = resolveEventCapacity(event)
  const totalLinkClicks = links.reduce((sum, link) => sum + Math.max(0, Number(link.clickCount ?? 0)), 0)

  // Estimated revenue: per-booking charge (sum of its booking_items) when the
  // caller supplies it, otherwise the event's online price × seats. Free events
  // are always £0 — no more hardcoded per-seat fiction.
  const unitPrice = resolveEventPriceAmount(event)
  const estimatedRevenue = activeBookings.reduce((sum, booking) => {
    const chargeTotal = Number(booking.charge_total)
    if (Number.isFinite(chargeTotal) && chargeTotal >= 0 && booking.charge_total !== null && booking.charge_total !== undefined) {
      return sum + chargeTotal
    }
    return sum + unitPrice * Math.max(0, Number(booking.seats ?? 0))
  }, 0)

  return {
    activeBookings: activeBookings.length,
    totalSeats,
    capacity,
    capacityPct: capacity && capacity > 0 ? Math.round((totalSeats / capacity) * 100) : null,
    estimatedRevenue: Number(estimatedRevenue.toFixed(2)),
    totalLinkClicks,
  }
}
