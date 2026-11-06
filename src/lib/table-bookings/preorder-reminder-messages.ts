/**
 * The words of the Christmas food choices reminder ladder (owner decisions D6 and D7, 6 November
 * 2026; spec section 3.4).
 *
 * - The organiser is emailed at every rung (21, 14 and 10 days before, the day before the cutoff and
 *   9am on cutoff day) and texted as well on the last two. Each message names the guests still
 *   missing something, says what each needs, gives the deadline and links to the food page.
 *   Friendly at 21 and 14 days, firmer at 10 days and the day before, a last call on cutoff morning.
 * - The owner's call list goes to the manager mailbox the day before the cutoff, one email per run
 *   listing every booking still incomplete. Seat numbers only, as every staff email has been: guest
 *   names and dietary notes stay on the permission-gated screens (spec section 8).
 * - A guest who was sent their own link is reminded once, the day before the cutoff, about their
 *   own seat only.
 *
 * Pure: no database, no provider and no clock. `now` is passed in wherever a phrase depends on it,
 * and every date and time is read on the London calendar with the project's date helpers.
 */

import { formatTime12Hour, formatTimeInLondon, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import {
  formatBookingDateForEmail,
  formatBookingMomentForEmail,
  formatBookingTimeForEmail,
  renderTableBookingEmail,
  type TableBookingEmail,
} from '@/lib/table-bookings/guest-emails'
import type { PreorderCompleteness } from '@/lib/table-bookings/preorder'
import type { PreorderOrganiserStage } from '@/types/preorders'

/** The organiser stages that carry a text as well as the email (D6). */
export const PREORDER_TEXT_STAGES: ReadonlySet<PreorderOrganiserStage> = new Set([
  'booker_day_before',
  'booker_cutoff_morning',
])

/** The template key every ladder message to the organiser is logged under, as the old chase was. */
export const PREORDER_ORGANISER_TEMPLATE_KEY = 'table_booking_preorder_reminder'
/** The template key of the one reminder a guest gets about their own seat. */
export const PREORDER_GUEST_REMINDER_TEMPLATE_KEY = 'table_booking_preorder_guest_reminder'

/** How many guests a text names before it says "and N more". A text is not the place for a list. */
const TEXT_NAME_LIMIT = 3

// ---------------------------------------------------------------------------
// Who is missing what
// ---------------------------------------------------------------------------

/** One guest the organiser still needs to sort out, as the reminder names them. */
export type PreorderMissingGuest = {
  ordinal: number
  /** The guest's first name, or "Guest 3" when the seat has no name yet. */
  label: string
  /** What the seat still needs, for example "a name, their allergies and a main". */
  missing: string
}

/** A seat's first name, or "Guest <seat>" when it has none. */
export function guestLabel(ordinal: number, guestName: string | null | undefined): string {
  const first = (guestName ?? '').trim().split(/\s+/)[0] ?? ''
  return first.length > 0 ? first.slice(0, 40) : `Guest ${ordinal}`
}

/** Every guest still missing something, in seat order, from `getPreorderCompleteness`. */
export function describeMissingGuests(completeness: Pick<PreorderCompleteness, 'seatsIncomplete'>): PreorderMissingGuest[] {
  return completeness.seatsIncomplete.map((gap) => ({
    ordinal: gap.ordinal,
    label: guestLabel(gap.ordinal, gap.guestName),
    missing: gap.missing,
  }))
}

/** "Sam, Guest 3 and Jo", or "Sam, Guest 3, Jo and 2 more" past the limit. */
function joinNames(labels: string[], limit: number): string {
  if (labels.length === 0) return ''
  const shown = labels.slice(0, limit)
  const rest = labels.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`
  if (shown.length === 1) return shown[0]
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/**
 * The same needs said to the guest themselves: "your name, your allergies and a main" rather than
 * "a name, their allergies and a main". Only the phrases `describeCoverMissingCourses` writes.
 */
export function toGuestWording(missing: string): string {
  return missing
    .replace(/^a name\b/, 'your name')
    .replace(/details of their allergies/g, 'details of your allergies')
    .replace(/their allergies/g, 'your allergies')
    .replace(/their number of courses/g, 'your number of courses')
}

// ---------------------------------------------------------------------------
// The deadline
// ---------------------------------------------------------------------------

export type ChoicesDeadline = {
  /** "noon on Saturday 5 December 2026". */
  long: string
  /** "at noon today", "at noon tomorrow", or "at noon on Saturday 5 December 2026". */
  when: string
}

/** "noon" for 12:00, otherwise "9am" or "12:30pm", on the London clock. */
function londonClockPhrase(instant: Date): string {
  const time = formatTimeInLondon(instant)
  return time === '12:00' ? 'noon' : formatTime12Hour(time)
}

/** The cutoff as the messages say it, relative to the moment the run sends them. */
export function describeChoicesDeadline(cutoffAt: Date, now: Date): ChoicesDeadline {
  const cutoffDate = toLocalIsoDate(cutoffAt)
  const clock = londonClockPhrase(cutoffAt)
  const long = `${clock} on ${formatBookingDateForEmail(cutoffDate)}`
  const today = toLocalIsoDate(now)
  if (cutoffDate === today) return { long, when: `at ${clock} today` }
  if (cutoffDate === shiftIsoDate(today, 1)) return { long, when: `at ${clock} tomorrow` }
  return { long, when: `at ${long}` }
}

// ---------------------------------------------------------------------------
// The organiser
// ---------------------------------------------------------------------------

export type OrganiserChaseFacts = {
  stage: PreorderOrganiserStage
  /** As the message greets them (getSmartFirstName). */
  firstName: string
  bookingReference: string | null
  bookingDate: string
  bookingTime: string | null
  startDateTime?: string | null
  partySize: number | null
  missing: PreorderMissingGuest[]
  deadline: ChoicesDeadline
  /** The organiser's food page: the manage link, shortened where it could be. */
  foodLink: string
}

type StageCopy = {
  subject: (date: string | null, deadline: ChoicesDeadline) => string
  heading: string
  preheader: string
  lead: (facts: OrganiserChaseFacts, moment: string | null, reference: string) => string
  push: (facts: OrganiserChaseFacts) => string[]
}

const FRIENDLY: StageCopy = {
  subject: (date) => (date ? `Choose your Christmas food for ${date}` : 'Choose your Christmas food'),
  heading: "Time to choose everyone's Christmas food",
  preheader: "There's still time to choose everyone's food",
  lead: (facts, moment, reference) =>
    `Hi ${facts.firstName}, thanks again for booking Christmas dinner at The Anchor${moment ? ` on ${moment}` : ''}${reference}. ` +
    "There's still time to choose everyone's food.",
  push: (facts) => [
    `Choices close ${facts.deadline.when}.`,
    'You can fill them in on your food page, or send each guest their own link from there.',
  ],
}

const FIRMER: StageCopy = {
  subject: (date) =>
    date ? `We still need your Christmas food choices for ${date}` : 'We still need your Christmas food choices',
  heading: 'We still need your Christmas food choices',
  preheader: 'Some of your guests still need to choose',
  lead: (facts, moment, reference) =>
    `Hi ${facts.firstName}, we still need food choices for your Christmas dinner at The Anchor${moment ? ` on ${moment}` : ''}${reference}.`,
  push: (facts) => [
    `Choices close ${facts.deadline.when}, and the kitchen orders from them, so please fill in what's missing soon.`,
    'You can do it on your food page, or send each guest their own link from there.',
  ],
}

