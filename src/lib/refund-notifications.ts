/**
 * "We have refunded you." Which refund, for what, and what happens next.
 *
 * WHAT WAS WRONG. The old version said only "We've initiated a refund of £160.00 to your
 * original payment method", and nothing else. A guest who has a table deposit, a private hire
 * deposit and an airport parking booking with us had no way of telling which one it was
 * about, or why. It named no booking and no date, gave no phone number and no address, told
 * the guest not to hesitate to contact us without saying how, and put the customer's name
 * into HTML unescaped. The email said "5 business days" while the text beside it said
 * "5 to 10 days", so the two versions of the same message disagreed.
 *
 * Worse, on a full parking refund the booking is cancelled too (`updateRefundStatus` in
 * `refundActions.ts`, so the space can be resold), and the guest was never told. Somebody
 * could have driven to Heathrow expecting a space.
 *
 * ONE SOURCE FOR THE CONTACT LINE. `guestContactHtmlBlock` and `guestContactTextLine` derive
 * the number from the company record, so nothing here is hand-copied.
 *
 * THE TIMING IS DELIBERATELY VAGUE AND DELIBERATELY THE SAME IN BOTH CHANNELS. "5 to 10 days"
 * is what the card schemes actually take; "5 business days" was a promise nobody here can
 * keep. The email and the text now say the same thing, because a guest may get both.
 */

import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  GUEST_EMAIL_SIGN_OFF,
  guestContactHtmlBlock,
  guestContactTextLine,
} from '@/lib/email/guest-footer'

export type NotificationStatus = 'email_sent' | 'sms_sent' | 'skipped' | 'failed'

/** Which booking the money came off. Decides how the refund is named. */
export type RefundSubject = 'table_booking' | 'private_booking' | 'parking'

export type RefundNotificationContext = {
  subject: RefundSubject
  /**
   * The date the booking is for. An ISO date (`2026-09-12`) or an ISO timestamp; parking
   * stores a timestamp, table and private bookings store a date.
   */
  bookingDate?: string | null
  /** A reference the guest can quote back at us, when the booking has one. */
  reference?: string | null
  /**
   * True when this refund also cancelled the booking. Parking does that on a full refund so
   * the space can be resold, and a guest who is not told would still turn up.
   */
  bookingCancelled?: boolean
}

interface RefundNotificationParams {
  customerId?: string | null
  customerName: string
  email: string | null
  phone: string | null
  amount: number
  /**
   * What the refund was for. Optional so a caller that genuinely does not know still sends a
   * usable email, which then names no booking rather than naming the wrong one.
   */
  context?: RefundNotificationContext
  parkingBookingId?: string | null
  privateBookingId?: string | null
  tableBookingId?: string | null
}

/** The payment timing, in the one wording both channels use. */
const REFUND_TIMING = 'It usually reaches your account in 5 to 10 days, depending on your bank.'

function formatAmount(amount: number): string {
  return `£${amount.toFixed(2)}`
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
 * "Saturday 12 September 2026", in London, whatever zone the server runs in.
 *
 * Two calls rather than one, the same as `formatBookingDateForEmail` in
 * `table-bookings/guest-emails.ts`: asking for the weekday in the same call as the rest gets
 * a comma after it from `en-GB`, which is not how the venue's emails read.
 *
 * A date-only value is anchored at midday UTC so neither zone can round it to the day before.
 */
function longDate(value: string): string | null {
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value)
  if (!Number.isFinite(parsed)) return null
  const instant = new Date(parsed)
  const weekday = formatDateInLondon(instant, { weekday: 'long' })
  const rest = formatDateInLondon(instant, { day: 'numeric', month: 'long', year: 'numeric' })
  return `${weekday} ${rest}`
}

const SUBJECT_NAMES: Record<RefundSubject, string> = {
  table_booking: 'your table booking',
  private_booking: 'your private booking',
  parking: 'your parking booking',
}

/**
 * "your table booking on Saturday 12 September 2026 (ANC-1234)", as much of it as we hold.
 *
 * Returns null when there is no context at all, so the copy can fall back to naming no
 * booking rather than inventing one.
 */
function describeBooking(context: RefundNotificationContext | undefined): string | null {
  if (!context) return null

  const parts = [SUBJECT_NAMES[context.subject]]
  const date = context.bookingDate ? longDate(context.bookingDate) : null
  if (date) parts.push(`on ${date}`)

  const reference = context.reference?.trim()
  const described = parts.join(' ')
  return reference ? `${described} (${reference})` : described
}

