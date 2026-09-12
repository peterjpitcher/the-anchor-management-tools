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
 * The layout is the house one the branch templates already use (Arial, 600px, a two-column
 * details table, the venue contact block from `@/lib/email/guest-footer`), with a preheader so
 * the inbox preview says what the email is about rather than repeating the greeting.
 *
 * Pure functions: no database, no clock, so they can be rendered with fixture data in tests.
 */

import { formatDateInLondon, formatTime12Hour, formatTimeInLondon, isValidIsoDate } from '@/lib/dateUtils'
import { GUEST_EMAIL_SIGN_OFF, guestContactHtmlBlock, guestContactTextLine } from '@/lib/email/guest-footer'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { depositTermsLines } from '@/lib/table-bookings/deposit-terms'

export type TableBookingEmail = {
  subject: string
  html: string
  text: string
}

const FONT_FAMILY = 'Arial, Helvetica, sans-serif'
/** The Anchor green, as the guest contact block and the guest pages already use it. */
const BRAND_GREEN = '#005131'

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
  /** The line the inbox shows next to the subject. Says what the email is about, not hello. */
  preheader: string
  /** The heading at the top of the email. */
  heading: string
  /** Paragraphs before the booking details. Plain text; escaped here. */
  opening: string[]
  details: DetailRow[]
  /** Paragraphs after the details. Plain text; escaped here. */
  closing?: string[]
  cta?: { label: string; url: string }
  /** Paragraphs after the button. Plain text; escaped here. */
  afterCta?: string[]
  /** The sentence before the contact block, e.g. "If you need to change anything, tell us." */
  beforeContact?: string[]
}

/**
 * The house layout, with the venue number written out and dialable in both parts.
 *
 * The contact block comes from `@/lib/email/guest-footer` rather than being written here, so a
 * booking email can never again say "reply to this email or call the pub" with no number in it.
 */
