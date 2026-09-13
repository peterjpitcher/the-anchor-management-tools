import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/emailService'
import {
  GUEST_EMAIL_SIGN_OFF,
  guestContactHtmlBlock,
  guestContactTextLine,
} from '@/lib/email/guest-footer'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { buildGuestShortLink } from '@/lib/guest/guest-short-link'
import {
  buildEventArrivalLine,
  formatEventDateShortLondon,
  formatEventWhenLondon,
  resolveEventStartIso,
} from '@/lib/events/event-when'
import {
  resolveEventPriceAmount,
  resolveEventPaymentMode,
  resolveEventTicketPriceAmount,
} from '@/lib/events/pricing'
import { isEmailUsable } from '@/lib/notifications/channel'
import {
  buildTicketBreakdownLines,
  eventTicketTypesEnabled,
  type TicketBreakdownLine,
} from '@/lib/events/ticket-types'
import {
  bookingItemsAreMultiType,
  getDefaultTicketTypeId,
  loadBookingItemsWithTypes,
} from '@/lib/events/ticket-type-queries'
import { logger } from '@/lib/logger'

type EventEmailResult = { success: boolean; error?: string; messageId?: string; skipped?: boolean }

const DELIVERABLE_EMAIL_STATUSES = ['queued', 'sent', 'delivered', 'delivery_delayed', 'opened', 'clicked']

/**
 * Padding that stops the inbox preview spilling into the body copy, as the marketing shell does.
 * Zero-width characters only, so a client that ignores the hidden div shows nothing extra.
 */
const PREHEADER_PADDING = '&#8203;' + '&#847;'.repeat(56)

/**
 * 44px tall, the minimum tap target: 18px of line plus 13px of padding top and bottom. The old
 * buttons were 38px, which is under every platform's guidance and is the one control in a booking
 * email a guest has to hit on a phone.
 */
const BUTTON_STYLE = [
  'display:inline-block',
  'padding:13px 22px',
  'background:#111827',
  'color:#ffffff',
  'text-decoration:none',
  'border-radius:6px',
  'font-family:Arial,Helvetica,sans-serif',
  'font-size:16px',
  'line-height:18px',
  'font-weight:bold',
].join(';')

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatCurrency(amount: number | null | undefined, currency = 'GBP'): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
    }).format(amount)
  } catch {
    return `£${amount.toFixed(2)}`
  }
}

/** A money amount only when there is money in it: 0 and below are "no amount", never "£0.00". */
function formatPositiveCurrency(amount: number | null | undefined, currency = 'GBP'): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  return formatCurrency(amount, currency)
}

function ticketWord(seats: number): string {
  return seats === 1 ? 'ticket' : 'tickets'
}

/** The staff-facing reference for an event booking, as the customer record shows it. */
function bookingReference(bookingId: string): string {
  return bookingId.slice(0, 8).toUpperCase()
}

type GuestEmailParts = {
  subject: string
  html: string
  text: string
}

/**
 * The document every event guest email is wrapped in.
 *
 * The viewport meta stops a phone rendering it at desktop width, and the hidden preheader is the
 * line the inbox shows next to the subject. Without one, clients preview the first words of the
 * body, which on these templates was "Hi Pat,".
 */
function buildGuestEmailHtml(input: {
  title: string
  preheader: string
  heading: string
  /** Paragraphs of plain text, escaped here. */
  body: Array<string | null | undefined>
  /** Pre-built HTML (a ticket list), inserted after the paragraphs. */
  extraHtml?: string | null
  cta?: { href: string; label: string } | null
  footNote?: string | null
}): string {
  const paragraphs = input.body
    .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    .map((line) => `  <p style="margin:0 0 12px;font-size:16px;line-height:1.5">${escapeHtml(line)}</p>`)
    .join('\n')

  const cta = input.cta
    ? `  <p style="margin:20px 0"><a href="${escapeHtml(input.cta.href)}" style="${BUTTON_STYLE}">${escapeHtml(input.cta.label)}</a></p>`
    : ''

  const footNote = input.footNote
    ? `  <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(input.footNote)}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f9fafb">${escapeHtml(input.preheader)}${PREHEADER_PADDING}</div>
<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;padding:24px 20px;color:#111827">
  <h2 style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3">${escapeHtml(input.heading)}</h2>
${paragraphs}
${input.extraHtml ?? ''}
${cta}
${guestContactHtmlBlock()}
${footNote}
  <p style="margin:16px 0 0;font-size:16px;line-height:1.5">${escapeHtml(GUEST_EMAIL_SIGN_OFF)}</p>
</div>
</body>
</html>`
}

/**
 * The plain-text twin. Written rather than derived, because the text part is what staff read back
 * in the send log and what a text-only client shows, and it must carry the same phone number and
 * sign-off the render checks assert.
 */
function buildGuestEmailText(lines: Array<string | null | undefined>): string {
  const body = lines.filter((line): line is string => typeof line === 'string' && line.length > 0)
  return [...body, '', guestContactTextLine(), '', GUEST_EMAIL_SIGN_OFF].join('\n')
}

