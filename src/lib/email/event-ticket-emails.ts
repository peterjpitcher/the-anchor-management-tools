import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/emailService'
import { createEventManageToken } from '@/lib/events/manage-booking'
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

function formatLondonDateTime(value: string | null | undefined): string {
  if (!value) return 'your event time'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value))
  } catch {
    return 'your event time'
  }
}

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

function buildServiceMessageHtml(input: {
  heading: string
  body: string[]
  cta?: { href: string; label: string } | null
}): string {
  const cta = input.cta
    ? `<p><a href="${escapeHtml(input.cta.href)}" style="display: inline-block; padding: 10px 14px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px;">${escapeHtml(input.cta.label)}</a></p>`
    : ''

  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 620px; margin: 0 auto; color: #111827;">
  <h2 style="font-family: Arial, Helvetica, sans-serif;">${escapeHtml(input.heading)}</h2>
  ${input.body.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n  ')}
  ${cta}
  <p style="font-size: 13px; color: #6b7280;">This is a service message about your booking.</p>
  <p>The Anchor</p>
</div>`
}

async function createManageLink(
  supabase: SupabaseClient<any, 'public', any>,
  context: {
    customerId: string
    bookingId: string
    eventStartIso: string | null
  },
  appBaseUrl?: string
): Promise<string | null> {
  try {
    const manageToken = await createEventManageToken(supabase, {
      customerId: context.customerId,
      bookingId: context.bookingId,
      eventStartIso: context.eventStartIso,
      appBaseUrl,
    })
    return manageToken.url
  } catch {
    return null
  }
}

async function loadEventTicketEmailContext(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string,
  options?: { includeTicketLines?: boolean }
): Promise<{
  bookingId: string
  customerId: string
  email: string
  firstName: string
  eventName: string
  eventStart: string
  eventStartIso: string | null
  bookingUrl: string | null
  seats: number
  attendeeNames: string[]
  /** Per-type lines, populated only for genuinely multi-type bookings (else empty → legacy display). */
  ticketLines: TicketBreakdownLine[]
} | null> {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, customer_id, seats, attendee_names, customers!inner(id, first_name, email), events!inner(id, name, start_datetime, date, time, booking_url)')
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
  if (!email) return null
  const eventStartIso = event?.start_datetime || (event?.date ? `${event.date}T${event.time || '00:00'}:00` : null)

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
      // Display-only enrichment — fall back to the legacy flat attendee list.
      ticketLines = []
    }
  }

  return {
    bookingId: booking.id,
    customerId: customer.id,
    email,
    firstName: customer.first_name || 'there',
    eventName: event?.name || 'your event',
    eventStart: formatLondonDateTime(eventStartIso),
    eventStartIso,
    bookingUrl: typeof event?.booking_url === 'string' && event.booking_url.trim() ? event.booking_url.trim() : null,
    seats: Math.max(1, Number((booking as any).seats || 1)),
    attendeeNames: Array.isArray((booking as any).attendee_names)
      ? ((booking as any).attendee_names as unknown[])
          .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
          .map((name) => name.trim())
      : [],
    ticketLines,
  }
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
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const subject = input.reminder
    ? `Reminder: complete payment for ${context.eventName}`
    : `Complete payment for ${context.eventName}`
  const seatWord = context.seats === 1 ? 'ticket' : 'tickets'
  const expiryText = input.holdExpiresAt
    ? `Your hold expires at ${formatLondonDateTime(input.holdExpiresAt)}.`
    : 'Your tickets are held for a limited time.'
  const safeName = escapeHtml(context.firstName)
  const safeEventName = escapeHtml(context.eventName)
  const safePaymentLink = escapeHtml(input.paymentLink)
  const text = [
    `Hi ${context.firstName},`,
    '',
    `${context.seats} ${seatWord} are held for ${context.eventName} on ${context.eventStart}.`,
    expiryText,
    '',
    `Pay securely here: ${input.paymentLink}`,
    '',
    'The Anchor',
  ].join('\n')

  const html = `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 620px; margin: 0 auto; color: #111827;">
  <h2 style="font-family: Arial, Helvetica, sans-serif;">Complete your event payment</h2>
  <p>Hi ${safeName},</p>
  <p>${context.seats} ${seatWord} are held for <strong>${safeEventName}</strong> on ${escapeHtml(context.eventStart)}.</p>
  <p>${escapeHtml(expiryText)}</p>
  <p><a href="${safePaymentLink}" style="display: inline-block; padding: 10px 14px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px;">Pay securely</a></p>
  <p style="font-size: 13px; color: #6b7280;">This is a service message about your booking. We will not use abandoned payment details for marketing unless you have separately opted in.</p>
  <p>The Anchor</p>
</div>`

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
      payment_link: input.paymentLink,
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

  const seatWord = context.seats === 1 ? 'ticket' : 'tickets'
  const amountText = formatCurrency(input.amount ?? null, input.currency || 'GBP')
  const manageLink = await createManageLink(supabase, context, input.appBaseUrl)

  const subject = `Booking confirmed: ${context.eventName}`
  const safeName = escapeHtml(context.firstName)
  const safeEventName = escapeHtml(context.eventName)
  const safeManageLink = manageLink ? escapeHtml(manageLink) : null
  const paidLine = amountText
    ? `We have received your ${amountText} payment.`
    : 'We have received your payment.'
  const hasTicketBreakdown = context.ticketLines.length > 0
  const hasAttendeeNames = context.attendeeNames.length > 0
  const namesText = hasTicketBreakdown
    ? `\nTickets:\n${context.ticketLines
        .map((line) => {
          const priceText = line.unitPrice > 0 ? ` — ${formatCurrency(line.unitPrice)} each` : ''
          return [
            `${line.quantity} × ${line.typeName}${priceText}`,
            ...line.attendeeNames.map((name) => `  - ${name}`),
          ].join('\n')
        })
        .join('\n')}`
    : hasAttendeeNames
      ? `\nTickets:\n${context.attendeeNames.map((name, index) => `${index + 1}. ${name}`).join('\n')}`
      : ''
  const namesHtml = hasTicketBreakdown
    ? `<p style="margin-bottom: 4px;"><strong>Tickets</strong></p>
  ${context.ticketLines
    .map((line) => {
      const priceText = line.unitPrice > 0 ? ` — ${formatCurrency(line.unitPrice)} each` : ''
      const names = line.attendeeNames.length > 0
        ? `<ul style="margin: 2px 0 8px;">${line.attendeeNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`
        : ''
      return `<p style="margin: 0 0 2px;">${escapeHtml(`${line.quantity} × ${line.typeName}${priceText}`)}</p>${names}`
    })
    .join('\n  ')}`
    : hasAttendeeNames
      ? `<p style="margin-bottom: 4px;"><strong>Tickets</strong></p>
  <ol style="margin-top: 0;">${context.attendeeNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ol>`
      : ''
  const text = [
    `Hi ${context.firstName},`,
    '',
    `${paidLine} Your booking for ${context.eventName} on ${context.eventStart} is confirmed for ${context.seats} ${seatWord}.`,
    namesText || null,
    manageLink ? `Manage your booking here: ${manageLink}` : null,
    '',
    'The Anchor',
  ].filter(Boolean).join('\n')

  const html = `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 620px; margin: 0 auto; color: #111827;">
  <h2 style="font-family: Arial, Helvetica, sans-serif;">Your booking is confirmed</h2>
  <p>Hi ${safeName},</p>
  <p>${escapeHtml(paidLine)} Your booking for <strong>${safeEventName}</strong> on ${escapeHtml(context.eventStart)} is confirmed for ${context.seats} ${seatWord}.</p>
  ${namesHtml}
  ${safeManageLink ? `<p><a href="${safeManageLink}" style="display: inline-block; padding: 10px 14px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px;">Manage booking</a></p>` : ''}
  <p style="font-size: 13px; color: #6b7280;">This is a service message about your booking.</p>
  <p>The Anchor</p>
</div>`

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

  const amountText = formatCurrency(input.amount ?? null, input.currency || 'GBP')
  const paidLine = amountText
    ? `We have received your ${amountText} payment.`
    : 'We have received your payment.'
  const body = [
    `Hi ${context.firstName},`,
    `${paidLine} Staff need to check your booking for ${context.eventName} before we can confirm the tickets.`,
    'We will contact you shortly. You do not need to pay again.',
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: `Payment received: ${context.eventName}`,
    text: [...body, '', 'The Anchor'].join('\n'),
    html: buildServiceMessageHtml({
      heading: 'Payment received',
      body,
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

  const seatWord = context.seats === 1 ? 'ticket' : 'tickets'
  const releaseVerb = context.seats === 1 ? 'has' : 'have'
  const body = [
    `Hi ${context.firstName},`,
    `Your held ${seatWord} for ${context.eventName} on ${context.eventStart} ${releaseVerb} been released because payment was not completed in time.`,
    context.bookingUrl
      ? 'If you would still like to attend, please rebook while tickets are available.'
      : 'If you would still like to attend, please contact us and we can check availability.',
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: `Payment hold released: ${context.eventName}`,
    text: [
      ...body,
      context.bookingUrl ? `Rebook here: ${context.bookingUrl}` : null,
      '',
      'The Anchor',
    ].filter(Boolean).join('\n'),
    html: buildServiceMessageHtml({
      heading: 'Payment hold released',
      body,
      cta: context.bookingUrl ? { href: context.bookingUrl, label: 'Rebook tickets' } : null,
    }),
    commType: 'event_payment_expired',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_payment_expired_email',
    },
  })
}

function buildRefundEmailLine(input: {
  refundStatus?: string | null
  refundAmount?: number | null
  currency?: string | null
  reason?: string | null
}): string | null {
  const amountText = formatCurrency(input.refundAmount ?? null, input.currency || 'GBP')

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
    return `Refund amount: ${amountText}.`
  }

  if (input.reason === 'event_cancelled') {
    return 'If payment was taken, staff will check the refund position and contact you.'
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
  }
): Promise<EventEmailResult> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const alreadySent = await hasSuccessfulEventEmail(supabase, {
    bookingId: input.bookingId,
    commType: 'event_booking_cancelled',
  })
  if (alreadySent) return { success: true, skipped: true }

  const seatWord = context.seats === 1 ? 'ticket' : 'tickets'
  const refundLine = buildRefundEmailLine(input)
  const body = [
    `Hi ${context.firstName},`,
    `Your booking for ${context.eventName} on ${context.eventStart} has been cancelled (${context.seats} ${seatWord}).`,
    refundLine,
    'Reply to this email or contact us if you need help.',
  ].filter(Boolean) as string[]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: `Booking cancelled: ${context.eventName}`,
    text: [...body, '', 'The Anchor'].join('\n'),
    html: buildServiceMessageHtml({
      heading: 'Booking cancelled',
      body,
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

  const amountText = formatCurrency(input.amount ?? null, input.currency || 'GBP')
  const heading = input.outcome === 'completed' ? 'Refund processed' : 'Refund update'
  const line = input.outcome === 'completed'
    ? `Your refund${amountText ? ` of ${amountText}` : ''} for ${context.eventName} has now been processed to your original payment method.`
    : `We hit a snag processing your refund${amountText ? ` of ${amountText}` : ''} for ${context.eventName}. Our team is sorting it and will be in touch.`
  const body = [
    `Hi ${context.firstName},`,
    line,
    'Reply to this email or contact us if you need help.',
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: input.outcome === 'completed'
      ? `Refund processed: ${context.eventName}`
      : `Refund update: ${context.eventName}`,
    text: [...body, '', 'The Anchor'].join('\n'),
    html: buildServiceMessageHtml({ heading, body }),
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

  const manageLink = await createManageLink(supabase, {
    ...context,
    eventStartIso: input.eventStartIso || context.eventStartIso,
  }, input.appBaseUrl)
  const eventStart = input.eventStartIso ? formatLondonDateTime(input.eventStartIso) : context.eventStart
  const body = [
    `Hi ${context.firstName},`,
    `Your tickets have been transferred from ${input.fromEventName} to ${input.toEventName}.`,
    `The new event is on ${eventStart}.`,
    typeof input.overpayment === 'number' && input.overpayment > 0
      ? `We owe you £${input.overpayment.toFixed(2)} — we'll be in touch about your refund.`
      : null,
    manageLink ? 'You can manage the booking using the link below.' : null,
  ].filter(Boolean) as string[]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: `Tickets transferred: ${input.toEventName}`,
    text: [
      ...body,
      manageLink ? `Manage your booking here: ${manageLink}` : null,
      '',
      'The Anchor',
    ].filter(Boolean).join('\n'),
    html: buildServiceMessageHtml({
      heading: 'Tickets transferred',
      body,
      cta: manageLink ? { href: manageLink, label: 'Manage booking' } : null,
    }),
    commType: 'event_ticket_transferred',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_ticket_transferred_email',
      from_event_name: input.fromEventName,
      to_event_name: input.toEventName,
      manage_link_included: Boolean(manageLink),
      overpayment: typeof input.overpayment === 'number' && input.overpayment > 0 ? input.overpayment : undefined,
    },
  })
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

  const newStartIso = `${input.newDate}T${input.newTime || '00:00'}:00`
  const manageLink = await createManageLink(supabase, {
    ...context,
    eventStartIso: newStartIso,
  }, input.appBaseUrl)
  const newDateText = formatLondonDateTime(newStartIso)
  const body = [
    `Hi ${context.firstName},`,
    `${input.eventName || context.eventName} has been rescheduled to ${newDateText}.`,
    `Your ${context.seats === 1 ? 'ticket remains' : 'tickets remain'} valid for the new date.`,
    manageLink ? 'If the new date does not work for you, please use the manage-booking link or contact us.' : 'If the new date does not work for you, please contact us.',
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: `Event rescheduled: ${input.eventName || context.eventName}`,
    text: [
      ...body,
      manageLink ? `Manage your booking here: ${manageLink}` : null,
      '',
      'The Anchor',
    ].filter(Boolean).join('\n'),
    html: buildServiceMessageHtml({
      heading: 'Event rescheduled',
      body,
      cta: manageLink ? { href: manageLink, label: 'Manage booking' } : null,
    }),
    commType: 'event_rescheduled',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_rescheduled_email',
      ...metadataMatch,
      manage_link_included: Boolean(manageLink),
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
  const body = [
    `Hi ${context.firstName},`,
    `${eventName} has been postponed.`,
    'Staff will decide whether to hold your tickets, transfer them, or refund you, and we will contact you as soon as that decision is made.',
    'You do not need to do anything right now.',
  ]

  return sendEmail({
    requireLog: true,
    to: context.email,
    subject: `Event postponed: ${eventName}`,
    text: [...body, '', 'The Anchor'].join('\n'),
    html: buildServiceMessageHtml({
      heading: 'Event postponed',
      body,
    }),
    commType: 'event_postponed',
    customerId: context.customerId,
    eventBookingId: context.bookingId,
    metadata: {
      template_key: 'event_postponed_email',
    },
  })
}
