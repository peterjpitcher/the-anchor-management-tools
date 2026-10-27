import type { SupabaseClient } from '@supabase/supabase-js'
import { bookingQuestionsSchema, type BookingQuestion } from '@/lib/events/booking-questions'
import { DOOR_LIST_EXCLUDED_STATUS_FILTER, isOnDoorList } from '@/lib/events/door-list'
import { eventBookingReference, type GuestAnswersBooking } from '@/lib/events/guest-answers'

export type GuestAnswersEvent = {
  id: string
  name: string
  date: string
  time: string | null
  slug: string | null
  questions: BookingQuestion[]
}

export type GuestAnswersBookingRow = GuestAnswersBooking & {
  seats: number
  status: string | null
}

type EventRow = { id: string; name: string; date: string; time: string | null; slug: string | null; booking_questions: unknown }
type BookingRow = {
  id: string
  seats: number | null
  status: string | null
  notes: string | null
  attendees: unknown
  is_reminder_only: boolean | null
  customer: { first_name: string | null; last_name: string | null } | null
}

/**
 * The event and the bookings on its door list (isOnDoorList), with each ticket's guest details
 * and the booking notes, for the kitchen summary and the answers CSV (BK-015). Server only: the
 * caller has already checked the staff member's permission.
 */
export async function loadEventGuestAnswers(
  admin: SupabaseClient<any, 'public', any>,
  eventId: string,
): Promise<{ event: GuestAnswersEvent; bookings: GuestAnswersBookingRow[] } | null> {
  const { data: event, error: eventError } = await admin
    .from('events')
    .select('id, name, date, time, slug, booking_questions')
    .eq('id', eventId)
    .maybeSingle()
  if (eventError) throw new Error(`Event could not be loaded: ${eventError.message}`)
  if (!event) return null

  const { data: bookings, error: bookingsError } = await admin
    .from('bookings')
    .select('id, seats, status, notes, attendees, is_reminder_only, customer:customers(first_name, last_name)')
    .eq('event_id', eventId)
    .not('status', 'in', DOOR_LIST_EXCLUDED_STATUS_FILTER)
    .eq('is_reminder_only', false)
    .order('created_at', { ascending: true })
  if (bookingsError) throw new Error(`Bookings could not be loaded: ${bookingsError.message}`)

  const eventRow = event as EventRow
  const questions = bookingQuestionsSchema.safeParse(eventRow.booking_questions ?? [])
  return {
    event: {
      id: eventRow.id,
      name: eventRow.name,
      date: eventRow.date,
      time: eventRow.time,
      slug: eventRow.slug,
      questions: questions.success ? questions.data : [],
    },
    bookings: ((bookings ?? []) as unknown as BookingRow[]).filter(isOnDoorList).map((booking) => ({
      id: booking.id,
      reference: eventBookingReference(booking.id),
      bookerName: [booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' ').trim() || 'Guest',
      attendees: booking.attendees,
      notes: booking.notes,
      seats: Number(booking.seats ?? 0),
      status: booking.status,
    })),
  }
}