async function createManageLink(
  supabase: SupabaseClient<any, 'public', any>,
  context: {
    customerId: string
    bookingId: string
    eventStartIso: string | null
  },
  appBaseUrl?: string
): Promise<{ url: string; shortened: boolean } | null> {
  try {
    const manageToken = await createEventManageToken(supabase, {
      customerId: context.customerId,
      bookingId: context.bookingId,
      eventStartIso: context.eventStartIso,
      appBaseUrl,
    })
    // Shortened here rather than inside createEventManageToken, whose URL is also
    // returned to API callers. `shortened: false` means the guest got the full
    // length URL, which each caller records on the email's metadata row.
    return buildGuestShortLink({
      longUrl: manageToken.url,
      linkKind: 'event_manage',
      customerId: context.customerId,
      eventBookingId: context.bookingId,
    })
  } catch {
    return null
  }
}

type EventTicketEmailContext = {
  bookingId: string
  customerId: string
  email: string
  firstName: string
  bookingStatus: string | null
  eventName: string
  eventStartIso: string | null
  /** "Wednesday 16 September 2026 at 7pm", or null when the record has no usable date. */
  eventWhen: string | null
  /** "Wednesday 16 September", for subject lines. */
  eventDateShort: string | null
  /** The event's arrival time as stored, e.g. "18:30:00", or null when it carries none. */
  doorsTime: string | null
  /** "Arrive from 6:30pm for a 7pm start.", or null when the event carries no arrival time. */
  arrivalLine: string | null
  bookingUrl: string | null
  seats: number
  attendeeNames: string[]
  /** Per-type lines, populated only for genuinely multi-type bookings (else empty, legacy display). */
  ticketLines: TicketBreakdownLine[]
  paymentMode: string
  /** Per seat, at the door: the online discount never applies in the room. */
  doorPricePerSeat: number
  /** What one seat costs online, after any live discount. */
  onlinePricePerSeat: number
  bookingMode: string | null
  /** The seating this booking holds, not the event's mix. */
  seatingType: string | null
  isCashBingo: boolean
}

const CASH_BINGO_PATTERN = /cash\s*bingo/i

