import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyCustomer } from '@/lib/notifications/notify'
import { formatDateTime } from '@/lib/dateUtils'
import { GUEST } from '@/lib/brand/palette'
import { escapeHtml } from '@/lib/email/escape-html'
import { GUEST_EMAIL_SIGN_OFF, guestContactHtmlBlock, guestContactTextLine } from '@/lib/email/guest-footer'
import { logger } from '@/lib/logger'
import type { ParkingChangeOutcome, ParkingNotificationBooking } from '@/lib/parking/notifications'

type GenericClient = SupabaseClient<any, 'public', any>

/**
 * Parking customer messages go by email, and by text only when we have no usable email for the
 * person (owner decision, 24 November 2026). This is the one place that choice is made.
 *
 * It goes through `notifyCustomer`, so the email suppression list, the customer's SMS opt-out,
 * quiet hours, the send limits and every kill switch apply exactly as for any other message. If
 * the email cannot be sent the customer is texted instead, so a provider fault does not leave
 * them with nothing. WhatsApp is never offered: parking has no WhatsApp templates.
 */

export interface ParkingEmailContent {
  subject: string
  /** Short paragraphs, plain text: they are escaped into the HTML. */
  paragraphs: string[]
  /** An optional button, for a payment link. */
  button?: { label: string; url: string }
}

export interface ParkingMessageResult {
  /** sent: it went (or is queued at the provider); held: a text waiting for quiet hours to end. */
  status: 'sent' | 'held' | 'failed' | 'skipped'
  channel: 'email' | 'sms' | null
  messageId: string | null
  code: string | null
  logFailure: boolean
  scheduledFor: string | null
  /** For a skipped or failed message, why, in plain words for the log. */
  reason: string | null
  /** True when the email failed and the text went instead. */
  fallbackUsed: boolean
}

function money(amount: number): string {
  return `£${amount.toFixed(2)}`
}

function detailRows(booking: ParkingNotificationBooking): Array<[string, string]> {
  return [
    ['Reference', booking.reference ?? ''],
    ['Vehicle', booking.vehicle_registration ?? ''],
    ['From', formatDateTime(booking.start_at)],
    ['To', formatDateTime(booking.end_at)],
  ]
}

/** Renders the guest-branded email, with the booking details as a small table. */
export function renderParkingEmail(
  booking: ParkingNotificationBooking,
  content: ParkingEmailContent
): { subject: string; html: string; text: string } {
  const rows = detailRows(booking)
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:${GUEST.text};max-width:560px">`,
    ...content.paragraphs.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`),
    content.button
      ? `<p style="margin:16px 0"><a href="${escapeHtml(content.button.url)}" style="display:inline-block;background:${GUEST.buttonBg};color:${GUEST.buttonText};padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${escapeHtml(content.button.label)}</a></p>`
      : '',
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 12px;border-collapse:collapse;font-size:15px">`,
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:${GUEST.textMuted}">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:bold">${escapeHtml(value)}</td></tr>`
    ),
    '</table>',
    guestContactHtmlBlock(),
    `<p style="margin:16px 0 0">Thanks,<br/>${escapeHtml(GUEST_EMAIL_SIGN_OFF)}</p>`,
    '</div>',
  ].join('')

  const text = [
    ...content.paragraphs,
    ...(content.button ? [`${content.button.label}: ${content.button.url}`] : []),
    rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
    guestContactTextLine(),
    `Thanks,\n${GUEST_EMAIL_SIGN_OFF}`,
  ].join('\n\n')

  return { subject: content.subject, html, text }
}

// The wording below follows the texts the owner approved, written out in full for email.

export function parkingPaymentRequestEmail(booking: ParkingNotificationBooking, paymentUrl: string | null): ParkingEmailContent {
  const amount = booking.override_price ?? booking.calculated_price ?? 0
  return {
    subject: `Pay for your parking, ${booking.reference}`,
    paragraphs: [
      `Hi ${booking.customer_first_name}, your parking at The Anchor is reserved.`,
      paymentUrl
        ? `It comes to ${money(amount)}. Pay using the button below to confirm it.`
        : `It comes to ${money(amount)}. We will send your payment link shortly.`,
    ],
    button: paymentUrl ? { label: `Pay ${money(amount)}`, url: paymentUrl } : undefined,
  }
}

export function parkingPaymentReminderEmail(
  booking: ParkingNotificationBooking,
  stage: 'week_before_expiry' | 'day_before_expiry',
  paymentUrl: string,
  expiresWhen?: string
): ParkingEmailContent {
  const amount = booking.override_price ?? booking.calculated_price ?? 0
  if (stage === 'week_before_expiry') {
    return {
      subject: `Your parking still needs paying, ${booking.reference}`,
      paragraphs: [`Hi ${booking.customer_first_name}, just a nudge: your parking still needs paying (${money(amount)}).`],
      button: { label: `Pay ${money(amount)}`, url: paymentUrl },
    }
  }
  return {
    subject: `Your parking offer expires ${expiresWhen ?? 'soon'}, ${booking.reference}`,
    paragraphs: [
      `Hi ${booking.customer_first_name}, your parking offer expires ${expiresWhen ?? 'soon'}.`,
      `Pay ${money(amount)} to keep your space.`,
    ],
    button: { label: `Pay ${money(amount)}`, url: paymentUrl },
  }
}

export function parkingConfirmationEmail(booking: ParkingNotificationBooking): ParkingEmailContent {
  const amount = booking.override_price ?? booking.calculated_price ?? 0
  return {
    subject: `Your parking is confirmed, ${booking.reference}`,
    paragraphs: [
      `Hi ${booking.customer_first_name}, thanks for your payment of ${money(amount)}.`,
      'Your parking is confirmed. Your details are below.',
    ],
  }
}

export function parkingSessionReminderEmail(booking: ParkingNotificationBooking, type: 'start' | 'end'): ParkingEmailContent {
  if (type === 'start') {
    return {
      subject: `Your parking starts ${formatDateTime(booking.start_at)}`,
      paragraphs: [
        `Hi ${booking.customer_first_name}, your parking starts on ${formatDateTime(booking.start_at)}.`,
        `Just checking you've got ${booking.vehicle_registration} ready to go.`,
      ],
    }
  }
  return {
    subject: `Your parking ends ${formatDateTime(booking.end_at)}`,
    paragraphs: [
      `Hi ${booking.customer_first_name}, your parking ends on ${formatDateTime(booking.end_at)}.`,
      'Need longer? Give us a call and we can extend it.',
    ],
  }
}