function renderTableBookingEmail(layout: EmailLayout): TableBookingEmail {
  const rows = layout.details.filter(
    (row): row is { label: string; value: string } => typeof row.value === 'string' && row.value.trim().length > 0
  )

  const paragraph = (line: string) =>
    `<p style="font-family:${FONT_FAMILY};font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(line)}</p>`
  const paragraphs = (lines: string[] | undefined) => (lines ?? []).map(paragraph)

  const detailsTable =
    rows.length > 0
      ? [
          '<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0">',
          ...rows.map(
            (row) =>
              `<tr><td style="font-family:${FONT_FAMILY};font-size:15px;padding:8px 12px 8px 0;` +
              `border-bottom:1px solid #eeeeee;color:#666666;white-space:nowrap;vertical-align:top">` +
              `${escapeHtml(row.label)}</td>` +
              `<td style="font-family:${FONT_FAMILY};font-size:15px;padding:8px 0;` +
              `border-bottom:1px solid #eeeeee;vertical-align:top">${escapeHtml(row.value)}</td></tr>`
          ),
          '</table>',
        ].join('')
      : ''

  const html = [
    `<div style="font-family:${FONT_FAMILY};max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a">`,
    // The preview line. Hidden in the body, read by the inbox.
    '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">',
    escapeHtml(layout.preheader),
    '</div>',
    `<h2 style="font-family:${FONT_FAMILY};font-size:20px;line-height:1.3;margin:0 0 16px;color:${BRAND_GREEN}">`,
    escapeHtml(layout.heading),
    '</h2>',
    ...paragraphs(layout.opening),
    detailsTable,
    ...paragraphs(layout.closing),
    layout.cta
      ? `<p style="margin:20px 0"><a href="${escapeHtml(layout.cta.url)}" ` +
        `style="font-family:${FONT_FAMILY};display:inline-block;background:${BRAND_GREEN};color:#ffffff;` +
        `font-size:16px;padding:12px 20px;border-radius:4px;text-decoration:none">` +
        `${escapeHtml(layout.cta.label)}</a></p>`
      : '',
    ...paragraphs(layout.afterCta),
    ...paragraphs(layout.beforeContact),
    guestContactHtmlBlock(),
    `<p style="font-family:${FONT_FAMILY};font-size:15px;margin:16px 0 0">${GUEST_EMAIL_SIGN_OFF}</p>`,
    '</div>',
  ].join('')

  const text = [
    ...layout.opening,
    ...rows.map((row) => `${row.label}: ${row.value}`),
    ...(layout.closing ?? []),
    layout.cta ? `${layout.cta.label}: ${layout.cta.url}` : null,
    ...(layout.afterCta ?? []),
    ...(layout.beforeContact ?? []),
    guestContactTextLine(),
    GUEST_EMAIL_SIGN_OFF,
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

/** The deposit facts an email states when money is still owed. */
export type DepositTermsFacts = {
  /** True for `booking_type = 'christmas'`, which changes the approved wording (SSOT 16). */
  isChristmas?: boolean | null
  /** What the deposit works out at per person, when both the amount and the party size are known. */
  perPersonGbp?: number | null
  /** The booking's own `deposit_refund_cutoff_days`. Null when it carries no seasonal terms. */
  refundCutoffDays?: number | null
  /** When the hold on the table runs out, as an ISO instant. */
  payByIso?: string | null
}

function depositTerms(facts: DepositTermsFacts): string[] {
  return depositTermsLines({
    isChristmas: facts.isChristmas === true,
    perPersonGbp: facts.perPersonGbp ?? null,
    refundCutoffDays: facts.refundCutoffDays ?? null,
    payByLabel: facts.payByIso ? formatBookingMomentForEmail(null, null, facts.payByIso) : null,
  })
}

/**
 * What is still owed on a seasonal pre-order, from the course each guest is on.
 *
 * `isCoverComplete` is the authority: a one-course seat has nothing to choose, a two-course seat
 * needs a main and one other course, a three-course seat needs all three. The old wording, "a
 * starter and a dessert are optional", was true only of the one-course tier and was sent to
 * bookings that the same sweep was chasing precisely because a course was missing.
 */
export function describePreorderCourseRequirement(courseCounts?: number[] | null): string[] {
  const tiers = (courseCounts ?? []).map(Number).filter((count) => Number.isFinite(count) && count >= 1)

  if (tiers.length === 0) {
    return ['Every guest needs their courses chosen, and a two or three course guest needs every course picked.']
  }

  const lines: string[] = []
  if (tiers.some((count) => count === 3)) {
    lines.push('Every guest on three courses needs a starter, a main and a dessert chosen.')
  }
  if (tiers.some((count) => count === 2)) {
    lines.push('Every guest on two courses needs a main and one other course chosen.')
  }
  if (tiers.some((count) => count === 1)) {
    lines.push('Guests on one course have nothing to pre-order.')
  }
  return lines
}

/**
 * The pre-order deadline, as SSOT section 16 words it, with the date it falls on for this
 * booking when that is known. `cutoffDays` is the period's own `preorder_cutoff_days`; the
 * sentence is left out rather than guessed when the period does not say.
 */
export function describePreorderDeadline(input: {
  cutoffDays?: number | null
  closesAtIso?: string | null
}): string[] {
  const days = Number(input.cutoffDays)
  const closesAt = input.closesAtIso ? formatBookingMomentForEmail(null, null, input.closesAtIso) : null
  const lines: string[] = []

  if (Number.isFinite(days) && days > 0) {
    lines.push(`Two and three courses need everyone's choices ${days} days before your booking.`)
  }
  if (closesAt) {
    lines.push(`For this booking that is ${closesAt}.`)
  }
  return lines
}

/**
 * The booking confirmation. The text says "your table booking for 4 people on {moment} is
 * confirmed" with any high chairs, outside seating and the manage or food-choices link; the
 * email says all of that and adds the reference, the date with its weekday and the time.
 *
 * A booking on a seasonal menu that owes food choices is told so here and its button says so,
 * because the chase seven days out is too late for the kitchen and it makes the reminder do work
 * the confirmation should already have done.
 */
export function buildTableBookingConfirmedEmail(
  input: BookingFacts & {
    isOutsideSeating?: boolean | null
    highChairCount?: number | null
    christmasCourseSummary?: string | null
    manageLink?: string | null
    /** True when this booking's covers owe food choices on a seasonal menu. */
    needsFoodChoices?: boolean | null
    /** The per-guest course tiers, for the wording of what is still needed. */
    christmasCourseCounts?: number[] | null
    /** The period's `preorder_cutoff_days`, for the deadline sentence. */
    preorderCutoffDays?: number | null
    /** When the pre-order form locks for this booking, as an ISO instant. */
    preorderClosesAtIso?: string | null
  }
): TableBookingEmail {
  const isOutside = Boolean(input.isOutsideSeating)
  const bookingNoun = isOutside ? 'outside booking' : 'table booking'
  const party = partySizeLabel(input.partySize)
  const moment = formatBookingMomentForEmail(input.bookingDate, input.bookingTime, input.startDateTime)
  const highChairs = Math.max(0, Math.floor(Number(input.highChairCount ?? 0)) || 0)

  // The period asks for a pre-order, and at least one guest is on a tier that has something to
  // choose. A party where everybody took one course owes nothing, so it is not told to pick
  // dishes and its button stays "Manage your booking".
  const tiers = (input.christmasCourseCounts ?? []).map(Number).filter((count) => Number.isFinite(count) && count >= 1)
  const needsFoodChoices =
    input.needsFoodChoices === true && (tiers.length === 0 || tiers.some((count) => count >= 2))

  return renderTableBookingEmail({
    subject: isOutside
      ? 'Your outside booking at The Anchor is confirmed'
      : 'Your table booking at The Anchor is confirmed',
    preheader: moment ? `${moment}${party ? `, ${party}` : ''}` : 'Your booking at The Anchor is confirmed',
    heading: isOutside ? 'Your outside booking is confirmed' : 'Your table is confirmed',
    opening: [
      `Hi ${input.firstName}, your ${bookingNoun}${party ? ` for ${party}` : ''}` +
        `${moment ? ` on ${moment}` : ''} is confirmed.`,
    ],
    details: [
      ...bookingDetailRows(input),
      { label: 'High chair reserved', value: highChairs > 0 ? `x${highChairs}` : null },
      { label: 'Seating', value: isOutside ? 'Outside (weather permitting)' : null },
    ],
    closing: [
      ...(input.christmasCourseSummary ? [input.christmasCourseSummary] : []),
      ...(needsFoodChoices
        ? [
            "We need everyone's food choices before your booking.",
            ...describePreorderCourseRequirement(input.christmasCourseCounts),
            ...describePreorderDeadline({
              cutoffDays: input.preorderCutoffDays,
              closesAtIso: input.preorderClosesAtIso,
            }),
          ]
        : []),
    ],
    cta: input.manageLink
      ? { label: needsFoodChoices ? 'Choose your food' : 'Manage your booking', url: input.manageLink }
      : undefined,
    beforeContact: ['If you need to change anything, let us know.'],
  })
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
    preheader: moment ? `${moment}${party ? `, ${party}` : ''}` : 'Your deposit is sorted',
    heading: 'Your deposit is sorted',
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
    beforeContact: ['If you need to change anything, let us know.'],
  })
}

