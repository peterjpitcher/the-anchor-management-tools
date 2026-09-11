/**
 * Guest emails for the table booking messages that move from text to email first (messaging
 * flags of 11 September 2026).
 *
 * Each email carries every fact its text carries, word for word where the text states an amount
 * or a refund, plus the facts the text leaves out for length: the booking reference, the full
 * date with its weekday, the time and the party size. Dates and weekdays come from the London
 * date helpers, never from the server's clock. Transactional only: nothing here promotes an
 * event, a menu or an offer.
 *
 * Pure functions: no database, no clock, so they can be rendered with fixture data in tests.
 */

import { formatDateInLondon, formatTime12Hour, formatTimeInLondon, isValidIsoDate } from '@/lib/dateUtils'
import { GUEST_CONTACT } from '@/lib/guest-contact'

export type TableBookingEmail = {
  subject: string
  html: string
  text: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function validInstant(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * "Saturday 12 September 2026", on the London calendar.
 *
 * A stored booking date is a London calendar date, so it is read at noon UTC, which is the same
 * date in London whether or not British Summer Time is in force. Built from parts rather than
 * one Intl call so the result does not depend on how a runtime's locale data punctuates it.
 */
export function formatBookingDateForEmail(
  bookingDate: string | null | undefined,
  startDateTime?: string | null
): string | null {
  const isoDate = typeof bookingDate === 'string' ? bookingDate.slice(0, 10) : ''
  const anchor = isValidIsoDate(isoDate) ? new Date(`${isoDate}T12:00:00Z`) : validInstant(startDateTime)
  if (!anchor) return null

  const weekday = formatDateInLondon(anchor, { weekday: 'long' })
  const rest = formatDateInLondon(anchor, { day: 'numeric', month: 'long', year: 'numeric' })
  return `${weekday} ${rest}`
}

/** "7pm" or "7:30pm", from the stored London wall-clock time, else from the start instant. */
export function formatBookingTimeForEmail(
  bookingTime: string | null | undefined,
  startDateTime?: string | null
): string | null {
  if (typeof bookingTime === 'string' && /^\d{1,2}:\d{2}/.test(bookingTime.trim())) {
    return formatTime12Hour(bookingTime.trim())
  }

  const instant = validInstant(startDateTime)
  return instant ? formatTime12Hour(formatTimeInLondon(instant)) : null
}

/** "Saturday 12 September 2026 at 7pm", or whichever half is known. */
export function formatBookingMomentForEmail(
  bookingDate: string | null | undefined,
  bookingTime: string | null | undefined,
  startDateTime?: string | null
): string | null {
  const date = formatBookingDateForEmail(bookingDate, startDateTime)
  const time = formatBookingTimeForEmail(bookingTime, startDateTime)
  if (date && time) return `${date} at ${time}`
  return date ?? time
}

function partySizeLabel(partySize: number | null | undefined): string | null {
  const size = Number(partySize)
  if (!Number.isFinite(size) || size < 1) return null
  const whole = Math.floor(size)
  return `${whole} ${whole === 1 ? 'person' : 'people'}`
}

type DetailRow = { label: string; value: string | null | undefined }

type EmailLayout = {
  subject: string
  /** Paragraphs before the booking details. Plain text; escaped here. */
  opening: string[]
  details: DetailRow[]
  /** Paragraphs after the details. Plain text; escaped here. */
  closing?: string[]
  cta?: { label: string; url: string }
  /** Paragraphs after the button. Plain text; escaped here. */
  afterCta?: string[]
  /** How the footer starts, before ", reply to this email or call us on ...". */
  footerLead: string
}

/**
 * The layout every table booking email already uses (Arial, a short details list, the reply and
 * phone line, signed "The Anchor"), with the venue number written out and dialable.
 */
function renderTableBookingEmail(layout: EmailLayout): TableBookingEmail {
  const rows = layout.details.filter(
    (row): row is { label: string; value: string } => typeof row.value === 'string' && row.value.trim().length > 0
  )
  const footerText = `${layout.footerLead}, reply to this email or call us on ${GUEST_CONTACT.phoneDisplay}.`
  const footerHtml =
    `${escapeHtml(layout.footerLead)}, reply to this email or call us on ` +
    `<a href="${GUEST_CONTACT.telHref}">${escapeHtml(GUEST_CONTACT.phoneDisplay)}</a>.`

  const paragraphs = (lines: string[] | undefined) => (lines ?? []).map((line) => `<p>${escapeHtml(line)}</p>`)

  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">',
    ...paragraphs(layout.opening),
    rows.length > 0 ? '<ul>' : '',
    ...rows.map((row) => `<li><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value)}</li>`),
    rows.length > 0 ? '</ul>' : '',
    ...paragraphs(layout.closing),
    layout.cta ? `<p><a href="${escapeHtml(layout.cta.url)}">${escapeHtml(layout.cta.label)}</a></p>` : '',
    ...paragraphs(layout.afterCta),
    `<p>${footerHtml}</p>`,
    '<p>The Anchor</p>',
    '</div>',
  ].join('')

  const text = [
    ...layout.opening,
    ...rows.map((row) => `${row.label}: ${row.value}`),
    ...(layout.closing ?? []),
    layout.cta ? `${layout.cta.label}: ${layout.cta.url}` : null,
    ...(layout.afterCta ?? []),
    footerText,
    'The Anchor',
  ]
    .filter((line): line is string => typeof line === 'string' && line.length > 0)
    .join('\n')

  return { subject: layout.subject, html, text }
}

type BookingFacts = {
  firstName: string
  bookingReference: string | null | undefined
  /** YYYY-MM-DD, the London date the booking is for. */
  bookingDate: string | null | undefined
  /** HH:MM or HH:MM:SS, London wall-clock time. */
  bookingTime?: string | null
  startDateTime?: string | null
  partySize?: number | null
}

function bookingDetailRows(facts: BookingFacts): DetailRow[] {
  return [
    { label: 'Reference', value: facts.bookingReference ?? null },
    { label: 'Date', value: formatBookingDateForEmail(facts.bookingDate, facts.startDateTime) },
    { label: 'Time', value: formatBookingTimeForEmail(facts.bookingTime, facts.startDateTime) },
    { label: 'Party size', value: partySizeLabel(facts.partySize) },
  ]
}

/** "£160.00", as the booking texts print money. Null for anything that is not a positive amount. */
function formatPounds(amount: number | null | undefined): string | null {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return null
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

/**
 * The deposit confirmation. The text says "Deposit sorted, your table for 16 people on
 * {moment} is locked in. See you then!" with any high chairs, outside seating, the manage link
 * and the Christmas course summary; the email says all of that and adds the reference, the date
 * with its weekday, the time and the amount the guest paid.
 */
export function buildTableBookingDepositConfirmedEmail(
  input: BookingFacts & {
    isOutsideSeating?: boolean | null
    highChairCount?: number | null
    christmasCourseSummary?: string | null
    /** Pounds, as locked at capture. Left out when unknown. */
    depositPaid?: number | null
    manageLink?: string | null
  }
): TableBookingEmail {
  const isOutside = Boolean(input.isOutsideSeating)
  const bookingNoun = isOutside ? 'outside booking' : 'table'
  const party = partySizeLabel(input.partySize)
  const moment = formatBookingMomentForEmail(input.bookingDate, input.bookingTime, input.startDateTime)
  const highChairs = Math.max(0, Math.floor(Number(input.highChairCount ?? 0)) || 0)

  return renderTableBookingEmail({
    subject: isOutside
      ? 'Deposit received: your outside booking at The Anchor is confirmed'
      : 'Deposit received: your table at The Anchor is confirmed',
    opening: [
      `Hi ${input.firstName}, your deposit is sorted and your ${bookingNoun}` +
        `${party ? ` for ${party}` : ''}${moment ? ` on ${moment}` : ''} is locked in. See you then!`,
    ],
    details: [
      ...bookingDetailRows(input),
      { label: 'Deposit paid', value: formatPounds(input.depositPaid) },
      { label: 'High chair reserved', value: highChairs > 0 ? `x${highChairs}` : null },
      { label: 'Seating', value: isOutside ? 'Outside (weather permitting)' : null },
    ],
    closing: input.christmasCourseSummary ? [input.christmasCourseSummary] : [],
    cta: input.manageLink ? { label: 'Manage your booking', url: input.manageLink } : undefined,
    footerLead: 'If you need to change anything',
  })
}

/**
 * The deposit request after staff grow a party past the deposit threshold. The text says
 * "your party size has been updated to 16 people. A table deposit of £160.00 (16 x GBP 10) is
 * now required to secure your booking. Pay now: {link}"; the email repeats that sentence
 * exactly, adds the booking details, and says until when the payment link works, which is the
 * moment the hold on the booking lapses.
 */
export function buildTableBookingDepositRequestEmail(
  input: BookingFacts & {
    /** "table deposit", "Sunday lunch deposit" or "Christmas deposit", as the text says it. */
    depositKindLabel: string
    /** "£160.00", formatted exactly as in the text. */
    depositLabel: string
    /** " (16 x GBP 10)" or "", exactly as in the text. */
    breakdownNote: string
    paymentLink: string
    /** When the payment link and the hold expire, as an ISO instant. */
    payByIso?: string | null
  }
): TableBookingEmail {
  const partySize = Math.max(1, Math.floor(Number(input.partySize ?? 1)) || 1)
  const seatWord = partySize === 1 ? 'person' : 'people'
  const payBy = input.payByIso ? formatBookingMomentForEmail(null, null, input.payByIso) : null

  return renderTableBookingEmail({
    subject: 'Pay your deposit to secure your booking at The Anchor',
    opening: [
      `Hi ${input.firstName}, your party size has been updated to ${partySize} ${seatWord}. ` +
        `A ${input.depositKindLabel} of ${input.depositLabel}${input.breakdownNote} is now required to secure your booking.`,
    ],
    details: [...bookingDetailRows({ ...input, partySize }), { label: 'Deposit', value: input.depositLabel }],
    cta: { label: 'Pay your deposit', url: input.paymentLink },
    afterCta: payBy ? [`This payment link works until ${payBy}.`] : [],
    footerLead: 'If you need to change anything',
  })
}

/**
 * The cancellation email. `refundSentence` is the sentence the cancellation text puts after
 * "has been cancelled.", passed in verbatim so the amount and the refund timing cannot drift
 * from what the text says.
 */
export function buildTableBookingCancelledEmail(input: BookingFacts & { refundSentence: string }): TableBookingEmail {
  const date = formatBookingDateForEmail(input.bookingDate, input.startDateTime)
  return renderTableBookingEmail({
    subject: 'Your booking at The Anchor has been cancelled',
    opening: [
      date
        ? `Hi ${input.firstName}, your booking on ${date} has been cancelled.`
        : `Hi ${input.firstName}, your booking has been cancelled.`,
    ],
    details: bookingDetailRows(input),
    closing: [input.refundSentence],
    footerLead: 'If this does not look right',
  })
}
