import type { SupabaseClient } from '@supabase/supabase-js'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { reportPaymentAlert } from '@/lib/cron/alerting'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import type { PayPalRefundResource } from '@/lib/paypal-refund-resource'
import type { PayPalDomain } from '@/lib/paypal-webhook-router'

/**
 * Tells staff, once, about money PayPal moved that a person has to look at: every reversal or
 * chargeback, and any refund the app could not record by itself.
 *
 * Once means once per PayPal refund id, not once per webhook delivery. PayPal sends the same
 * refund as PAYMENT.CAPTURE.REFUNDED and PAYMENT.REFUND.COMPLETED, two different event ids, and
 * one email is enough. The claim lives in `idempotency_keys`, the table the webhook already uses.
 *
 * Staff only. Nothing here can reach a customer.
 */

export type PayPalMoneyAlertInput = {
  kind: 'reversal' | 'refund_review'
  domain: PayPalDomain
  /** The routed record id: booking, payment row or invoice. */
  key: string
  eventId: string
  eventType: string
  refund: PayPalRefundResource
  /** True when the app recorded the money itself. */
  recorded: boolean
  /** Why a person is needed when it did not. */
  reason?: string | null
}

const ALERT_TTL_HOURS = 24 * 30

const DOMAIN_LABEL: Record<PayPalDomain, string> = {
  invoices: 'an invoice',
  private_bookings: 'a private booking deposit',
  table_bookings: 'a table booking deposit',
  parking: 'a parking payment',
  event_bookings: 'an event ticket booking',
}

// Only pages whose route takes exactly the routed id. Parking routes by payment row and events by
// booking, neither of which has a page of its own, so they get ids and no link.
const DOMAIN_PATH: Partial<Record<PayPalDomain, (key: string) => string>> = {
  invoices: (key) => `/invoices/${key}`,
  private_bookings: (key) => `/private-bookings/${key}`,
  table_bookings: (key) => `/table-bookings/${key}`,
}

const REASON_TEXT: Record<string, string> = {
  exceeds_captured_amount: 'recording it would take the refunds past the amount that was paid',
  unmatched_pending_staff_refund: 'a staff refund on the same payment is still pending for a different amount',
  unreadable_amount: 'PayPal did not send an amount the app could read exactly',
  unknown_status: 'PayPal sent a refund status the app does not recognise',
  not_a_refund_resource: 'PayPal did not say which payment the money came from',
  source_not_found: 'the payment the money came from could not be found',
  wrong_currency: 'it was not in pounds',
  invoice_refunds_not_recorded: 'invoices cannot record a refund automatically',
}

function formatAmount(amount: number | null): string {
  return amount === null ? 'an unreadable amount' : `£${amount.toFixed(2)}`
}

function describe(input: PayPalMoneyAlertInput): { title: string; summary: string } {
  const label = DOMAIN_LABEL[input.domain]
  const amount = formatAmount(input.refund.amount)
  const reason = input.reason ? REASON_TEXT[input.reason] ?? input.reason : null
  const noCustomerMessage = 'No message has been sent to the customer.'

  if (input.kind === 'reversal') {
    const title = `PayPal took back ${amount} on ${label}`
    if (input.recorded) {
      return {
        title,
        summary: `PayPal reversed ${amount} of a payment on ${label} (a chargeback or reversal). The app has recorded it as money returned. Check the case in PayPal and decide whether the booking still stands. ${noCustomerMessage}`,
      }
    }
    if (input.domain === 'invoices') {
      return {
        title,
        summary: `PayPal reversed ${amount} of a payment on an invoice (a chargeback or reversal). Invoices cannot record money going back automatically, so the invoice still shows that payment as received. Check the case in PayPal, and if it stands, issue a credit note on the invoice. ${noCustomerMessage}`,
      }
    }
    return {
      title,
      summary: `PayPal reversed ${amount} of a payment on ${label} (a chargeback or reversal), but the app could not record it automatically: ${reason ?? 'see the webhook log'}. Record it by hand and check the case in PayPal. ${noCustomerMessage}`,
    }
  }

  if (input.domain === 'invoices') {
    return {
      title: `PayPal refund of ${amount} on an invoice needs a credit note`,
      summary: `A refund of ${amount} was made in PayPal against an invoice payment. Invoices cannot record a refund automatically, so the invoice still shows that payment as received. If the refund stands, issue a credit note on the invoice. ${noCustomerMessage}`,
    }
  }

  return {
    title: `PayPal refund of ${amount} on ${label} needs recording`,
    summary: `A refund of ${amount} was made in PayPal on ${label}, but the app could not record it automatically: ${reason ?? 'see the webhook log'}. Check it in PayPal and record it by hand. ${noCustomerMessage}`,
  }
}

function linkFor(input: { domain: PayPalDomain; key: string }): string | null {
  const path = DOMAIN_PATH[input.domain]?.(input.key)
  if (!path) return null
  try {
    return `${getAppUrl()}${path}`
  } catch {
    return null
  }
}

/**
 * Invoice refunds and reversals need a credit note, which the owner raises, so those alerts go only
 * to this inbox rather than the general CRON_ALERT_EMAIL (owner decision, 27 September 2026). Every
 * other PayPal money alert still goes to CRON_ALERT_EMAIL.
 */
export const INVOICE_CREDIT_NOTE_ALERT_RECIPIENT = 'manager@the-anchor.pub'

