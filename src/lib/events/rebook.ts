import type { BookingQuestion, StaffEventAttendeeInput } from '@/lib/events/booking-questions'
import { resolveDoorChargeAmount } from '@/lib/events/ticket-types'

/**
 * Rebooking a booking whose payment hold ran out (owner request, 9 November 2026).
 *
 * A lapsed (expired) booking cannot be edited, paid or cancelled, and nothing let staff start
 * again for the guest: Leo needed one ticket instead of two, Rupi was coming in to pay cash, and
 * Helen's website hold ran out before she paid. Rebook makes a new booking for the same guest
 * with the number of tickets staff choose, carries the guests' names, mobiles and answers across,
 * and either sends a payment link or records cash or card taken at the bar. These are the pure
 * rules; src/app/actions/event-rebook.ts does the work.
 */

export type RebookPaymentChoice = 'link' | 'cash' | 'card_terminal'

export const REBOOK_MAX_TICKETS = 20

type StoredAnswer = { question_id?: unknown; value?: unknown }
type StoredGuest = {
  id?: unknown
  name?: unknown
  phone?: unknown
  answers?: unknown
  details_confirmed_at?: unknown
  details_removed_at?: unknown
}

export interface RebookGuestSummary {
  id: string
  name: string
}

/** The lapsed booking's guests as staff choose between them: every guest with an id. */
export function rebookGuestSummaries(storedAttendees: unknown): RebookGuestSummary[] {
  if (!Array.isArray(storedAttendees)) return []
  return (storedAttendees as StoredGuest[])
    .filter((guest) => typeof guest?.id === 'string' && guest.id.length > 0)
    .map((guest, index) => ({
      id: guest.id as string,
      name: typeof guest.name === 'string' && guest.name.trim() ? guest.name.trim() : `Guest ${index + 1}`,
    }))
}

function listedNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((name): name is string => typeof name === 'string' && name.trim().length > 0).map((name) => name.trim())
}

/**
 * The lapsed booking's guests: its guest rows, or, for an older booking that kept its guests only
 * as a list of names (`attendee_names` on the booking, else on its ticket lines), one row per
 * name. Without this those names were lost on rebooking (Codex review of PR 330). The ids are
 * built from the list's order, so the preview and the rebook agree on who staff ticked.
 */
export function rebookStoredGuests(input: {
  attendees: unknown
  attendeeNames?: unknown
  lineAttendeeNames?: unknown[]
}): unknown[] {
  if (Array.isArray(input.attendees) && input.attendees.length > 0) return input.attendees
  const bookingNames = listedNames(input.attendeeNames)
  const names = bookingNames.length > 0 ? bookingNames : (input.lineAttendeeNames ?? []).flatMap(listedNames)
  return names.map((name, index) => ({ id: `listed-${index + 1}`, name }))
}

/** An answer the event still asks and would still accept, so the new booking is never refused for it. */
function carriedAnswer(question: BookingQuestion, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().slice(0, 2000)
  if (!value) return null
  if (question.type === 'yes_no' && value !== 'yes' && value !== 'no') return null
  if (question.type === 'choice' && !question.options?.includes(value)) return null
  return value
}

/**
 * The guest rows the new booking takes: the guests staff kept (all of them when no choice was
 * needed), each with their name, own mobile and the answers the event still asks, then blank rows
 * for any extra tickets, to follow from the booker's link as on any staff booking (D5). Answers
 * the retention job removed stay removed. A guest who confirmed they were happy to share their
 * details (BK-017) is still confirmed: same guest, same night.
 */
