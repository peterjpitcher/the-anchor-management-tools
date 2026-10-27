import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bookingQuestionsSchema,
  prepareStaffEventAttendees,
  requiresGuestDetails,
  type BookingQuestion,
  type StaffEventAttendeeInput,
} from '@/lib/events/booking-questions'
import { decideTicketSelectionHandling, getDefaultTicketTypeId } from '@/lib/events/ticket-type-queries'
import { eventTicketTypesEnabled, type TicketSelectionInput } from '@/lib/events/ticket-types'

/**
 * Guest details and ticket types on a booking staff take by phone, at the bar or at the event
 * page (BK-011 and BK-141, customer bookings review of 24 October 2026; owner decision D5).
 *
 * Only the website asked for each guest's name and the event's answers, and the FOH screen could
 * not pick a ticket type, so a child ticket sold at the bar was charged at the default price.
 * Staff now take whatever the guest can give: a name, their own mobile and the answers for each
 * ticket. Anything they cannot give is left "to follow" and the booker completes it from their
 * manage link, or staff from the event page. A paid ticket is never refused for missing details,
 * because refusing loses the sale (D5).
 */

export type StaffBookingTicketLine = { ticketTypeId: string; quantity: number }

export type StaffBookingPreparation =
  | {
      ok: true
      ticketSelections: TicketSelectionInput[] | undefined
      attendees: StaffEventAttendeeInput[] | undefined
      /** The event's own setting (BK-014): this booking should carry guest details. */
      guestDetailsRequired: boolean
      /** Guest details are required and some are still missing after this booking. */
      detailsToFollow: boolean
    }
  | { ok: false; error: string }

type EventRow = {
  booking_questions: unknown
  collect_guest_details: boolean | null
  payment_mode: string | null
}

/** True when any ticket still lacks a name or a required answer. */
export function staffGuestDetailsMissing(input: {
  attendees: StaffEventAttendeeInput[] | undefined
  questions: BookingQuestion[]
  seats: number
}): boolean {
  if (!input.attendees?.length) return input.seats > 0
  const required = input.questions.filter((question) => question.required).map((question) => question.id)
  return input.attendees.some((guest) => !guest.name.trim() || required.some((id) => !guest.answers[id]?.trim()))
}

export async function prepareStaffEventBooking(
  db: SupabaseClient<any, 'public', any>,
  input: {
    eventId: string
    seats: number
    ticketSelections?: StaffBookingTicketLine[]
    attendees?: StaffEventAttendeeInput[]
    /** Legacy names-only list from older screens, mapped onto the ticket lines. */
    attendeeNames?: string[]
  },
): Promise<StaffBookingPreparation> {
  const { data, error } = await db
    .from('events')
    .select('booking_questions, collect_guest_details, payment_mode')
    .eq('id', input.eventId)
    .maybeSingle()
  if (error) return { ok: false, error: 'Failed to load the event.' }
  if (!data) return { ok: false, error: 'Event not found.' }
  const event = data as EventRow
  const parsedQuestions = bookingQuestionsSchema.safeParse(event.booking_questions ?? [])
  const questions = parsedQuestions.success ? parsedQuestions.data : []
  const guestDetailsRequired = requiresGuestDetails(event)

  let ticketSelections: TicketSelectionInput[] | undefined
  if (input.ticketSelections && input.ticketSelections.length > 0) {
    const selectionSeatTotal = input.ticketSelections.reduce((sum, line) => sum + line.quantity, 0)
    if (selectionSeatTotal !== input.seats) {
      return { ok: false, error: `Ticket quantities (${selectionSeatTotal}) must match the total seats (${input.seats}).` }
    }
    let defaultTypeId: string | null = null
    try {
      defaultTypeId = await getDefaultTicketTypeId(db, input.eventId)
    } catch {
      return { ok: false, error: 'Failed to load event ticket types.' }
    }
    // Distribute the flat per-seat names across the basket lines in order so the v07 function
    // stores per-line names and the aggregate list stays intact.
    let nameCursor = 0
    const mapped: TicketSelectionInput[] = input.ticketSelections.map((line) => {
      const lineNames = input.attendeeNames ? input.attendeeNames.slice(nameCursor, nameCursor + line.quantity) : []
      nameCursor += line.quantity
      return {
        ticket_type_id: line.ticketTypeId,
        quantity: line.quantity,
        ...(lineNames.length === line.quantity ? { attendee_names: lineNames } : {}),
      }
    })
    const decision = decideTicketSelectionHandling({ selections: mapped, flagEnabled: eventTicketTypesEnabled(), defaultTypeId })
    if (decision.kind === 'reject') return { ok: false, error: decision.error }
    if (decision.kind === 'apply') ticketSelections = mapped
  }

  const prepared = prepareStaffEventAttendees({ attendees: input.attendees, questions, seats: input.seats })
  if (!prepared.ok) return { ok: false, error: prepared.error }

  // Each guest row takes its ticket type from the basket, in order, so the function can check
  // the guests match the tickets bought. Without a basket the event's default type applies.
  let attendees = prepared.attendees
  if (attendees && ticketSelections) {
    const slots = ticketSelections.flatMap((line) => Array.from({ length: line.quantity }, () => line.ticket_type_id))
    attendees = attendees.map((guest, index) => ({ ...guest, ticket_type_id: slots[index] ?? null }))
  } else if (attendees) {
    attendees = attendees.map(({ ticket_type_id: _ignored, ...guest }) => guest)
  }

  return {
    ok: true,
    ticketSelections,
    attendees,
    guestDetailsRequired,
    detailsToFollow: guestDetailsRequired && staffGuestDetailsMissing({ attendees, questions, seats: input.seats }),
  }
}

/**
 * The guest rows a transferred booking takes with it (BK-011): one per ticket, keeping each
 * guest's name and own mobile, with no answers, because the new event asks its own questions.
 * Undefined when the booking has none.
 */
export function carryGuestsToTransfer(attendees: unknown, newId: () => string = () => crypto.randomUUID()): StaffEventAttendeeInput[] | undefined {
  if (!Array.isArray(attendees) || attendees.length === 0) return undefined
  return (attendees as Array<{ name?: unknown; phone?: unknown }>).map((guest) => ({
    id: newId(),
    name: typeof guest?.name === 'string' ? guest.name.trim().slice(0, 120) : '',
    answers: {},
    ...(typeof guest?.phone === 'string' && guest.phone.trim() ? { phone: guest.phone.trim() } : {}),
  }))
}