export type RefundCopy = { subject: string; html: string; text: string }

type RefundCopyInput = {
  customerName: string
  amount: number
  context?: RefundNotificationContext
}

function greetingName(customerName: string): string {
  return customerName.trim().split(/\s+/)[0] || 'there'
}

/**
 * The cancellation sentence, or null when nothing was cancelled.
 *
 * Parking gets its own wording because the consequence is physical: no space is being held,
 * and the guest is the only person who can do anything about that.
 */
function cancellationLine(context: RefundNotificationContext | undefined): string | null {
  if (!context?.bookingCancelled) return null
  return context.subject === 'parking'
    ? 'Your booking is cancelled, so no space is being held for you. If you still need parking, book again or give us a ring.'
    : 'Your booking is cancelled. If you would like to book again, give us a ring and we will sort it out.'
}

/** The body of the message, before the contact line and the sign-off. */
function refundBodyLines(input: RefundCopyInput): string[] {
  const amount = formatAmount(input.amount)
  const booking = describeBooking(input.context)

  const lines = [
    `Hi ${greetingName(input.customerName)},`,
    booking
      ? `We have refunded ${amount} for ${booking}.`
      : `We have refunded ${amount} to your original payment method.`,
    booking
      ? `It goes back to the card or account you paid with. ${REFUND_TIMING}`
      : REFUND_TIMING,
  ]

  const cancelled = cancellationLine(input.context)
  if (cancelled) lines.push(cancelled)

  return lines
}

/** Exported so a fixture render test can check the real strings a guest would receive. */
export function buildRefundEmail(input: RefundCopyInput): RefundCopy {
  const amount = formatAmount(input.amount)
  const bookingName = input.context ? SUBJECT_NAMES[input.context.subject] : null
  // Short enough to survive a phone's subject line, and specific enough that a guest with
  // several bookings can tell which one it is.
  const subject = bookingName
    ? `Refund of ${amount} for ${bookingName}`
    : `Refund of ${amount} from The Anchor`

  const bodyLines = refundBodyLines(input)

  const text = [...bodyLines, guestContactTextLine(), 'Thanks,', GUEST_EMAIL_SIGN_OFF].join('\n\n')

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#1f2937">',
    // Escaped, because the name is free text a member of staff typed and an apostrophe or an
    // ampersand in it used to land straight in the markup.
    ...bodyLines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`),
    guestContactHtmlBlock(),
    `<p style="margin:16px 0 0">Thanks,<br/>${escapeHtml(GUEST_EMAIL_SIGN_OFF)}</p>`,
    '</div>',
  ].join('')

  return { subject, html, text }
}

/**
 * The text version.
 *
 * No contact line, deliberately: this arrives from the venue's own number, so the guest can
 * already reply or ring back from the message itself, and every extra character is a real
 * cost per send. The email, which arrives from a no-reply address, carries the full block.
 */
export function buildRefundSmsBody(input: RefundCopyInput): string {
  const amount = formatAmount(input.amount)
  const booking = describeBooking(input.context)
  const cancelled = cancellationLine(input.context)

  return [
    `Hi ${greetingName(input.customerName)}, ${
      booking
        ? `we have refunded ${amount} for ${booking}`
        : `we have refunded ${amount} to your original payment method`
    }.`,
    REFUND_TIMING,
    ...(cancelled ? [cancelled] : []),
    GUEST_EMAIL_SIGN_OFF,
  ].join(' ')
}

export async function sendRefundNotification(
  params: RefundNotificationParams
): Promise<NotificationStatus> {
  // Try email first
  if (params.email) {
    const copy = buildRefundEmail(params)
    const emailResult = await sendEmail({
      to: params.email,
      subject: copy.subject,
      html: copy.html,
      text: copy.text,
      customerId: params.customerId ?? null,
      commType: 'refund_confirmation',
      requireLog: true,
      tableBookingId: params.tableBookingId ?? null,
      privateBookingId: params.privateBookingId ?? null,
      parkingBookingId: params.parkingBookingId ?? null,
      metadata: {
        template_key: 'refund_confirmation_email',
        refund_subject: params.context?.subject ?? null,
        booking_cancelled: params.context?.bookingCancelled === true,
      },
    })
    if (emailResult.success) return 'email_sent'
  }

  // Fall back to SMS
  if (params.phone) {
    const smsResult = await sendSMS(params.phone, buildRefundSmsBody(params), {})
    if (smsResult.success) return 'sms_sent'
  }

  // No contact info or both failed
  if (!params.email && !params.phone) return 'skipped'
  return 'failed'
}