async function loadEventTicketEmailContext(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string,
  options?: { includeTicketLines?: boolean }
): Promise<EventTicketEmailContext | null> {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id,
      customer_id,
      seats,
      status,
      event_seating_type,
      attendee_names,
      customers!inner(id, first_name, email, email_status, email_deactivated_at),
      events!inner(
        id,
        name,
        event_type,
        start_datetime,
        date,
        time,
        doors_time,
        booking_url,
        booking_mode,
        payment_mode,
        price,
        price_per_seat,
        is_free,
        online_discount_type,
        online_discount_value,
        online_discount_ends_at,
        category:event_categories(name, slug)
      )
    `)
    .eq('id', bookingId)
    .maybeSingle()

  if (error || !booking) {
    logger.warn('Failed to load event ticket email context', {
      metadata: { bookingId, error: error?.message },
    })
    return null
  }

  const customerRaw = (booking as any).customers
  const eventRaw = (booking as any).events
  const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw
  const event = Array.isArray(eventRaw) ? eventRaw[0] : eventRaw
  const email = typeof customer?.email === 'string' ? customer.email.trim() : ''
  // An address that bounced, was marked invalid or complained about us, or was deactivated, is
  // not an address: sending to it damages the domain and reaches nobody. Callers that offer a
  // text instead read the `skipped` result and fall back.
  if (!email || !isEmailUsable(customer)) return null
  const eventStartIso = resolveEventStartIso(event)
  const categoryRaw = event?.category
  const category = Array.isArray(categoryRaw) ? categoryRaw[0] : categoryRaw

  let ticketLines: TicketBreakdownLine[] = []
  if (options?.includeTicketLines && eventTicketTypesEnabled() && event?.id) {
    try {
      const itemsByBooking = await loadBookingItemsWithTypes(supabase, [booking.id])
      const items = itemsByBooking.get(booking.id) ?? []
      if (items.length > 0) {
        const defaultTypeId = await getDefaultTicketTypeId(supabase, event.id)
        if (bookingItemsAreMultiType(items, defaultTypeId)) {
          ticketLines = buildTicketBreakdownLines(items)
        }
      }
    } catch {
      // Display-only enrichment, so fall back to the legacy flat attendee list.
      ticketLines = []
    }
  }

  const cashBingoCandidates = [event?.name, event?.event_type, category?.name, category?.slug]
    .filter((value): value is string => typeof value === 'string')

  return {
    bookingId: booking.id,
    customerId: customer.id,
    email,
    firstName: customer.first_name || 'there',
    bookingStatus: typeof (booking as any).status === 'string' ? (booking as any).status : null,
    eventName: event?.name || 'your event',
    eventStartIso,
    eventWhen: formatEventWhenLondon(eventStartIso),
    eventDateShort: formatEventDateShortLondon(eventStartIso),
    doorsTime: typeof event?.doors_time === 'string' ? event.doors_time : null,
    arrivalLine: buildEventArrivalLine({ doorsTime: event?.doors_time, startIso: eventStartIso }),
    bookingUrl: typeof event?.booking_url === 'string' && event.booking_url.trim() ? event.booking_url.trim() : null,
    seats: Math.max(1, Number((booking as any).seats || 1)),
    attendeeNames: Array.isArray((booking as any).attendee_names)
      ? ((booking as any).attendee_names as unknown[])
          .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
          .map((name) => name.trim())
      : [],
    ticketLines,
    paymentMode: resolveEventPaymentMode(event ?? {}),
    doorPricePerSeat: resolveEventTicketPriceAmount(event ?? {}),
    onlinePricePerSeat: resolveEventPriceAmount(event ?? {}),
    bookingMode: typeof event?.booking_mode === 'string' ? event.booking_mode : null,
    seatingType: typeof (booking as any).event_seating_type === 'string'
      ? (booking as any).event_seating_type
      : null,
    isCashBingo: cashBingoCandidates.some((value) => CASH_BINGO_PATTERN.test(value)),
  }
}

/** " on Wednesday 16 September 2026 at 7pm", or "" when the record has no usable date. */
function whenSuffix(context: EventTicketEmailContext): string {
  return context.eventWhen ? ` on ${context.eventWhen}` : ''
}

/** "Booking confirmed: Quiz Night, Wednesday 16 September". */
function subjectWithDate(prefix: string, context: EventTicketEmailContext, eventName?: string): string {
  const name = eventName || context.eventName
  return context.eventDateShort ? `${prefix}: ${name}, ${context.eventDateShort}` : `${prefix}: ${name}`
}

/** True when this booking holds a standing ticket rather than a seat at a table. */
function isStandingTicket(context: EventTicketEmailContext): boolean {
  return context.seatingType === 'standing'
}

/**
 * What the guest is coming to, beyond the date: the arrival time, whether the seating is shared,
 * and whether a standing ticket includes a seat. Never promises a table.
 */
function buildAttendanceLines(context: EventTicketEmailContext): string[] {
  const lines: string[] = []
  if (context.arrivalLine) lines.push(context.arrivalLine)
  if (context.bookingMode === 'communal') {
    lines.push('Seating is shared on the night, so there is no reserved table for your group.')
  }
  if (isStandingTicket(context)) {
    lines.push('Your ticket is a standing ticket, so it does not include a table seat.')
  }
  return lines
}

/**
 * What to pay and how, taken from the event record's payment mode.
 *
 * `cash_only` means cash in the room on the night. Cash bingo adds its own two rules, and both
 * halves of the age rule are published together or not at all (SSOT section 10).
 */
function buildPaymentLines(context: EventTicketEmailContext): string[] {
  const lines: string[] = []
  const priceText = formatPositiveCurrency(context.doorPricePerSeat)

  if (context.paymentMode === 'cash_only') {
    lines.push(priceText
      ? `Pay on the night: ${priceText} per person, cash only.`
      : 'Pay on the night, cash only.')
  } else if (context.paymentMode === 'free') {
    lines.push('There is nothing to pay for your place.')
  }

  if (context.isCashBingo) {
    lines.push('Books and daubers are cash only: £10 a book and £1 a dauber.')
    lines.push('It is 18+ to play. Supervised under-18s are welcome to come along, but cannot play.')
  }

  return lines
}

/**
 * The cancellation and refund bands, for a booking with money in it.
 *
 * Recorded in SSOT section 7 and applied by `calculateRefundTier`: full 7 or more days before,
 * half 3 to 6 days before, none inside 3 days, and a night we cancel refunded in full. Guest
 * cancelling was removed from the manage-booking page, so the only route is the phone.
 */
function buildCancellationTermsLines(): string[] {
  return [
    `Need to cancel? Call ${GUEST_CONTACT.phoneDisplay}.`,
    'Give up your seats 7 or more days before the event and we refund in full. Between 3 and 6 days before, we refund half. Inside 3 days there is no refund. If we cancel the night, you get a full refund.',
  ]
}

function buildTicketBreakdownText(context: EventTicketEmailContext): string | null {
  if (context.ticketLines.length > 0) {
    return `\nTickets:\n${context.ticketLines
      .map((line) => {
        const priceText = line.unitPrice > 0 ? ` at ${formatCurrency(line.unitPrice)} each` : ''
        return [
          `${line.quantity} x ${line.typeName}${priceText}`,
          ...line.attendeeNames.map((name) => `  - ${name}`),
        ].join('\n')
      })
      .join('\n')}`
  }
  if (context.attendeeNames.length > 0) {
    return `\nTickets:\n${context.attendeeNames.map((name, index) => `${index + 1}. ${name}`).join('\n')}`
  }
  return null
}

function buildTicketBreakdownHtml(context: EventTicketEmailContext): string | null {
  if (context.ticketLines.length > 0) {
    return `  <p style="margin:0 0 4px;font-size:16px"><strong>Tickets</strong></p>
  ${context.ticketLines
    .map((line) => {
      const priceText = line.unitPrice > 0 ? ` at ${formatCurrency(line.unitPrice)} each` : ''
      const names = line.attendeeNames.length > 0
        ? `<ul style="margin:2px 0 8px">${line.attendeeNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`
        : ''
      return `<p style="margin:0 0 2px;font-size:16px">${escapeHtml(`${line.quantity} x ${line.typeName}${priceText}`)}</p>${names}`
    })
    .join('\n  ')}`
  }
  if (context.attendeeNames.length > 0) {
    return `  <p style="margin:0 0 4px;font-size:16px"><strong>Tickets</strong></p>
  <ol style="margin:0 0 12px;font-size:16px">${context.attendeeNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ol>`
  }
  return null
}

async function hasSuccessfulEventEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    commType: string
    metadataContains?: Record<string, unknown>
  }
): Promise<boolean> {
  try {
    let query = (supabase.from('email_messages') as any)
      .select('id')
      .eq('event_booking_id', input.bookingId)
      .eq('comm_type', input.commType)
      .in('status', DELIVERABLE_EMAIL_STATUSES)

    if (input.metadataContains) {
      query = query.contains('metadata', input.metadataContains)
    }

    const { data, error } = await query
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn('Failed to check existing event email', {
        metadata: { bookingId: input.bookingId, commType: input.commType, error: error.message },
      })
      return false
    }

    return Boolean(data)
  } catch (error) {
    logger.warn('Event email duplicate check unavailable', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId, commType: input.commType },
    })
    return false
  }
}

export async function sendEventPaymentLinkEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    paymentLink: string
    holdExpiresAt?: string | null
    reminder?: boolean
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId, { includeTicketLines: true })
  if (!context) return { success: false, skipped: true }

  // Shortened here rather than in createEventPaymentToken, whose URL is also
  // returned to the API caller as next_step_url. The SMS on this path carries the
  // same long URL and is shortened at send time to the same destination, and
  // createShortLinkInternal dedupes on destination_url, so both channels end up
  // on one short code and one click count.
  const payment = await buildGuestShortLink({
    longUrl: input.paymentLink,
    linkKind: 'event_payment',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
  })

  const seatWord = ticketWord(context.seats)
  const heldVerb = context.seats === 1 ? 'is' : 'are'
  // The line items win when the booking has per-type prices; otherwise the event's online price
  // for the seats booked. No amount at all rather than a guessed one.
  const lineTotal = context.ticketLines.reduce((total, line) => total + line.quantity * line.unitPrice, 0)
  const amountDue = lineTotal > 0
    ? Number(lineTotal.toFixed(2))
    : Number((context.onlinePricePerSeat * context.seats).toFixed(2))
  const amountText = formatPositiveCurrency(amountDue)
  const holdExpiryWhen = input.holdExpiresAt ? formatEventWhenLondon(input.holdExpiresAt) : null
  const expiryText = holdExpiryWhen
    ? `We can hold them until ${holdExpiryWhen}.`
    : 'Your tickets are held for a limited time.'

  const heading = input.reminder ? 'Your tickets are still waiting' : 'Complete your event payment'
  const subject = subjectWithDate(input.reminder ? 'Reminder, complete your payment' : 'Complete your payment', context)
  const holdLine = `${context.seats} ${seatWord} ${heldVerb} held for ${context.eventName}${whenSuffix(context)}.`
  const amountLine = amountText ? `Total to pay: ${amountText}.` : null
  const body = [
    `Hi ${context.firstName},`,
    holdLine,
    amountLine,
    expiryText,
    context.arrivalLine,
    `Booking reference: ${bookingReference(context.bookingId)}.`,
  ]

  const text = buildGuestEmailText([
    ...body,
    '',
    `Pay securely here: ${payment.url}`,
  ])

  const html = buildGuestEmailHtml({
    title: heading,
    preheader: amountText
      ? `${amountText} to pay for ${context.eventName}.`
      : `Your tickets for ${context.eventName} are held until you pay.`,
    heading,
    body,
    cta: { href: payment.url, label: 'Pay securely' },
    footNote: 'This is a service message about your booking. We will not use abandoned payment details for marketing unless you have separately opted in.',
  })

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject,
    text,
    html,
    commType: input.reminder ? 'event_payment_reminder' : 'event_payment_link',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: input.reminder ? 'event_payment_reminder_email' : 'event_payment_link_email',
      // The URL the guest actually received, not the one we were handed.
      payment_link: payment.url,
      short_link_fallback: !payment.shortened,
      amount_due: amountText ? amountDue : null,
    },
  })
}

/**
 * The confirmation for a booking with nothing to pay online: a free night, or one paid for in the
 * room. Thirteen of the fifteen events on the books are one of those, and until now their guests
 * got a text and no email at all, while the website promised "we will send the booking
 * confirmation to you".
 */
export async function sendEventBookingConfirmedEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    appBaseUrl?: string
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId, { includeTicketLines: true })
  if (!context) return { success: false, skipped: true }

  const alreadySent = await hasSuccessfulEventEmail(supabase, {
    bookingId: input.bookingId,
    commType: 'event_booking_confirmed',
  })
  if (alreadySent) return { success: true, skipped: true }

  const manageResult = await createManageLink(supabase, context, input.appBaseUrl)
  const manageLink = manageResult?.url ?? null
  const seatWord = ticketWord(context.seats)
  const heading = 'You are booked in'
  const subject = subjectWithDate('Booking confirmed', context)
  const bookedLine = `You are booked in for ${context.eventName}${whenSuffix(context)}, with ${context.seats} ${seatWord} in your name.`

  const body = [
    `Hi ${context.firstName},`,
    bookedLine,
    ...buildAttendanceLines(context),
    ...buildPaymentLines(context),
    `Booking reference: ${bookingReference(context.bookingId)}.`,
    `Need to change or cancel your booking? Call ${GUEST_CONTACT.phoneDisplay}.`,
  ]

  const text = buildGuestEmailText([
    ...body,
    buildTicketBreakdownText(context),
    manageLink ? `View your booking here: ${manageLink}` : null,
  ])

  const html = buildGuestEmailHtml({
    title: heading,
    preheader: context.eventDateShort
      ? `${context.eventName}, ${context.eventDateShort}. ${context.seats} ${seatWord} booked.`
      : `${context.eventName}. ${context.seats} ${seatWord} booked.`,
    heading,
    body,
    extraHtml: buildTicketBreakdownHtml(context),
    cta: manageLink ? { href: manageLink, label: 'View your booking' } : null,
    footNote: 'This is a service message about your booking.',
  })

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject,
    text,
    html,
    commType: 'event_booking_confirmed',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_booking_confirmed_email',
      payment_mode: context.paymentMode,
      booking_mode: context.bookingMode,
      seats: context.seats,
      manage_link_included: Boolean(manageLink),
      short_link_fallback: manageResult?.shortened === false,
    },
  })
}

export async function sendEventPaymentConfirmationEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    amount?: number | null
    currency?: string | null
    appBaseUrl?: string
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId, { includeTicketLines: true })
  if (!context) return { success: false, skipped: true }

  const alreadySent = await hasSuccessfulEventEmail(supabase, {
    bookingId: input.bookingId,
    commType: 'event_payment_confirmation',
  })
  if (alreadySent) return { success: true, skipped: true }

  const seatWord = ticketWord(context.seats)
  // A comped booking is paid at zero. It has no payment sentence at all, rather than being told
  // we received a payment of £0.00.
  const amountText = formatPositiveCurrency(input.amount ?? null, input.currency || 'GBP')
  const manageResult = await createManageLink(supabase, context, input.appBaseUrl)
  const manageLink = manageResult?.url ?? null

  const heading = 'Your booking is confirmed'
  const subject = subjectWithDate('Booking confirmed', context)
  const paidLine = amountText ? `We have received your ${amountText} payment.` : null
  const confirmedLine = `Your booking for ${context.eventName}${whenSuffix(context)} is confirmed for ${context.seats} ${seatWord}.`

  const body = [
    `Hi ${context.firstName},`,
    paidLine,
    confirmedLine,
    ...buildAttendanceLines(context),
    ...(context.isCashBingo ? buildPaymentLines(context).filter((line) => !line.startsWith('Pay on the night')) : []),
    `Booking reference: ${bookingReference(context.bookingId)}.`,
    ...(amountText ? buildCancellationTermsLines() : [`Need to change or cancel your booking? Call ${GUEST_CONTACT.phoneDisplay}.`]),
  ]

  const text = buildGuestEmailText([
    ...body,
    buildTicketBreakdownText(context),
    manageLink ? `Manage your booking here: ${manageLink}` : null,
  ])

  const html = buildGuestEmailHtml({
    title: heading,
    preheader: context.eventDateShort
      ? `${context.eventName}, ${context.eventDateShort}. ${context.seats} ${seatWord} confirmed.`
      : `${context.eventName}. ${context.seats} ${seatWord} confirmed.`,
    heading,
    body,
    extraHtml: buildTicketBreakdownHtml(context),
    cta: manageLink ? { href: manageLink, label: 'Manage booking' } : null,
    footNote: 'This is a service message about your booking.',
  })

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject,
    text,
    html,
    commType: 'event_payment_confirmation',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_payment_confirmation_email',
      amount: input.amount ?? null,
      currency: input.currency || 'GBP',
      manage_link_included: Boolean(manageLink),
      short_link_fallback: manageResult?.shortened === false,
    },
  })
}

export async function sendEventPaymentManualReviewEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    amount?: number | null
    currency?: string | null
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const alreadySent = await hasSuccessfulEventEmail(supabase, {
    bookingId: input.bookingId,
    commType: 'event_payment_manual_review',
  })
  if (alreadySent) return { success: true, skipped: true }

  const amountText = formatPositiveCurrency(input.amount ?? null, input.currency || 'GBP')
  const heading = 'Payment received'
  const body = [
    `Hi ${context.firstName},`,
    amountText ? `We have received your ${amountText} payment.` : null,
    `Staff need to check your booking for ${context.eventName}${whenSuffix(context)} before we can confirm the tickets.`,
    'We will contact you shortly. You do not need to pay again.',
    `Booking reference: ${bookingReference(context.bookingId)}.`,
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: subjectWithDate('Payment received', context),
    text: buildGuestEmailText(body),
    html: buildGuestEmailHtml({
      title: heading,
      preheader: `We are checking your booking for ${context.eventName}.`,
      heading,
      body,
      footNote: 'This is a service message about your booking.',
    }),
    commType: 'event_payment_manual_review',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_payment_manual_review_email',
      amount: input.amount ?? null,
      currency: input.currency || 'GBP',
    },
  })
}

export async function sendEventPaymentExpiredEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const alreadySent = await hasSuccessfulEventEmail(supabase, {
    bookingId: input.bookingId,
    commType: 'event_payment_expired',
  })
  if (alreadySent) return { success: true, skipped: true }

  const seatWord = ticketWord(context.seats)
  const releaseVerb = context.seats === 1 ? 'has' : 'have'
  const heading = 'Payment hold released'
  const body = [
    `Hi ${context.firstName},`,
    `Your held ${seatWord} for ${context.eventName}${whenSuffix(context)} ${releaseVerb} been released, because payment was not completed in time.`,
    context.bookingUrl
      ? 'If you would still like to come, please rebook while tickets are available.'
      : 'If you would still like to come, call us and we will check availability.',
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: subjectWithDate('Payment hold released', context),
    text: buildGuestEmailText([
      ...body,
      context.bookingUrl ? `Rebook here: ${context.bookingUrl}` : null,
    ]),
    html: buildGuestEmailHtml({
      title: heading,
      preheader: `Your ${seatWord} for ${context.eventName} ${releaseVerb} been released.`,
      heading,
      body,
      cta: context.bookingUrl ? { href: context.bookingUrl, label: 'Rebook tickets' } : null,
      footNote: 'This is a service message about your booking.',
    }),
    commType: 'event_payment_expired',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_payment_expired_email',
    },
  })
}

/**
 * The refund sentence on a cancellation, or nothing at all.
 *
 * Zero is not an amount. Guests who had never paid a penny were told "Refund amount: £0.00",
 * because callers passed 0 where they meant "no refund", and the two branches below it could
 * never be reached. `paymentTaken: false` is the free and pay-on-the-night case, which has no
 * refund sentence to write.
 */
function buildRefundEmailLine(input: {
  refundStatus?: string | null
  refundAmount?: number | null
  currency?: string | null
  reason?: string | null
  /** True when money was actually taken for this booking. */
  paymentTaken?: boolean
}): string | null {
  const amountText = formatPositiveCurrency(input.refundAmount ?? null, input.currency || 'GBP')

  if (amountText) {
    if (input.refundStatus === 'succeeded') {
      return `A refund of ${amountText} has been issued to your original payment method.`
    }
    if (input.refundStatus === 'pending') {
      return `A refund of ${amountText} is being processed to your original payment method.`
    }
    if (input.refundStatus === 'manual_required' || input.refundStatus === 'failed') {
      return `A refund of ${amountText} needs staff follow-up. We will contact you if we need anything else.`
    }
    return `A refund of ${amountText} is on its way to your original payment method.`
  }

  if (input.paymentTaken === false) return null

  if (input.reason === 'event_cancelled') {
    return 'A night we cancel is refunded in full, so if you paid for tickets we will put that back on your original payment method.'
  }

  return 'No refund is due under the event cancellation policy.'
}

export async function sendEventBookingCancelledEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    refundStatus?: string | null
    refundAmount?: number | null
    currency?: string | null
    reason?: 'guest_cancel' | 'staff_cancel' | 'event_cancelled' | string | null
    /** True when money was taken for this booking, so a refund sentence has something to say. */
    paymentTaken?: boolean
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const alreadySent = await hasSuccessfulEventEmail(supabase, {
    bookingId: input.bookingId,
    commType: 'event_booking_cancelled',
  })
  if (alreadySent) return { success: true, skipped: true }

  const seatWord = ticketWord(context.seats)
  const refundLine = buildRefundEmailLine(input)
  // A night the pub cancels is not one booking being cancelled, and it read as though the guest
  // had lost their table while the event went ahead.
  const eventCancelled = input.reason === 'event_cancelled'
  const heading = eventCancelled ? 'We have had to cancel this event' : 'Booking cancelled'
  const openingLine = eventCancelled
    ? `We've had to cancel ${context.eventName}${whenSuffix(context)}, and we are sorry for the disappointment.`
    : `Your booking for ${context.eventName}${whenSuffix(context)} has been cancelled (${context.seats} ${seatWord}).`

  const body = [
    `Hi ${context.firstName},`,
    openingLine,
    refundLine,
    `Booking reference: ${bookingReference(context.bookingId)}.`,
    eventCancelled
      ? 'We would love to see you at another night, and we are happy to help you pick one.'
      : null,
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: subjectWithDate(eventCancelled ? 'Event cancelled' : 'Booking cancelled', context),
    text: buildGuestEmailText(body),
    html: buildGuestEmailHtml({
      title: heading,
      preheader: eventCancelled
        ? `${context.eventName} is off${context.eventDateShort ? ` on ${context.eventDateShort}` : ''}.`
        : `Your ${seatWord} for ${context.eventName} have been cancelled.`,
      heading,
      body,
      footNote: 'This is a service message about your booking.',
    }),
    commType: 'event_booking_cancelled',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_booking_cancelled_email',
      refund_status: input.refundStatus ?? null,
      refund_amount: input.refundAmount ?? null,
      currency: input.currency || 'GBP',
      reason: input.reason ?? null,
      payment_taken: input.paymentTaken ?? null,
    },
  })
}

export async function sendEventRefundStatusUpdateEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    outcome: 'completed' | 'failed'
    amount?: number | null
    currency?: string | null
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const amountText = formatPositiveCurrency(input.amount ?? null, input.currency || 'GBP')
  const heading = input.outcome === 'completed' ? 'Refund processed' : 'Refund update'
  const line = input.outcome === 'completed'
    ? `Your refund${amountText ? ` of ${amountText}` : ''} for ${context.eventName} has now been processed to your original payment method.`
    : `Something went wrong when we tried to process your refund${amountText ? ` of ${amountText}` : ''} for ${context.eventName}. We are sorting it out and will be in touch.`
  const body = [
    `Hi ${context.firstName},`,
    line,
    `Booking reference: ${bookingReference(context.bookingId)}.`,
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: subjectWithDate(input.outcome === 'completed' ? 'Refund processed' : 'Refund update', context),
    text: buildGuestEmailText(body),
    html: buildGuestEmailHtml({
      title: heading,
      preheader: input.outcome === 'completed'
        ? `Your refund for ${context.eventName} has been processed.`
        : `We are still working on your refund for ${context.eventName}.`,
      heading,
      body,
      footNote: 'This is a service message about your booking.',
    }),
    commType: 'event_refund_update',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_refund_update_email',
      refund_outcome: input.outcome,
      refund_amount: input.amount ?? null,
      currency: input.currency || 'GBP',
    },
  })
}