const DAY_BEFORE: StageCopy = {
  ...FIRMER,
  subject: (_date, deadline) => `Your Christmas food choices close ${deadline.when}`,
  heading: 'Your Christmas food choices close soon',
  preheader: "Please fill in what's missing today",
  push: (facts) => [
    `Choices close ${facts.deadline.when}. After that they can't be changed online, so please fill in what's missing today.`,
    'You can do it on your food page, or send each guest their own link from there.',
  ],
}

const LAST_CALL: StageCopy = {
  subject: (_date, deadline) => `Last call: Christmas food choices close ${deadline.when}`,
  heading: 'Last call for your Christmas food choices',
  preheader: "This is the last reminder we'll send",
  lead: (facts, moment, reference) =>
    `Hi ${facts.firstName}, this is the last call for the food choices for your Christmas dinner at The Anchor` +
    `${moment ? ` on ${moment}` : ''}${reference}.`,
  push: (facts) => [
    `Choices close ${facts.deadline.when}. After that they can't be changed online, and the kitchen orders from what's there.`,
    `If you can't finish in time, ring us on ${GUEST_CONTACT.phoneDisplay} and we'll help.`,
  ],
}

const STAGE_COPY: Record<PreorderOrganiserStage, StageCopy> = {
  booker_21d: FRIENDLY,
  booker_14d: FRIENDLY,
  booker_10d: FIRMER,
  booker_day_before: DAY_BEFORE,
  booker_cutoff_morning: LAST_CALL,
}

