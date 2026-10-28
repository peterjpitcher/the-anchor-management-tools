/**
 * The guest's message after an event payment: confirmed, or waiting for a person to check it.
 *
 * Six paths take an event payment (the PayPal webhook, the website and guest-page captures, the
 * staff mark-paid action, the payment exceptions screen and the PayPal reconciliation cron). Each
 * used to send the text and then the email, so a guest with an email address got both. They all
 * call this now: email first, the text only when no email goes (BK-167, owner decision D14).
 *
 * Never throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  sendEventPaymentConfirmationEmail,
  sendEventPaymentManualReviewEmail,
} from '@/lib/email/event-ticket-emails'
import {
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'
import { sendEventMessageEmailFirst, type EventMessageOutcome } from '@/lib/events/event-guest-notify'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * The customer and event a booking belongs to, for the delivery row, when the caller did not
 * pass them (the PayPal webhook, the guest capture route and the reconciliation cron know only
 * the booking). Without them an undelivered message shows staff "Unknown customer" with no link
 * to the booking. Best effort: a failed read leaves them null and never stops the message.
 */
async function resolveBookingOwner(
  bookingId: string,
  known: { customerId?: string | null; eventId?: string | null }
): Promise<{ customerId: string | null; eventId: string | null }> {
  if (known.customerId && known.eventId) return { customerId: known.customerId, eventId: known.eventId }
  try {
    const { data, error } = await createAdminClient()
      .from('bookings')
      .select('customer_id, event_id')
      .eq('id', bookingId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return {
      customerId: known.customerId ?? (typeof data?.customer_id === 'string' ? data.customer_id : null),
      eventId: known.eventId ?? (typeof data?.event_id === 'string' ? data.event_id : null),
    }
  } catch (error) {
    logger.warn('Event payment message could not read its booking owner', {
      metadata: { bookingId, error: error instanceof Error ? error.message : String(error) },
    })
    return { customerId: known.customerId ?? null, eventId: known.eventId ?? null }
  }
}

export async function notifyEventPaymentOutcome(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    outcome: 'confirmed' | 'manual_review'
    amount?: number | null
    currency?: string | null
    appBaseUrl?: string
    eventId?: string | null
    customerId?: string | null
    /**
     * False for a payment already confirmed on an earlier call (PayPal's `already_confirmed`):
     * the email's own duplicate check covers a repeat, but a text cannot be checked the same way,
     * so none is sent.
     */
    textAllowed?: boolean
    /** Set by a cron, which comes back to a deferred message on its next run. */
    retriesLater?: boolean
  }
): Promise<EventMessageOutcome> {
  const textAllowed = input.textAllowed !== false
  const owner = await resolveBookingOwner(input.bookingId, { customerId: input.customerId, eventId: input.eventId })
  if (input.outcome === 'confirmed') {
    return sendEventMessageEmailFirst({
      templateKey: 'event_payment_confirmed',
      bookingId: input.bookingId,
      eventId: owner.eventId,
      customerId: owner.customerId,
      retriesLater: input.retriesLater,
      email: () => sendEventPaymentConfirmationEmail(supabase, {
        bookingId: input.bookingId,
        amount: input.amount,
        currency: input.currency,
        appBaseUrl: input.appBaseUrl,
      }),
      text: textAllowed
        ? () => sendEventPaymentConfirmationSms(supabase, {
            bookingId: input.bookingId,
            eventName: 'your event',
            seats: 1,
            appBaseUrl: input.appBaseUrl,
          })
        : null,
    })
  }

  return sendEventMessageEmailFirst({
    templateKey: 'event_payment_manual_review',
    bookingId: input.bookingId,
    eventId: owner.eventId,
    customerId: owner.customerId,
    retriesLater: input.retriesLater,
    email: () => sendEventPaymentManualReviewEmail(supabase, {
      bookingId: input.bookingId,
      amount: input.amount,
      currency: input.currency,
    }),
    text: textAllowed ? () => sendEventPaymentManualReviewSms(supabase, { bookingId: input.bookingId }) : null,
  })
}
