import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendEventMessageEmailFirst } from '@/lib/events/event-guest-notify'
import { sendEventPaymentLinkEmail } from '@/lib/email/event-ticket-emails'

/**
 * The payment link, by EMAIL ONLY, the moment a website event hold is made (event checkout spec,
 * Piece 4.1, owner approval 7 November 2026).
 *
 * A website guest pays on screen, so BK-084 sends them nothing while they pay. But a website hold
 * lasts 15 minutes, and a guest who reloads or switches apps mid-payment had no way back to the
 * PayPal buttons. This email is that way back.
 *
 * Never a text: BK-084's reason stands. A text can be held by quiet hours and arrive after the
 * guest has paid or the hold has gone. An email has no quiet hours and arrives at once.
 *
 * Rules:
 *  - only when the guest has an email address (the booking's contact email or the customer's);
 *  - once per booking: a claim in `idempotency_keys` is taken BEFORE anything is sent and never
 *    released, as the SMS claims and the deposit hold reminder ledger do, so a second call sends
 *    nothing more;
 *  - the messaging flag `event_hold_payment_link_email_paused` stops it with no deploy. It is a
 *    pause switch rather than an on switch so that the email is on by default without a
 *    migration: flags are on only when stored as true, and the row needs no new key to send;
 *  - never throws. The guest is still on the page with PayPal, so a failed email must never fail
 *    the booking. A failure is logged, and sendEventMessageEmailFirst writes the undelivered
 *    delivery row staff can see under Settings, SMS failures, Undelivered guest messages.
 */

/** The delivery row's template key: the same message as a phone or bar booking's payment link. */
export const WEBSITE_HOLD_PAYMENT_EMAIL_TEMPLATE_KEY = 'event_booking_pending_payment'

/** How long the claim is kept. A website hold lasts 15 minutes; this only has to outlive it. */
const CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type WebsiteHoldPaymentEmailStatus =
  | 'sent'
  | 'paused'
  | 'no_email'
  | 'already_claimed'
  | 'claim_failed'
  | 'failed'
  | 'deferred'
  | 'no_channel'
  | 'already_sent'

export function websiteHoldPaymentEmailClaimKey(bookingId: string): string {
  return `message:event_hold_payment_link_email:${bookingId}`
}

function describe(error: unknown): { message: string; code: string | null; details: string | null; hint: string | null } {
  const err = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown } | null
  return {
    message: typeof err?.message === 'string' ? err.message : String(error),
    code: typeof err?.code === 'string' ? err.code : null,
    details: typeof err?.details === 'string' ? err.details : null,
    hint: typeof err?.hint === 'string' ? err.hint : null,
  }
}

/**
 * True when the guest has an address to try. The booking's contact email answers without a read.
 * A failed read of the customer is taken as "maybe": the email sender reads the address again and
 * skips cleanly when there is none.
 */
async function guestHasEmail(
  // `any` matches the untyped admin client the event booking service passes around.
  supabase: SupabaseClient<any, 'public', any>,
  customerId: string,
  contactEmail: string | null | undefined,
): Promise<boolean> {
  if (typeof contactEmail === 'string' && contactEmail.trim()) return true
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('email')
      .eq('id', customerId)
      .maybeSingle()
    if (error) throw error
    return typeof data?.email === 'string' && data.email.trim().length > 0
  } catch (error) {
    logger.warn('Website hold payment email: could not read the customer email; trying the send', {
      metadata: { customerId, ...describe(error) },
    })
    return true
  }
}

/** Claims the one email for this booking. 'claimed' means this call may send. */
async function claimWebsiteHoldPaymentEmail(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string,
): Promise<'claimed' | 'already_claimed' | 'failed'> {
  const key = websiteHoldPaymentEmailClaimKey(bookingId)
  try {
    const { error } = await supabase.from('idempotency_keys').insert({
      key,
      request_hash: createHash('sha256').update(key).digest('hex'),
      response: { channel: 'email', state: 'claimed', template_key: WEBSITE_HOLD_PAYMENT_EMAIL_TEMPLATE_KEY },
      expires_at: new Date(Date.now() + CLAIM_TTL_MS).toISOString(),
    })
    if (!error) return 'claimed'
    if ((error as { code?: string }).code === '23505') return 'already_claimed'
    throw error
  } catch (error) {
    // Fail closed: without a claim a retry could email the guest twice. The guest still has the
    // PayPal buttons on screen, so sending nothing is the safe side.
    logger.error('Website hold payment email: could not claim the send, so nothing was sent', {
      metadata: { bookingId, key, ...describe(error) },
    })
    return 'failed'
  }
}

export async function sendWebsiteHoldPaymentLinkEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    eventId: string | null
    customerId: string
    paymentLink: string
    holdExpiresAt: string | null
    contactEmail?: string | null
  },
): Promise<WebsiteHoldPaymentEmailStatus> {
  try {
    if (await isMessagingFlagOn('event_hold_payment_link_email_paused')) return 'paused'

    if (!(await guestHasEmail(supabase, input.customerId, input.contactEmail))) return 'no_email'

    const claim = await claimWebsiteHoldPaymentEmail(supabase, input.bookingId)
    if (claim === 'already_claimed') return 'already_claimed'
    if (claim === 'failed') return 'claim_failed'

    // Email only: no `text` sender, so nothing can fall back to a text.
    const outcome = await sendEventMessageEmailFirst({
      templateKey: WEBSITE_HOLD_PAYMENT_EMAIL_TEMPLATE_KEY,
      bookingId: input.bookingId,
      eventId: input.eventId,
      customerId: input.customerId,
      email: () => sendEventPaymentLinkEmail(supabase, {
        bookingId: input.bookingId,
        paymentLink: input.paymentLink,
        holdExpiresAt: input.holdExpiresAt,
      }),
      text: null,
    })
    return outcome.status
  } catch (error) {
    logger.error('Website hold payment email failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId, customerId: input.customerId, ...describe(error) },
    })
    return 'failed'
  }
}