/** The list of who still needs what, as lines of the email. */
function missingLines(missing: PreorderMissingGuest[]): string[] {
  if (missing.length === 0) return ['Some of the food choices are still missing.']
  const count = missing.length
  return [
    `${count === 1 ? 'One guest still needs' : `${count} guests still need`} something:`,
    ...missing.map((guest) => `${guest.label}: ${guest.missing}.`),
  ]
}

/** The organiser's email for one rung of the ladder. */
export function buildOrganiserChaseEmail(facts: OrganiserChaseFacts): TableBookingEmail {
  const copy = STAGE_COPY[facts.stage]
  const moment = formatBookingMomentForEmail(facts.bookingDate, facts.bookingTime, facts.startDateTime)
  const date = formatBookingDateForEmail(facts.bookingDate, facts.startDateTime)
  const reference = facts.bookingReference ? ` (reference ${facts.bookingReference})` : ''

  return renderTableBookingEmail({
    subject: copy.subject(date, facts.deadline),
    preheader: `${copy.preheader}. Choices close at ${facts.deadline.long}.`,
    heading: copy.heading,
    opening: [copy.lead(facts, moment, reference), ...missingLines(facts.missing), ...copy.push(facts)],
    details: [
      { label: 'Reference', value: facts.bookingReference },
      { label: 'Date', value: date },
      { label: 'Time', value: formatBookingTimeForEmail(facts.bookingTime, facts.startDateTime) },
      { label: 'Choices close', value: facts.deadline.long },
    ],
    cta: { label: 'Choose the food', url: facts.foodLink },
    afterCta: [`Prefer to do it over the telephone? Ring us on ${GUEST_CONTACT.phoneDisplay}.`],
  })
}

/**
 * The organiser's text, on the two rungs that have one. Straight apostrophes and no dashes, so it
 * stays in the GSM alphabet (one curly character cuts a segment from 160 characters to 70). It names
 * up to three guests; the email and the food page say what each needs.
 */
export function buildOrganiserChaseText(
  facts: Pick<OrganiserChaseFacts, 'stage' | 'firstName' | 'missing' | 'deadline' | 'foodLink'>,
): string {
  const names = joinNames(
    facts.missing.map((guest) => guest.label),
    TEXT_NAME_LIMIT,
  )
  const forWhom = names ? ` for ${names}` : ''
  if (facts.stage === 'booker_cutoff_morning') {
    return (
      `The Anchor: Hi ${facts.firstName}, last call. Christmas food choices close ${facts.deadline.when} ` +
      `and we still need them${forWhom}. Fill them in here: ${facts.foodLink}`
    )
  }
  return (
    `The Anchor: Hi ${facts.firstName}, we still need Christmas food choices${forWhom}. ` +
    `Choices close ${facts.deadline.when}. Fill them in here: ${facts.foodLink}`
  )
}

// ---------------------------------------------------------------------------
// The owner's call list (D7)
// ---------------------------------------------------------------------------

