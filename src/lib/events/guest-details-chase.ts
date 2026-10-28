/**
 * Chasing missing event guest details before the night (BK-132, customer bookings review of
 * 24 October 2026; owner decision D5).
 *
 * A phone, bar or text booking for an event that needs guest details may be saved with some still
 * to follow (release 14), and the booker is sent their link once. This adds the two chases D5
 * asked for, both run by the daily cron /api/cron/event-guest-details-reminders:
 *
 * - the booker is reminded once, 3 days before the night (or on the first run inside that window),
 *   by email first and a text only when there is no usable email (D14);
 * - the manager is emailed the day before with the bookings still incomplete, so the gaps are
 *   filled by phone rather than found at the door.
 *
 * Pure decisions here, so the windows can be tested in both time zones. All dates are London
 * calendar dates (YYYY-MM-DD).
 */

import { shiftIsoDate } from '@/lib/dateUtils'

/** How many days before the event the booker is reminded (owner decision D5). */
export const GUEST_DETAILS_REMINDER_DAYS = 3

/** A booking made in the last day has just been sent its request; it is not chased on top. */
export const GUEST_DETAILS_FRESH_BOOKING_HOURS = 24

/**
 * Whether the booker is due their one reminder: the event is 1 to 3 days away, the booking is
 * more than a day old, and it has not been reminded already. A missed run is caught up on the
 * next day inside the window; the night itself is too late for a reminder to help.
 */
export function isBookerReminderDue(input: {
  today: string
  eventDate: string
  bookingCreatedAt: string | null
  now: Date
  alreadyReminded: boolean
  missing: number
}): boolean {
  if (input.alreadyReminded || input.missing <= 0) return false
  const firstDay = shiftIsoDate(input.today, 1)
  const lastDay = shiftIsoDate(input.today, GUEST_DETAILS_REMINDER_DAYS)
  if (!firstDay || !lastDay) return false
  if (input.eventDate < firstDay || input.eventDate > lastDay) return false
  if (input.bookingCreatedAt) {
    const createdMs = Date.parse(input.bookingCreatedAt)
    if (Number.isFinite(createdMs) && input.now.getTime() - createdMs < GUEST_DETAILS_FRESH_BOOKING_HOURS * 60 * 60 * 1000) {
      return false
    }
  }
  return true
}

/** Whether today is the day the manager gets the event's list: the day before the night. */
export function isManagerListDay(input: { today: string; eventDate: string }): boolean {
  return shiftIsoDate(input.today, 1) === input.eventDate
}

export type ManagerListRow = {
  /** The staff reference, as the customer record shows it. */
  reference: string
  bookerName: string
  missing: number
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The manager's day-before list. Booker names, references and how many tickets are incomplete,
 * with a link to the event page where the numbers and the details are. Never a guest's answers
 * or phone number in the email (ticket-setup plan: no sensitive answers in emails).
 */
export function buildGuestDetailsManagerEmail(input: {
  eventName: string
  /** "Saturday 21 November 2026 at 7pm", or null. */
  when: string | null
  eventUrl: string
  rows: ManagerListRow[]
}): { subject: string; html: string; text: string } {
  const total = input.rows.reduce((sum, row) => sum + row.missing, 0)
  const bookingWord = input.rows.length === 1 ? 'booking' : 'bookings'
  const ticketWord = total === 1 ? 'ticket' : 'tickets'
  const whenText = input.when ? ` on ${input.when}` : ''
  const lead = `${input.rows.length} ${bookingWord} for ${input.eventName}${whenText} still ${input.rows.length === 1 ? 'has' : 'have'} guest details missing (${total} ${ticketWord}).`
  const advice = 'The bookers were reminded. Please ring them today, or ask at the door, and add the details on the event page.'
  const lines = input.rows.map((row) => `${row.reference}: ${row.bookerName}, ${row.missing} ${row.missing === 1 ? 'ticket' : 'tickets'} incomplete`)

  const html = [
    `<p>${escapeHtml(lead)}</p>`,
    '<ul>',
    ...lines.map((line) => `<li>${escapeHtml(line)}</li>`),
    '</ul>',
    `<p>${escapeHtml(advice)}</p>`,
    `<p><a href="${escapeHtml(input.eventUrl)}">Open the event</a></p>`,
  ].join('')
  const text = [lead, '', ...lines, '', advice, '', `Open the event: ${input.eventUrl}`].join('\n')

  return {
    subject: `Guest details missing for ${input.eventName}${input.when ? `, ${input.when}` : ''}`,
    html,
    text,
  }
}