/** Shared body for both deposit requests, so the four deposit facts cannot go missing from one. */
function renderDepositRequestEmail(
  input: BookingFacts &
    DepositTermsFacts & {
      subject: string
      heading: string
      /** The first paragraph, which has to name the deposit rather than only its amount. */
      lead: string
      /** "£160.00", formatted exactly as the text says it. */
      depositLabel: string
      /** Left out only when the link could not be minted, which the copy then says. */
      paymentLink?: string | null
      isOutsideSeating?: boolean | null
    }
): TableBookingEmail {
  const moment = formatBookingMomentForEmail(input.bookingDate, input.bookingTime, input.startDateTime)
  const paymentLink = input.paymentLink?.trim() || null

  return renderTableBookingEmail({
    subject: input.subject,
    preheader: `${input.depositLabel} deposit${moment ? `, ${moment}` : ''}`,
    heading: input.heading,
    opening: [input.lead],
    details: [
      ...bookingDetailRows(input),
      { label: 'Deposit', value: input.depositLabel },
      { label: 'Seating', value: input.isOutsideSeating ? 'Outside (weather permitting)' : null },
    ],
    closing: [
      ...depositTerms(input),
      // Never an empty button: a link that could not be minted is said out loud, as the text does.
      ...(paymentLink ? [] : ['We will send your payment link shortly.']),
    ],
    cta: paymentLink ? { label: 'Pay your deposit', url: paymentLink } : undefined,
    beforeContact: ['If you would rather pay over the telephone, or anything looks wrong, tell us.'],
  })
}