export type ManagerCallListBooking = {
  bookingReference: string
  bookingDate: string
  bookingTime: string | null
  partySize: number | null
  organiserName: string
  organiserPhone: string | null
  /** What each line still needs, by seat: `describePreorderGaps`. */
  gaps: string
  deadline: ChoicesDeadline
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * One email listing every booking whose choices are still incomplete the day before its cutoff,
 * so the owner can ring the organisers. Staff only. Seat numbers, never guest names or dietary notes.
 */
export function buildManagerCallListEmail(bookings: ManagerCallListBooking[]): TableBookingEmail {
  const count = bookings.length
  const subject = `Christmas food choices still missing: ${count} booking${count === 1 ? '' : 's'} to ring`
  const intro =
    `${count === 1 ? 'This Christmas booking is' : `These ${count} Christmas bookings are`} still missing food choices ` +
    'the day before they close. Each shows when its choices close.'
  const outro =
    'Nothing has been cancelled. Ring the organiser, take what is missing over the telephone and record it on the booking. ' +
    'Staff can still save choices after the cutoff, and they are marked as late for the kitchen.'

  const blocks = bookings.map((booking) => {
    const when = formatBookingMomentForEmail(booking.bookingDate, booking.bookingTime) ?? booking.bookingDate
    const party = Number(booking.partySize) > 0 ? `${Math.trunc(Number(booking.partySize))}` : 'not recorded'
    return {
      title: booking.bookingReference,
      lines: [
        `When: ${when}`,
        `Party size: ${party}`,
        `Call: ${booking.organiserName} on ${booking.organiserPhone ?? 'no number on file'}`,
        `Choices close: ${booking.deadline.long}`,
        `Still needed: ${booking.gaps}`,
      ],
    }
  })

  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    ...blocks.map(
      (block) =>
        `<h3>${escapeHtml(block.title)}</h3><ul>${block.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
    ),
    `<p>${escapeHtml(outro)}</p>`,
  ].join('')

  const text = [intro, '', ...blocks.flatMap((block) => [block.title, ...block.lines, '']), outro].join('\n')

  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// One guest's reminder
// ---------------------------------------------------------------------------

export type GuestReminderFacts = {
  /** The seat's first name, or null when the organiser gave none. */
  guestFirstName: string | null
  /** The organiser's first name as the messages show it, or "there" when we have none. */
  organiserFirstName: string
  bookingDate: string
  bookingTime: string | null
  startDateTime?: string | null
  /** What the seat still needs, in `describeCoverMissingCourses` words. */
  missing: string | null
  deadline: ChoicesDeadline
  /** The guest's own link, `/g/<token>/christmas-choice`. */
  link: string
}

/** The one reminder to a guest about their own seat, the day before the cutoff. Email only. */
export function buildGuestReminderEmail(facts: GuestReminderFacts): TableBookingEmail {
  const moment = formatBookingMomentForEmail(facts.bookingDate, facts.bookingTime, facts.startDateTime)
  const organiser =
    facts.organiserFirstName && facts.organiserFirstName !== 'there' ? facts.organiserFirstName : 'the person who booked your table'
  const greeting = facts.guestFirstName ? `Hi ${facts.guestFirstName},` : 'Hello,'

  return renderTableBookingEmail({
    subject: `Your Christmas dinner choice at The Anchor closes ${facts.deadline.when}`,
    preheader: `Choose your Christmas dinner by ${facts.deadline.long}`,
    heading: 'Choose your Christmas dinner',
    opening: [
      `${greeting} ${organiser} asked us to send you a link to choose your own Christmas dinner at The Anchor${moment ? ` on ${moment}` : ''}.`,
      facts.missing ? `We still need ${toGuestWording(facts.missing)}.` : 'We still need your choices.',
      `Choices close ${facts.deadline.when}.`,
    ],
    details: [
      { label: 'Date', value: formatBookingDateForEmail(facts.bookingDate, facts.startDateTime) },
      { label: 'Time', value: formatBookingTimeForEmail(facts.bookingTime, facts.startDateTime) },
      { label: 'Choices close', value: facts.deadline.long },
    ],
    cta: { label: 'Choose your food', url: facts.link },
    afterCta: [
      'This link is just for your own place at the table.',
      "This is the only reminder we'll send, and we won't email you about anything else.",
    ],
  })
}