export async function alertStaffToPayPalMoneyEvent(
  supabase: SupabaseClient<any, 'public', any>,
  input: PayPalMoneyAlertInput,
): Promise<void> {
  const { title, summary } = describe(input)
  await raiseStaffAlertOnce(supabase, {
    onceKey: `paypal:staff-alert:${input.kind}:${input.refund.refundId ?? input.eventId}`,
    eventId: input.eventId,
    domain: input.domain,
    key: input.key,
    title,
    summary,
    to: input.domain === 'invoices' ? INVOICE_CREDIT_NOTE_ALERT_RECIPIENT : undefined,
    context: {
      Record: `${input.domain} ${input.key}`,
      Link: linkFor(input),
      Amount: formatAmount(input.refund.amount),
      'PayPal status': input.refund.rawStatus,
      'PayPal capture': input.refund.captureId,
      'PayPal refund or reversal id': input.refund.refundId,
      'Recorded by the app': input.recorded ? 'yes' : 'no',
      'PayPal event': `${input.eventType} ${input.eventId}`,
    },
  })
}

export type CaptureOnClosedBookingAlertInput = {
  domain: PayPalDomain
  /** The booking the order was raised for. */
  key: string
  eventId: string
  eventType: string
  captureId: string
  orderId: string
  /** Pounds, when PayPal sent an amount the app could read. */
  amountGbp: number | null
  /** Why the booking could not take the payment (getPayPalDepositCaptureBlockReason). */
  blockReason: string
}

const CAPTURE_BLOCK_TEXT: Record<string, string> = {
  booking_closed: 'the booking had been cancelled or closed',
  hold_expired: 'its payment hold had run out',
  hold_missing: 'it had no payment hold',
  booking_not_pending_payment: 'it was not waiting for a deposit',
  already_completed: 'its deposit was already marked as paid, so this may be a second payment',
}

/**
 * Tells staff, once per capture, that PayPal took money for a booking that could no longer take it.
 *
 * The webhook used to log this and stop. The money then sat in PayPal with nothing on the booking,
 * so even the cancellation refund could not find it, and nobody was told (BK-010, 24 October
 * review). A person has to refund it, or record it if the guest is coming after all.
 */
export async function alertStaffToCaptureOnClosedBooking(
  supabase: SupabaseClient<any, 'public', any>,
  input: CaptureOnClosedBookingAlertInput,
): Promise<void> {
  const label = DOMAIN_LABEL[input.domain]
  const amount = formatAmount(input.amountGbp)
  const why = CAPTURE_BLOCK_TEXT[input.blockReason] ?? input.blockReason

  await raiseStaffAlertOnce(supabase, {
    onceKey: `paypal:staff-alert:capture_on_closed_booking:${input.captureId}`,
    eventId: input.eventId,
    domain: input.domain,
    key: input.key,
    title: `PayPal took ${amount} for ${label} that could no longer be paid`,
    summary: `PayPal captured ${amount} for ${label} after it stopped taking payment: ${why}. The app has not recorded the money on the booking and has not refunded it. Refund it in PayPal using the capture below, or record it on the booking if the guest is still coming. No message has been sent to the customer.`,
    context: {
      Record: `${input.domain} ${input.key}`,
      Link: linkFor(input),
      Amount: amount,
      'PayPal capture': input.captureId,
      'PayPal order': input.orderId,
      'Why it was not recorded': input.blockReason,
      'PayPal event': `${input.eventType} ${input.eventId}`,
    },
  })
}

/**
 * Sends a staff payment alert once per `onceKey`. The claim lives in `idempotency_keys`, so a
 * second delivery of the same PayPal event does not send a second email. A failed send releases the
 * claim, so a later delivery tries again. Never throws.
 */
async function raiseStaffAlertOnce(
  supabase: SupabaseClient<any, 'public', any>,
  args: {
    onceKey: string
    eventId: string
    domain: PayPalDomain
    key: string
    title: string
    summary: string
    to?: string
    context: Record<string, unknown>
  },
): Promise<void> {
  const { onceKey } = args
  const requestHash = computeIdempotencyRequestHash({ onceKey })

  let claimed = false
  try {
    const claim = await claimIdempotencyKey(supabase, onceKey, requestHash, ALERT_TTL_HOURS)
    if (claim.state !== 'claimed') {
      logger.info('PayPal staff alert already raised for this refund', {
        metadata: { onceKey, eventId: args.eventId, claim: claim.state },
      })
      return
    }
    claimed = true
  } catch (claimError) {
    // Could not check whether staff were already told. Tell them anyway: a duplicate email is a
    // far smaller problem than a chargeback nobody hears about.
    logger.error('Could not claim the PayPal staff alert; sending it unclaimed', {
      error: claimError instanceof Error ? claimError : new Error(String(claimError)),
      metadata: { onceKey, eventId: args.eventId },
    })
  }

  const result = await reportPaymentAlert({
    title: args.title,
    summary: args.summary,
    to: args.to,
    context: args.context,
  })

  if (!result.sent) {
    // The audit row and the webhook log still carry the event; this makes the missed email loud.
    logger.error('PayPal staff alert was NOT delivered', {
      error: new Error(`paypal_staff_alert_${result.reason ?? 'not_sent'}`),
      metadata: { onceKey, eventId: args.eventId, domain: args.domain, key: args.key },
    })
  }

  if (!claimed) return

  try {
    if (result.sent) {
      await persistIdempotencyResponse(
        supabase,
        onceKey,
        requestHash,
        { state: 'alerted', event_id: args.eventId },
        ALERT_TTL_HOURS,
      )
    } else {
      // Let a later delivery about the same refund try the email again.
      await releaseIdempotencyClaim(supabase, onceKey, requestHash)
    }
  } catch (persistError) {
    logger.error('Could not settle the PayPal staff alert claim', {
      error: persistError instanceof Error ? persistError : new Error(String(persistError)),
      metadata: { onceKey },
    })
  }
}
