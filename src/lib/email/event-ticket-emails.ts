import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/emailService'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { logger } from '@/lib/logger'

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

async function loadEventTicketEmailContext(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string
): Promise<{
  bookingId: string
  customerId: string
  email: string
  firstName: string
  eventName: string
  eventStart: string
  eventStartIso: string | null
  seats: number
} | null> {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, customer_id, seats, customers!inner(id, first_name, email), events!inner(id, name, start_datetime, date, time)')
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

  return {
    bookingId: booking.id,
    customerId: customer.id,
    email,
    firstName: customer.first_name || 'there',
    eventName: event?.name || 'your event',
    eventStart: formatLondonDateTime(eventStartIso),
    eventStartIso,
    seats: Math.max(1, Number((booking as any).seats || 1)),
  }
}

async function hasSuccessfulEventPaymentConfirmationEmail(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string
): Promise<boolean> {
  try {
    const { data, error } = await (supabase.from('email_messages') as any)
      .select('id')
      .eq('event_booking_id', bookingId)
      .eq('comm_type', 'event_payment_confirmation')
      .in('status', ['queued', 'sent', 'delivered', 'delivery_delayed', 'opened', 'clicked'])
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn('Failed to check existing event payment confirmation email', {
        metadata: { bookingId, error: error.message },
      })
      return false
    }

    return Boolean(data)
  } catch (error) {
    logger.warn('Event payment confirmation email duplicate check unavailable', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
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
): Promise<{ success: boolean; error?: string; messageId?: string; skipped?: boolean }> {
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
): Promise<{ success: boolean; error?: string; messageId?: string; skipped?: boolean }> {
  const context = await loadEventTicketEmailContext(supabase, input.bookingId)
  if (!context) return { success: false, skipped: true }

  const alreadySent = await hasSuccessfulEventPaymentConfirmationEmail(supabase, input.bookingId)
  if (alreadySent) return { success: true, skipped: true }

  const seatWord = context.seats === 1 ? 'ticket' : 'tickets'
  const amountText = formatCurrency(input.amount ?? null, input.currency || 'GBP')
  let manageLink: string | null = null

  try {
    const manageToken = await createEventManageToken(supabase, {
      customerId: context.customerId,
      bookingId: context.bookingId,
      eventStartIso: context.eventStartIso,
      appBaseUrl: input.appBaseUrl,
    })
    manageLink = manageToken.url
  } catch {
    manageLink = null
  }

  const subject = `Booking confirmed: ${context.eventName}`
  const safeName = escapeHtml(context.firstName)
  const safeEventName = escapeHtml(context.eventName)
  const safeManageLink = manageLink ? escapeHtml(manageLink) : null
  const paidLine = amountText
    ? `We have received your ${amountText} payment.`
    : 'We have received your payment.'
  const text = [
    `Hi ${context.firstName},`,
    '',
    `${paidLine} Your booking for ${context.eventName} on ${context.eventStart} is confirmed for ${context.seats} ${seatWord}.`,
    manageLink ? `Manage your booking here: ${manageLink}` : null,
    '',
    'The Anchor',
  ].filter(Boolean).join('\n')

  const html = `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 620px; margin: 0 auto; color: #111827;">
  <h2 style="font-family: Arial, Helvetica, sans-serif;">Your booking is confirmed</h2>
  <p>Hi ${safeName},</p>
  <p>${escapeHtml(paidLine)} Your booking for <strong>${safeEventName}</strong> on ${escapeHtml(context.eventStart)} is confirmed for ${context.seats} ${seatWord}.</p>
  ${safeManageLink ? `<p><a href="${safeManageLink}" style="display: inline-block; padding: 10px 14px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px;">Manage booking</a></p>` : ''}
  <p style="font-size: 13px; color: #6b7280;">This is a service message about your booking.</p>
  <p>The Anchor</p>
</div>`

  return sendEmail({
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