export async function sendEventTicketTransferredEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    fromEventName: string
    toEventName: string
    /** The old event's start, so a move between two Quiz Nights says which is which. */
    fromEventStartIso?: string | null
    eventStartIso?: string | null
    appBaseUrl?: string
    overpayment?: number
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const alreadySent = await hasSuccessfulEventEmail(supabase, {
    bookingId: input.bookingId,
    commType: 'event_ticket_transferred',
  })
  if (alreadySent) return { success: true, skipped: true }

  const newStartIso = input.eventStartIso || context.eventStartIso
  const manageResult = await createManageLink(supabase, {
    ...context,
    eventStartIso: newStartIso,
  }, input.appBaseUrl)
  const manageLink = manageResult?.url ?? null
  const newWhen = formatEventWhenLondon(newStartIso) ?? context.eventWhen
  const oldWhen = formatEventWhenLondon(input.fromEventStartIso ?? null)
  const seatWord = ticketWord(context.seats)
  const haveWord = context.seats === 1 ? 'has' : 'have'
  // Two months of the same recurring night are both called "Quiz Night", so the names alone read
  // as "transferred from Quiz Night to Quiz Night". The dates are what tell them apart.
  const fromText = oldWhen ? `${input.fromEventName} on ${oldWhen}` : input.fromEventName
  const toText = newWhen ? `${input.toEventName} on ${newWhen}` : input.toEventName
  const heading = context.seats === 1 ? 'Your ticket has moved' : 'Your tickets have moved'
  const overpaymentText = typeof input.overpayment === 'number'
    ? formatPositiveCurrency(input.overpayment)
    : null

  const body = [
    `Hi ${context.firstName},`,
    `Your ${seatWord} ${haveWord} been moved from ${fromText} to ${toText}.`,
    overpaymentText ? `The new night costs less, so we owe you ${overpaymentText} and will be in touch about your refund.` : null,
    ...buildAttendanceLines(context),
    `Booking reference: ${bookingReference(context.bookingId)}.`,
    `If the new night does not suit you, call ${GUEST_CONTACT.phoneDisplay}.`,
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: subjectWithDate(
      context.seats === 1 ? 'Ticket transferred' : 'Tickets transferred',
      context,
      input.toEventName
    ),
    text: buildGuestEmailText([
      ...body,
      manageLink ? `Manage your booking here: ${manageLink}` : null,
    ]),
    html: buildGuestEmailHtml({
      title: heading,
      preheader: newWhen
        ? `You are now booked for ${input.toEventName} on ${newWhen}.`
        : `You are now booked for ${input.toEventName}.`,
      heading,
      body,
      cta: manageLink ? { href: manageLink, label: 'Manage booking' } : null,
      footNote: 'This is a service message about your booking.',
    }),
    commType: 'event_ticket_transferred',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_ticket_transferred_email',
      from_event_name: input.fromEventName,
      from_event_start: input.fromEventStartIso ?? null,
      to_event_name: input.toEventName,
      manage_link_included: Boolean(manageLink),
      short_link_fallback: manageResult?.shortened === false,
      overpayment: typeof input.overpayment === 'number' && input.overpayment > 0 ? input.overpayment : undefined,
    },
  })
}

