import { isValidIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { effectiveWaiverStatus, waiverIsOutstanding } from './waiver-status'

/**
 * Paperwork still unsigned close to the event: one rule, used by the booking page and the
 * Friday report so both say the same thing.
 *
 * A private booking could reach its event with the contract unsigned, or with outside food
 * coming and the food agreement unsigned, and nothing told anyone (owner, 13 October 2026).
 * This is a warning only. It blocks nothing.
 *
 * Pure, with no database or server imports, so client components can use it.
 */

/**
 * How many days before the event the warning starts. It matches the point at which the balance
 * and final details are due: 14 days before the event.
 */
export const PAPERWORK_WARNING_DAYS = 14

/**
 * The statuses the rule covers. A draft is a live enquiry holding a date and a confirmed booking
 * is going ahead, so both can reach their event unsigned. Cancelled and completed bookings are
 * over, and an unknown status is left alone rather than guessed at.
 */
const OPEN_STATUSES: readonly string[] = ['draft', 'confirmed']

export type PaperworkDocument = 'contract' | 'food_agreement'
export type PaperworkState = 'not_sent' | 'sent_not_signed'

export interface OutstandingPaperworkItem {
  document: PaperworkDocument
  state: PaperworkState
}

/** The booking fields the rule reads. Every one is on the private_bookings table. */
export interface PaperworkBooking {
  status?: string | null
  event_date?: string | null
  date_tbd?: boolean | null
  contract_version?: number | null
  contract_sent_at?: string | null
  contract_accepted_at?: string | null
  outside_food?: boolean | null
  waiver_status?: string | null
}

export interface PaperworkWarning {
  /** Whole calendar days from today to the event: 0 is today. */
  daysUntilEvent: number
  items: OutstandingPaperworkItem[]
  /** "The event is in 5 days." */
  timing: string
  /** One sentence per outstanding item, contract first. */
  sentences: string[]
}

/** The date part of a stored event date, or null when it is not a real calendar date. */
function eventIsoDate(value: string | null | undefined): string | null {
  if (!value) return null
  const iso = value.slice(0, 10)
  return isValidIsoDate(iso) ? iso : null
}

/**
 * Whole calendar days from `todayIso` to the event, when the event is today or within the
 * warning window; otherwise null (already past, further ahead, or not a real date).
 *
 * Both values are calendar dates with no time of day, so the answer is the same in London and
 * in UTC, and a clock change between the two dates does not move it.
 */
export function daysUntilEventInWindow(eventDate: string | null | undefined, todayIso: string): number | null {
  const event = eventIsoDate(eventDate)
  if (!event || !isValidIsoDate(todayIso)) return null
  for (let days = 0; days <= PAPERWORK_WARNING_DAYS; days += 1) {
    if (shiftIsoDate(todayIso, days) === event) return days
  }
  return null
}

/**
 * What is outstanding for one booking, contract first, or an empty list.
 *
 * `todayIso` is today's date in London (YYYY-MM-DD), passed in so the rule never reads a clock.
 */
export function outstandingPaperwork(booking: PaperworkBooking, todayIso: string): OutstandingPaperworkItem[] {
  if (!booking.status || !OPEN_STATUSES.includes(booking.status)) return []
  if (booking.date_tbd === true) return []
  if (daysUntilEventInWindow(booking.event_date, todayIso) === null) return []

  const items: OutstandingPaperworkItem[] = []

  if (!booking.contract_accepted_at) {
    // "Sent" covers both ways a contract reaches the customer: emailed from the booking, or
    // issued (which numbers it) and handed over.
    const sent = Boolean(booking.contract_sent_at) || (booking.contract_version ?? 0) > 0
    items.push({ document: 'contract', state: sent ? 'sent_not_signed' : 'not_sent' })
  }

  if (waiverIsOutstanding(booking)) {
    // "required" means nobody has sent it yet; "sent" and "overdue" mean it is with the customer.
    const notSent = effectiveWaiverStatus(booking) === 'required'
    items.push({ document: 'food_agreement', state: notSent ? 'not_sent' : 'sent_not_signed' })
  }

  return items
}

const SENTENCES: Record<PaperworkDocument, Record<PaperworkState, string>> = {
  contract: {
    not_sent: 'The contract has not been sent.',
    sent_not_signed: 'The contract has been sent but not signed.',
  },
  food_agreement: {
    not_sent: 'The food agreement has not been sent.',
    sent_not_signed: 'The food agreement has been sent but not signed.',
  },
}

/** The plain sentences shown to staff, one per outstanding item. */
export function paperworkSentences(items: OutstandingPaperworkItem[]): string[] {
  return items.map((item) => SENTENCES[item.document][item.state])
}

/** "The event is today.", "The event is tomorrow." or "The event is in 5 days." */
export function eventTimingSentence(daysUntilEvent: number): string {
  if (daysUntilEvent <= 0) return 'The event is today.'
  if (daysUntilEvent === 1) return 'The event is tomorrow.'
  return `The event is in ${daysUntilEvent} days.`
}

/** Everything the page and the report need for one booking, or null when nothing is outstanding. */
export function paperworkWarning(booking: PaperworkBooking, todayIso: string): PaperworkWarning | null {
  const items = outstandingPaperwork(booking, todayIso)
  if (items.length === 0) return null
  const daysUntilEvent = daysUntilEventInWindow(booking.event_date, todayIso)
  if (daysUntilEvent === null) return null
  return {
    daysUntilEvent,
    items,
    timing: eventTimingSentence(daysUntilEvent),
    sentences: paperworkSentences(items),
  }
}