/**
 * The deposit request when the booking is taken, for a party over the deposit threshold or on a
 * seasonal menu. The old version rendered "please pay your £160.00 to secure your table": the
 * amount had replaced the word, so it never said the money was a deposit, never said it came off
 * the bill, gave no deadline and gave no refund terms. All four are stated now.
 */
export function buildTableBookingDepositAtBookingEmail(
  input: BookingFacts &
    DepositTermsFacts & {
      /** "table deposit", "Sunday lunch deposit" or "Christmas deposit", as the text says it. */
      depositKindLabel: string
      /** "£160.00", formatted exactly as in the text. */
      depositLabel: string
      /** " (16 x GBP 10)" or "", exactly as in the text. */
      breakdownNote?: string
      /** Left out only when the link could not be minted, which the copy then says. */
      paymentLink?: string | null
      isOutsideSeating?: boolean | null
      highChairCount?: number | null
    }
): TableBookingEmail {
  const isOutside = Boolean(input.isOutsideSeating)
  const secureNoun = isOutside ? 'outside booking' : 'table'
  const party = partySizeLabel(input.partySize)
  const moment = formatBookingMomentForEmail(input.bookingDate, input.bookingTime, input.startDateTime)

  return renderDepositRequestEmail({
    ...input,
    subject: isOutside
      ? 'Pay your deposit to secure your outside booking at The Anchor'
      : 'Pay your deposit to secure your table at The Anchor',
    heading: 'One step left: your deposit',
    lead:
      `Hi ${input.firstName}, please pay your ${input.depositKindLabel} of ` +
      `${input.depositLabel}${input.breakdownNote ?? ''} to secure your ${secureNoun}` +
      `${party ? ` for ${party}` : ''}${moment ? ` on ${moment}` : ''}.`,
  })
}

/**
 * The deposit request after staff grow a party past the deposit threshold. The text says
 * "your party size has been updated to 16 people. A table deposit of £160.00 (16 x GBP 10) is
 * now required to secure your booking. Pay now: {link}"; the email repeats that sentence
 * exactly, adds the booking details, and says what the deposit is for, by when and what comes
 * back if the booking is cancelled.
 */
export function buildTableBookingDepositRequestEmail(
  input: BookingFacts &
    DepositTermsFacts & {
      /** "table deposit", "Sunday lunch deposit" or "Christmas deposit", as the text says it. */
      depositKindLabel: string
      /** "£160.00", formatted exactly as in the text. */
      depositLabel: string
      /** " (16 x GBP 10)" or "", exactly as in the text. */
      breakdownNote: string
      paymentLink: string
    }
): TableBookingEmail {
  const partySize = Math.max(1, Math.floor(Number(input.partySize ?? 1)) || 1)
  const seatWord = partySize === 1 ? 'person' : 'people'

  return renderDepositRequestEmail({
    ...input,
    partySize,
    subject: 'Pay your deposit to secure your booking at The Anchor',
    heading: 'Your booking needs a deposit',
    lead:
      `Hi ${input.firstName}, your party size has been updated to ${partySize} ${seatWord}. ` +
      `A ${input.depositKindLabel} of ${input.depositLabel}${input.breakdownNote} is now required ` +
      'to secure your booking.',
  })
}

