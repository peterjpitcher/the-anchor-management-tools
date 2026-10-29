import type { SupabaseClient } from '@supabase/supabase-js'
import { bookingQuestionsSchema, type BookingQuestion, type StoredEventAttendee } from '@/lib/events/booking-questions'
import { getDefaultTicketTypeId, loadBookingItems } from '@/lib/events/ticket-type-queries'
import { diffGuestDetails, mergeGuestDetailsEdit, type GuestDetailsEdit } from '@/lib/events/guest-details-edit'

/**
 * Saves an edit to a booking's guest details for the staff editor and the booker's manage link
 * (BK-016). Server only: callers check permission (events:manage) or the manage token first.
 * Guarded by the booking's updated_at, so two people editing at once cannot overwrite each other.
 */
export type GuestDetailsSaveResult =
  | {
      ok: true
      eventId: string
      guestCount: number
      created: boolean
      questionsAdded: number
      /** Ids only (BK-133): which guests and which questions this save changed. */
      changedGuestIds: string[]
      changedQuestionIds: string[]
    }
  | { ok: false; error: string; reason: 'not_found' | 'not_editable' | 'invalid' | 'conflict' | 'database' }

type BookingRow = {
  id: string
  event_id: string
  seats: number | null
  status: string | null
  is_reminder_only: boolean | null
  attendees: unknown
  updated_at: string | null
  event: EventRow | EventRow[] | null
}

type EventRow = {
  booking_questions: unknown
  collect_guest_details: boolean | null
  payment_mode: string | null
  booking_cutoff_at: string | null
  start_datetime: string | null
}

async function ticketSlots(db: SupabaseClient<any, 'public', any>, bookingId: string, eventId: string, seats: number): Promise<Array<string | null>> {
  const items = await loadBookingItems(db, bookingId)
  const slots = items.flatMap((item) => Array.from({ length: Math.max(0, Number(item.quantity ?? 0)) }, () => item.ticket_type_id))
  if (slots.length >= seats) return slots.slice(0, seats)
  const fallback = await getDefaultTicketTypeId(db, eventId)
  return [...slots, ...Array.from({ length: seats - slots.length }, () => fallback)]
}

export async function loadBookingGuestDetails(db: SupabaseClient<any, 'public', any>, bookingId: string): Promise<{
  booking: { id: string; eventId: string; seats: number; status: string | null; isReminderOnly: boolean; updatedAt: string | null; attendees: StoredEventAttendee[] }
  questions: BookingQuestion[]
  event: { collectGuestDetails: boolean | null; paymentMode: string | null; salesCutoff: string | null; start: string | null }
} | null> {
  const { data, error } = await db.from('bookings')
    .select('id, event_id, seats, status, is_reminder_only, attendees, updated_at, event:events(booking_questions, collect_guest_details, payment_mode, booking_cutoff_at, start_datetime)')
    .eq('id', bookingId)
    .maybeSingle()
  if (error) throw new Error(`Guest details could not be loaded: ${error.message}`)
  if (!data) return null
  const row = data as unknown as BookingRow
  const event = Array.isArray(row.event) ? row.event[0] : row.event
  const questions = bookingQuestionsSchema.safeParse(event?.booking_questions ?? [])
  return {
    booking: {
      id: row.id,
      eventId: row.event_id,
      seats: Math.max(0, Number(row.seats ?? 0)),
      status: row.status,
      isReminderOnly: row.is_reminder_only === true,
      updatedAt: row.updated_at,
      attendees: Array.isArray(row.attendees) ? (row.attendees as StoredEventAttendee[]) : [],
    },
    questions: questions.success ? questions.data : [],
    event: {
      collectGuestDetails: event?.collect_guest_details ?? null,
      paymentMode: event?.payment_mode ?? null,
      salesCutoff: event?.booking_cutoff_at ?? null,
      start: event?.start_datetime ?? null,
    },
  }
}

export async function saveBookingGuestDetails(
  db: SupabaseClient<any, 'public', any>,
  bookingId: string,
  edits: GuestDetailsEdit,
  options: {
    /** The booker confirmed everyone they added is happy to share these details (BK-017). */
    confirmedAt?: string
  } = {},
): Promise<GuestDetailsSaveResult> {
  const loaded = await loadBookingGuestDetails(db, bookingId)
  if (!loaded) return { ok: false, error: 'Guest details could not be loaded', reason: 'not_found' }
  const { booking, questions } = loaded
  if (booking.isReminderOnly || booking.seats < 1 || booking.status === 'cancelled' || booking.status === 'expired') {
    return { ok: false, error: 'This booking has no tickets to add guest details to.', reason: 'not_editable' }
  }

  const slots = booking.attendees.length === 0 ? await ticketSlots(db, booking.id, booking.eventId, booking.seats) : []
  const merged = mergeGuestDetailsEdit({ current: booking.attendees, edits, questions, seats: booking.seats, ticketSlots: slots })
  if (!merged.ok) return { ok: false, error: merged.error, reason: 'invalid' }

  const attendees = options.confirmedAt
    ? merged.attendees.map((guest) => ({ ...guest, details_confirmed_at: options.confirmedAt }))
    : merged.attendees
  let update = db.from('bookings').update({ attendees, updated_at: new Date().toISOString() }).eq('id', booking.id)
  if (booking.updatedAt) update = update.eq('updated_at', booking.updatedAt)
  const { data: saved, error } = await update.select('id').maybeSingle()
  if (error) return { ok: false, error: 'Guest details could not be saved. Please try again.', reason: 'database' }
  if (!saved) return { ok: false, error: 'Someone else changed this booking. Refresh before saving.', reason: 'conflict' }
  const changed = diffGuestDetails(booking.attendees, attendees)
  return {
    ok: true,
    eventId: booking.eventId,
    guestCount: attendees.length,
    created: merged.created,
    questionsAdded: merged.questionsAdded,
    changedGuestIds: changed.guestIds,
    changedQuestionIds: changed.questionIds,
  }
}