/** What a guest's place is worth after a move, in the words that match how they paid. */
function buildRescheduledTicketLine(context: EventTicketEmailContext): string {
  if (context.bookingStatus === 'pending_payment') {
    return context.seats === 1
      ? 'We are still holding your ticket, and it carries over to the new date.'
      : 'We are still holding your tickets, and they carry over to the new date.'
  }
  if (context.paymentMode === 'prepaid') {
    return context.seats === 1
      ? 'Your ticket remains valid for the new date.'
      : 'Your tickets remain valid for the new date.'
  }
  return 'Your booking moves to the new date, so there is nothing you need to do.'
}

export async function sendEventRescheduledEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    eventName: string
    oldDate?: string | null
    oldTime?: string | null
    newDate: string
    newTime: string
    appBaseUrl?: string
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const metadataMatch = {
    old_date: input.oldDate ?? null,
    old_time: input.oldTime ?? null,
    new_date: input.newDate,
    new_time: input.newTime,
  }
  const alreadySent = await hasSuccessfulEventEmail(supabase, {
    bookingId: input.bookingId,
    commType: 'event_rescheduled',
    metadataContains: metadataMatch,
  })
  if (alreadySent) return { success: true, skipped: true }

  // A London wall time, so it goes through whenLondonClockReaches. Parsing it directly made a
  // production server read 7pm as UTC and announce a British Summer Time event an hour late.
  const newStartIso = resolveEventStartIso({ date: input.newDate, time: input.newTime })
  const oldStartIso = input.oldDate
    ? resolveEventStartIso({ date: input.oldDate, time: input.oldTime })
    : null
  const manageResult = await createManageLink(supabase, {
    ...context,
    eventStartIso: newStartIso,
  }, input.appBaseUrl)
  const manageLink = manageResult?.url ?? null

  const eventName = input.eventName || context.eventName
  const newWhen = formatEventWhenLondon(newStartIso)
  const oldWhen = formatEventWhenLondon(oldStartIso)
  const sameDay = Boolean(input.oldDate) && input.oldDate === input.newDate
  const newArrivalLine = buildEventArrivalLine({
    doorsTime: context.doorsTime,
    startIso: newStartIso,
  })

  const changeLine = oldWhen && newWhen
    ? (sameDay
      ? `${eventName} still runs on the same day, but the start has moved from ${oldWhen} to ${newWhen}.`
      : `${eventName} has moved from ${oldWhen} to ${newWhen}.`)
    : newWhen
      ? `${eventName} has been rescheduled to ${newWhen}.`
      : `${eventName} has been rescheduled, and we will confirm the new time with you.`

  const heading = 'Your event has moved'
  const subjectDate = formatEventDateShortLondon(newStartIso)
  const subject = subjectDate
    ? `Event rescheduled: ${eventName}, now ${subjectDate}`
    : `Event rescheduled: ${eventName}`

  const body = [
    `Hi ${context.firstName},`,
    changeLine,
    buildRescheduledTicketLine(context),
    newArrivalLine,
    `Booking reference: ${bookingReference(context.bookingId)}.`,
    // Guest cancelling was removed from the manage-booking page, which now tells guests to ring,
    // so pointing them at the link for a cancellation sent them to a dead end.
    `If the new date does not work for you, call ${GUEST_CONTACT.phoneDisplay} and we will cancel your booking.`,
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject,
    text: buildGuestEmailText([
      ...body,
      manageLink ? `View your booking here: ${manageLink}` : null,
    ]),
    html: buildGuestEmailHtml({
      title: heading,
      preheader: newWhen ? `${eventName} is now ${newWhen}.` : `${eventName} has been rescheduled.`,
      heading,
      body,
      cta: manageLink ? { href: manageLink, label: 'View your booking' } : null,
      footNote: 'This is a service message about your booking.',
    }),
    commType: 'event_rescheduled',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_rescheduled_email',
      ...metadataMatch,
      manage_link_included: Boolean(manageLink),
      short_link_fallback: manageResult?.shortened === false,
    },
  })
}

