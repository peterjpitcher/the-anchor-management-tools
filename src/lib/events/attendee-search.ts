import { matchesPhoneSearch } from '@/lib/phone/search-match'

type SearchableEventBooking = {
  id: string
  customer?: { first_name: string | null; last_name: string | null; mobile_number: string | null; email?: string | null } | null
  attendee_names?: string[] | null
  attendees?: Array<{ name?: string | null }> | null
}

/**
 * The event attendee list filtered by a guest's name (the booker or a named guest), part of the
 * booking id, or a phone number typed as 07 or +44 (BK-180).
 */
export function filterEventBookings<T extends SearchableEventBooking>(bookings: T[], term: string): T[] {
  const needle = term.trim().toLowerCase()
  if (!needle) return bookings
  return bookings.filter((booking) => {
    const names = [
      booking.customer?.first_name,
      booking.customer?.last_name,
      [booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' '),
      booking.customer?.email,
      ...(booking.attendee_names ?? []),
      ...(booking.attendees ?? []).map((attendee) => attendee?.name ?? null),
      booking.id,
    ]
    if (names.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))) return true
    return matchesPhoneSearch(term, [booking.customer?.mobile_number])
  })
}