export function parkingChangeEmail(booking: ParkingNotificationBooking, outcome: ParkingChangeOutcome): ParkingEmailContent {
  const opening = `Hi ${booking.customer_first_name}, your parking is now ${formatDateTime(booking.start_at)} to ${formatDateTime(booking.end_at)}.`
  switch (outcome.kind) {
    case 'refund':
      return {
        subject: `Your parking dates have changed, ${booking.reference}`,
        paragraphs: [opening, `We are refunding ${money(outcome.amount)} to the way you paid. It can take 5 to 10 days to reach you.`],
      }
    case 'pay_link':
      return {
        subject: `Your parking dates have changed, ${booking.reference}`,
        paragraphs: [opening, `There is ${money(outcome.amount)} extra to pay.`],
        button: { label: `Pay ${money(outcome.amount)}`, url: outcome.link },
      }
    case 'paid_at_venue':
      return {
        subject: `Your parking dates have changed, ${booking.reference}`,
        paragraphs: [opening, `Thanks for the ${money(outcome.amount)} you paid today.`],
      }
    default:
      return { subject: `Your parking dates have changed, ${booking.reference}`, paragraphs: [opening] }
  }
}

export function parkingTopUpReceivedEmail(booking: ParkingNotificationBooking, amount: number): ParkingEmailContent {
  return {
    subject: `Thanks for your payment, ${booking.reference}`,
    paragraphs: [`Hi ${booking.customer_first_name}, thanks, we have your payment of ${money(amount)}.`, 'Your parking details are below.'],
  }
}

/**
 * Sends one parking message: email when the person has a usable address, otherwise (or if the
 * email fails) a text. Never throws.
 */