export async function sendEventPostponedEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    eventName?: string | null
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const alreadySent = await hasSuccessfulEventEmail(supabase, {
    bookingId: input.bookingId,
    commType: 'event_postponed',
  })
  if (alreadySent) return { success: true, skipped: true }

  const eventName = input.eventName || context.eventName
  const heading = 'Your event has been postponed'
  // A refund is only on the table where money changed hands. A free night has nothing to refund,
  // and offering one invited a question nobody could answer.
  const paidForTickets = context.paymentMode === 'prepaid'
  const nextStepsLine = paidForTickets
    ? 'We will decide whether to hold your tickets for the new date, move them to another night, or refund you, and we will be in touch as soon as that is settled.'
    : 'We will be in touch with the new date as soon as it is settled, and your place carries over to it.'

  const body = [
    `Hi ${context.firstName},`,
    `${eventName}${whenSuffix(context)} has been postponed.`,
    nextStepsLine,
    'You do not need to do anything right now.',
    `Booking reference: ${bookingReference(context.bookingId)}.`,
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: subjectWithDate('Event postponed', context, eventName),
    text: buildGuestEmailText(body),
    html: buildGuestEmailHtml({
      title: heading,
      preheader: context.eventDateShort
        ? `${eventName} on ${context.eventDateShort} is not going ahead for now.`
        : `${eventName} is not going ahead for now.`,
      heading,
      body,
      footNote: 'This is a service message about your booking.',
    }),
    commType: 'event_postponed',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_postponed_email',
      payment_mode: context.paymentMode,
    },
  })
}