/**
 * The booking-amended notice, after staff change the date, the time or the party size.
 *
 * It says what the booking was and what it is now, because an email that shows only the new time
 * cannot be checked by the person reading it. "Still confirmed" is said only when the booking
 * actually is: a `pending_payment` booking that staff re-time still owes a deposit, and telling
 * that guest their table is confirmed is how a hold lapses on somebody who thought they were
 * done. That guest gets the deposit, the pay-by time and the payment link again instead.
 */
export function buildTableBookingRescheduledEmail(
  input: BookingFacts & {
    /** The booking's status, lower case. Only 'confirmed' earns "still confirmed". */
    status: string
    isOutsideSeating?: boolean | null
    highChairCount?: number | null
    manageLink?: string | null
    /** What the booking said before this change. Left out when it is not known. */
    previousStartDateTime?: string | null
    previousPartySize?: number | null
    /** Set when a deposit is still owed, which is what makes this booking not confirmed. */
    deposit?:
      | (DepositTermsFacts & {
          /** "£160.00", as the deposit request stated it. */
          depositLabel: string
          paymentLink?: string | null
        })
      | null
  }
): TableBookingEmail {
  const isOutside = Boolean(input.isOutsideSeating)
  const bookingNoun = isOutside ? 'outside booking' : 'table booking'
  const highChairs = Math.max(0, Math.floor(Number(input.highChairCount ?? 0)) || 0)
  const moment = formatBookingMomentForEmail(input.bookingDate, input.bookingTime, input.startDateTime)
  const party = partySizeLabel(input.partySize)
  const previousMoment = input.previousStartDateTime
    ? formatBookingMomentForEmail(null, null, input.previousStartDateTime)
    : null
  const previousParty = partySizeLabel(input.previousPartySize)
  const isConfirmed = input.status === 'confirmed'
  const deposit = input.deposit ?? null

  const wasLine = (() => {
    const changed: string[] = []
    if (previousMoment && previousMoment !== moment) changed.push(previousMoment)
    if (previousParty && previousParty !== party) changed.push(previousParty)
    return changed.length > 0 ? `It was ${changed.join(', ')}.` : null
  })()

  return renderTableBookingEmail({
    subject: 'Your booking at The Anchor has been updated',
    preheader: moment ? `Now ${moment}${party ? `, ${party}` : ''}` : 'Your booking has been updated',
    heading: 'Your booking has been updated',
    opening: [
      `Hi ${input.firstName}, your ${bookingNoun} is now${party ? ` for ${party}` : ''}` +
        `${moment ? ` on ${moment}` : ''}.`,
      ...(wasLine ? [wasLine] : []),
    ],
    details: [
      ...bookingDetailRows(input),
      { label: 'High chair reserved', value: highChairs > 0 ? `x${highChairs}` : null },
      { label: 'Seating', value: isOutside ? 'Outside (weather permitting)' : null },
      ...(deposit ? [{ label: 'Deposit', value: deposit.depositLabel }] : []),
    ],
    closing: isConfirmed
      ? [`Your ${bookingNoun} is still confirmed.`]
      : [
          `Your ${bookingNoun} is not confirmed yet: we still need your deposit of ${
            deposit?.depositLabel ?? 'the deposit'
          }.`,
          ...(deposit ? depositTerms(deposit) : []),
        ],
    cta: !isConfirmed && deposit?.paymentLink
      ? { label: 'Pay your deposit', url: deposit.paymentLink }
      : input.manageLink
        ? { label: 'Manage your booking', url: input.manageLink }
        : undefined,
    beforeContact: ['If this does not look right, tell us.'],
  })
}

/**
 * The seasonal pre-order chase. The text says "we still need the food choices for your booking
 * on {moment}. Every guest needs a main course. Choose here: {link}"; the email names the season
 * and the booking date in its subject, says what each guest's course tier still needs, and gives
 * the deadline the sweep is chasing.
 */