export function carryGuestsToRebook(input: {
  storedAttendees: unknown
  keepGuestIds?: string[] | null
  seats: number
  questions: BookingQuestion[]
  newId?: () => string
}): { ok: true; attendees: StaffEventAttendeeInput[] | undefined } | { ok: false; error: string } {
  const newId = input.newId ?? (() => crypto.randomUUID())
  const stored = Array.isArray(input.storedAttendees) ? (input.storedAttendees as StoredGuest[]) : []
  if (stored.length === 0) return { ok: true, attendees: undefined }

  let kept = stored
  if (input.keepGuestIds) {
    const keep = new Set(input.keepGuestIds)
    kept = stored.filter((guest) => typeof guest?.id === 'string' && keep.has(guest.id))
    if (kept.length !== keep.size) {
      return { ok: false, error: 'The guests on this booking have changed. Close this and try again.' }
    }
  }
  if (kept.length > input.seats) {
    const tickets = input.seats === 1 ? '1 ticket' : `${input.seats} tickets`
    return { ok: false, error: `Choose which guests are coming: there ${input.seats === 1 ? 'is' : 'are'} ${tickets} and ${kept.length} guests.` }
  }

  const rows: StaffEventAttendeeInput[] = kept.map((guest) => {
    const answers: Record<string, string> = {}
    if (!guest.details_removed_at && Array.isArray(guest.answers)) {
      const byQuestion = new Map(
        (guest.answers as StoredAnswer[])
          .filter((answer) => typeof answer?.question_id === 'string')
          .map((answer) => [answer.question_id as string, answer.value]),
      )
      for (const question of input.questions) {
        const value = carriedAnswer(question, byQuestion.get(question.id))
        if (value) answers[question.id] = value
      }
    }
    const phone = typeof guest.phone === 'string' && guest.phone.trim() ? guest.phone.trim() : null
    return {
      id: newId(),
      name: typeof guest.name === 'string' ? guest.name.trim().slice(0, 120) : '',
      answers,
      ...(phone ? { phone } : {}),
      ...(typeof guest.details_confirmed_at === 'string' && guest.details_confirmed_at ? { details_confirmed: true as const } : {}),
    }
  })
  while (rows.length < input.seats) rows.push({ id: newId(), name: '', answers: {} })

  return { ok: true, attendees: rows }
}

/**
 * What cash or card at the bar records for the new booking: the door price (full ticket price,
 * never the online discount; owner decision EV-02), the same figure Cash Paid would record.
 * `ticketBasePrice` is the lapsed booking's ticket type price, or null to use the event's.
 */
export function rebookDoorCharge(input: {
  seats: number
  ticketBasePrice: number | string | null
  eventFullUnitPrice: number
}): number {
  return resolveDoorChargeAmount({
    items: input.ticketBasePrice === null ? [] : [{ quantity: input.seats, base_price: input.ticketBasePrice }],
    eventFullUnitPrice: input.eventFullUnitPrice,
    seats: input.seats,
  })
}

/** Why a booking cannot be rebooked, in words staff can act on; null when it can. */
export function rebookRefusal(input: {
  status: string | null | undefined
  isReminderOnly?: boolean | null
  otherActiveBooking?: { status: string | null } | null
  ticketTypeCount: number
}): string | null {
  if (input.status !== 'expired') return 'Only a booking whose payment hold ran out can be rebooked.'
  if (input.isReminderOnly) return 'This is a reminder, not a booking, so there is nothing to rebook.'
  if (input.otherActiveBooking) {
    return input.otherActiveBooking.status === 'confirmed'
      ? 'This guest already has a confirmed booking for this event.'
      : 'This guest already has a booking waiting for payment for this event. Use that one.'
  }
  if (input.ticketTypeCount > 1) {
    return 'This booking had more than one ticket type. Use Add Booking to choose the tickets.'
  }
  return null
}

/** The refusal the booking function gave, for staff. */
export function describeRebookBlock(reason: string | null | undefined, seatsRemaining?: number | null): string {
  if (reason === 'customer_conflict') return 'This guest already has an active booking for this event.'
  if (typeof seatsRemaining === 'number') {
    return seatsRemaining > 0
      ? `Only ${seatsRemaining} ${seatsRemaining === 1 ? 'place is' : 'places are'} left. Nothing was booked.`
      : 'The event is full. Nothing was booked.'
  }
  if (reason === 'event_started') return 'The event has started, so it can no longer be booked.'
  if (!reason) return 'The booking could not be made. Nothing was booked.'
  return `${reason.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}. Nothing was booked.`
}
