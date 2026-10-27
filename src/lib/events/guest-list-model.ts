import { guestAnswers, storedAttendees, type GuestAnswer } from '@/lib/events/guest-answers'

export interface GuestListBookingInput {
  seats: number | null
  attendeeNames: string[] | null
  /** Each ticket's stored guest details (name and answers), where the booking has them. */
  attendees?: unknown
  customerFirstName: string | null
  customerLastName: string | null
  isReminderOnly?: boolean | null
  /** What the door needs to know about money, for example "Not paid yet: £90 due". */
  paymentNote?: string | null
}

export interface GuestLine {
  /** Empty string means "no known name" → a blank line for staff to hand-write. */
  name: string
  isBooker: boolean
  /** The guest's non-blank answers to the event's questions (owner decision D6). */
  answers: GuestAnswer[]
}

export interface GuestGroup {
  bookerName: string
  /**
   * Set when the tickets carry their own names: the person who booked, shown in the group's
   * heading rather than as a guest, because they may not be coming at all (BK-031).
   */
  bookedBy: string | null
  paymentNote: string | null
  lines: GuestLine[]
}

/**
 * One booking's lines on the door list.
 *
 * The list used to print the booker as the first guest and then the ticket names from ticket 2,
 * so when somebody bought tickets for others and was not coming (the website says they can), the
 * first named guest never appeared and could be turned away at the door, while the booker was
 * listed (BK-031, customer bookings review of 24 October 2026). Now every named ticket is a line
 * from ticket 1, and the booker is named in the heading. A booking with no ticket names keeps the
 * old shape: the booker, then blank lines to write in.
 */
function toGroup(b: GuestListBookingInput): GuestGroup {
  const bookerName = `${(b.customerFirstName ?? '').trim()} ${(b.customerLastName ?? '').trim()}`.trim()
  const seats = Math.max(b.seats ?? 1, 1)
  const detailed = storedAttendees(b.attendees)
  const named = detailed.length > 0
    ? detailed.map((attendee) => ({ name: attendee.name.trim(), answers: guestAnswers(attendee) }))
    : (b.attendeeNames ?? []).map((name) => ({ name: (name ?? '').trim(), answers: [] as GuestAnswer[] }))
  const hasNames = named.some((guest) => guest.name.length > 0)
  const paymentNote = b.paymentNote?.trim() || null

  if (hasNames) {
    const lineCount = Math.max(seats, named.length)
    const lines: GuestLine[] = Array.from({ length: lineCount }, (_, index) => ({
      name: named[index]?.name ?? '',
      isBooker: false,
      answers: named[index]?.answers ?? [],
    }))
    const firstName = named.find((guest) => guest.name.length > 0)?.name ?? ''
    return { bookerName: bookerName || firstName, bookedBy: bookerName || null, paymentNote, lines }
  }

  const lines: GuestLine[] = [{ name: bookerName, isBooker: true, answers: [] }]
  for (let i = 1; i < seats; i++) lines.push({ name: '', isBooker: false, answers: [] })
  return { bookerName, bookedBy: null, paymentNote, lines }
}

/**
 * Bookings on the door list only should be passed in (isOnDoorList); reminder-only and zero-seat
 * rows are dropped here defensively.
 */
export function buildGuestListModel(bookings: GuestListBookingInput[]): GuestGroup[] {
  return bookings
    .filter(b => !b.isReminderOnly && (b.seats ?? 0) >= 1)
    .map(b => ({
      group: toGroup(b),
      sortKey: `${(b.customerLastName ?? '').trim()} ${(b.customerFirstName ?? '').trim()}`.toLowerCase(),
    }))
    .sort((a, z) => a.sortKey.localeCompare(z.sortKey, 'en-GB', { sensitivity: 'base' }))
    .map(x => x.group)
}