export function buildTableBookingPreorderReminderEmail(
  input: BookingFacts & {
    manageLink: string
    /** The booking period's name, e.g. "Christmas 2026". Named in the subject when known. */
    periodName?: string | null
    /** The per-guest course tiers, so the wording matches the rule being chased. */
    courseCounts?: number[] | null
    /** The period's `preorder_cutoff_days`. */
    preorderCutoffDays?: number | null
    /** When the pre-order form locks, as an ISO instant (`getPreorderCutoff().closesAt`). */
    preorderClosesAtIso?: string | null
  }
): TableBookingEmail {
  const moment = formatBookingMomentForEmail(input.bookingDate, input.bookingTime, input.startDateTime)
  const date = formatBookingDateForEmail(input.bookingDate, input.startDateTime)
  const reference = input.bookingReference ? ` (reference ${input.bookingReference})` : ''
  const season = input.periodName?.trim() || null

  const subject = [
    season ? `${season} food choices` : 'Your food choices',
    date ? `for ${date}` : null,
    !date && input.bookingReference ? `for ${input.bookingReference}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ')

  return renderTableBookingEmail({
    subject,
    preheader: moment ? `We still need your food choices for ${moment}` : 'We still need your food choices',
    heading: season ? `Your ${season} food choices` : 'Your food choices',
    opening: [
      `Hi ${input.firstName}, we still need the food choices for your booking at The Anchor` +
        `${moment ? ` on ${moment}` : ''}${reference}.`,
      ...describePreorderCourseRequirement(input.courseCounts),
      ...describePreorderDeadline({
        cutoffDays: input.preorderCutoffDays,
        closesAtIso: input.preorderClosesAtIso,
      }),
    ],
    details: bookingDetailRows(input),
    cta: { label: 'Choose your food', url: input.manageLink },
    afterCta: [`Prefer to do it over the telephone? Ring us on ${GUEST_CONTACT.phoneDisplay}.`],
    beforeContact: [],
  })
}

/**
 * "Are you still coming?", the day before. The text says "your table for 4 is {moment}. Still
 * coming? Tap to confirm or cancel: {link}". The email carries the same question and the same
 * link, which opens a page that only asks: confirming or cancelling takes a tap on that page,
 * so a mail scanner that follows the link cannot answer for the guest.
 */
export function buildTableBookingConfirmReminderEmail(input: BookingFacts & { confirmUrl: string }): TableBookingEmail {
  const date = formatBookingDateForEmail(input.bookingDate, input.startDateTime)
  const moment = formatBookingMomentForEmail(input.bookingDate, input.bookingTime, input.startDateTime)
  const party = partySizeLabel(input.partySize)

  return renderTableBookingEmail({
    subject: date ? `Are you still coming? Your table at The Anchor on ${date}` : 'Are you still coming? Your table at The Anchor',
    preheader: moment ? `Confirm or cancel your table for ${moment}` : 'Confirm or cancel your table',
    heading: 'Are you still coming?',
    opening: [
      `Hi ${input.firstName}, your table${party ? ` for ${party}` : ''}${moment ? ` is booked for ${moment}` : ' is booked'}.`,
      'Still coming? Tap the link to confirm or cancel.',
    ],
    details: bookingDetailRows(input),
    cta: { label: 'Confirm or cancel your booking', url: input.confirmUrl },
    beforeContact: ['If you need to change anything, let us know.'],
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
    preheader: date ? `Your booking on ${date} has been cancelled` : 'Your booking has been cancelled',
    heading: 'Your booking has been cancelled',
    opening: [
      date
        ? `Hi ${input.firstName}, your booking on ${date} has been cancelled.`
        : `Hi ${input.firstName}, your booking has been cancelled.`,
    ],
    details: bookingDetailRows(input),
    closing: [input.refundSentence],
    beforeContact: ['If this does not look right, tell us.'],
  })
}