export async function sendParkingCustomerMessage(input: {
  client: GenericClient
  booking: ParkingNotificationBooking
  /** The parking notification event, for the logs (payment_request, booking_changed and so on). */
  eventType: string
  /** Starts `parking_`, so the routing rule applies. */
  templateKey: string
  email: ParkingEmailContent
  /** The text, already with any reply line, for a customer with no usable email. */
  smsBody: string
  /** Same ids the SMS dedupe uses (payment_id, change_id, subject_at, stage). Never PII. */
  dedupe?: Record<string, string | undefined>
}): Promise<ParkingMessageResult> {
  const { client, booking, eventType, templateKey, smsBody } = input
  const dedupe = Object.fromEntries(Object.entries(input.dedupe ?? {}).filter(([, v]) => typeof v === 'string' && v.length > 0)) as Record<string, string>
  const rendered = renderParkingEmail(booking, input.email)
  // One key per booking, message kind and the ids that make it distinct, so a retried call cannot
  // put a second copy in the inbox while a second top-up or a later change still gets its own.
  const idempotencyKey = ['parking', booking.id, templateKey, ...Object.keys(dedupe).sort().map((k) => `${k}=${dedupe[k]}`)].join(':')

  try {
    const result = await notifyCustomer({
      supabase: client,
      customerId: booking.customer_id ?? null,
      policy: 'email_first',
      urgency: 'standard',
      category: 'transactional',
      email: {
        to: booking.customer_email ?? null,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        commType: templateKey,
        parkingBookingId: booking.id,
        idempotencyKey,
        metadata: { template_key: templateKey, event_type: eventType, ...dedupe },
      },
      sms: {
        to: booking.customer_mobile ?? null,
        body: smsBody,
        options: {
          customerId: booking.customer_id ?? undefined,
          metadata: { parking_booking_id: booking.id, event_type: eventType, template_key: templateKey, ...dedupe },
        },
      },
      deliveryMetadata: { parking_booking_id: booking.id, event_type: eventType, ...dedupe },
    })

    if (result.finalStatus === 'no_channel') {
      return {
        status: 'skipped',
        channel: null,
        messageId: null,
        code: null,
        logFailure: false,
        scheduledFor: null,
        reason: 'No usable email address, and the customer cannot be texted',
        fallbackUsed: false,
      }
    }

    const success = result.attempts.find((a) => a.success) ?? null
    const last = result.attempts[result.attempts.length - 1] ?? null
    const used = success ?? last
    const channel = used?.channel === 'email' || used?.channel === 'sms' ? used.channel : null
    if (!success) {
      return {
        status: 'failed',
        channel,
        messageId: null,
        code: used?.code ?? null,
        logFailure: used?.logFailure === true,
        scheduledFor: null,
        reason: used?.error ?? 'The message could not be sent',
        fallbackUsed: false,
      }
    }
    if (success.logFailure === true || success.code === 'logging_failed') {
      logger.error('Parking customer message sent but its outbound log row was not written', {
        metadata: { bookingId: booking.id, templateKey, channel, code: success.code ?? null },
      })
    }
    return {
      status: success.channel === 'sms' && typeof success.scheduledFor === 'string' ? 'held' : 'sent',
      channel,
      messageId: success.messageId ?? null,
      code: success.code ?? null,
      logFailure: success.logFailure === true,
      scheduledFor: typeof success.scheduledFor === 'string' ? success.scheduledFor : null,
      reason: null,
      fallbackUsed: result.fallbackUsed,
    }
  } catch (error) {
    logger.error('Unexpected error sending a parking customer message', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: booking.id, templateKey },
    })
    // A send that throws can still carry the SMS safety signal; keep it so callers stop.
    const thrownCode = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : null
    const thrownLogFailure = (error as { logFailure?: unknown })?.logFailure === true || thrownCode === 'logging_failed'
    return {
      status: 'failed',
      channel: null,
      messageId: null,
      code: thrownLogFailure ? 'logging_failed' : thrownCode,
      logFailure: thrownLogFailure,
      scheduledFor: null,
      reason: error instanceof Error ? error.message : String(error),
      fallbackUsed: false,
    }
  }
}

/** The payload fields every parking notification row gets for a customer message. */
export function customerMessagePayload(result: ParkingMessageResult, email: ParkingEmailContent, smsBody: string): Record<string, unknown> {
  return {
    audience: 'customer',
    channel_used: result.channel,
    ...(result.channel === 'email' ? { subject: email.subject } : { sms: smsBody }),
    ...(result.code ? { code: result.code } : {}),
    ...(result.channel !== 'email' ? { sms_code: result.code, sms_log_failure: result.logFailure } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.fallbackUsed ? { fallback_used: true } : {}),
    ...(result.scheduledFor ? { deferred: true, scheduled_for: result.scheduledFor } : {}),
  }
}

/** The channel a message would try first, for logging a send that failed before choosing one. */
export function firstChoiceChannel(booking: Pick<ParkingNotificationBooking, 'customer_email'>): 'email' | 'sms' {
  return booking.customer_email && booking.customer_email.trim() ? 'email' : 'sms'
}
