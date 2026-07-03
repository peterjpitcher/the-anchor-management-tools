const ESTIMATED_REVENUE_PER_BOOKED_SEAT = 25

type EventLike = {
  capacity?: number | null
  seated_capacity?: number | null
  standing_capacity?: number | null
  booking_mode?: string | null
  price?: number | string | null
  price_per_seat?: number | string | null
  is_free?: boolean | null
  payment_mode?: string | null
}

type BookingLike = {
  seats?: number | null
  status?: string | null
  is_reminder_only?: boolean | null
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

function isActiveBooking(booking: BookingLike): boolean {
  return BOOKED_BOOKING_STATUSES.has(String(booking.status || '').toLowerCase()) && booking.is_reminder_only !== true
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
  links: LinkLike[] = []
): EventBookingStats {
  const activeBookings = bookings.filter(isActiveBooking)
  const totalSeats = activeBookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.seats ?? 0)), 0)
  const capacity = resolveEventCapacity(event)
  const totalLinkClicks = links.reduce((sum, link) => sum + Math.max(0, Number(link.clickCount ?? 0)), 0)

  return {
    activeBookings: activeBookings.length,
    totalSeats,
    capacity,
    capacityPct: capacity && capacity > 0 ? Math.round((totalSeats / capacity) * 100) : null,
    estimatedRevenue: ESTIMATED_REVENUE_PER_BOOKED_SEAT * totalSeats,
    totalLinkClicks,
  }
}
