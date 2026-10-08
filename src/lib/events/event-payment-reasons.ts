import { GUEST_CONTACT } from '@/lib/guest-contact'

/**
 * A sentence for each reason an event payment can be refused.
 *
 * The external event payment routes used to answer a refusal with the bare
 * reason and nothing else: `{ success: false, error: 'hold_expired' }`. The
 * website had to keep its own table of what each one meant, and anything
 * missing from that table reached the guest as a system code. Site review of
 * 7 October 2026, findings PY-007 and MG-003.
 *
 * The routes now send the reason as `code` and one of these as `message`. The
 * `error` field still carries the bare reason, so a website built before this
 * change reads exactly what it read before.
 *
 * Every sentence ends with the phone number: a guest who cannot pay online must
 * be left with a way to reach the pub.
 */

const CALL = `call ${GUEST_CONTACT.phoneDisplay}`

const START_AGAIN = `The time to pay for these places has run out. Please start your booking again, or ${CALL}.`
const LINK_NO_LONGER_VALID = `That payment link is no longer valid. Please start your booking again, or ${CALL}.`

/**
 * Money may already have moved for these, so the guest is told to ring before
 * paying a second time. Never soften this into "please try again".
 */
const CALL_BEFORE_PAYING_AGAIN = `We could not confirm this payment. Please ${CALL} before paying again, so you are not charged twice.`

const EVENT_PAYMENT_REASON_SENTENCES: Record<string, string> = {
  hold_expired: START_AGAIN,
  token_expired: START_AGAIN,
  invalid_token: LINK_NO_LONGER_VALID,
  token_customer_mismatch: LINK_NO_LONGER_VALID,
  token_used: `That payment link has already been used. If you are not sure your booking went through, ${CALL}.`,
  booking_not_found: `We could not find that booking. Please ${CALL} and we will help.`,
  booking_not_pending_payment: `This booking is not waiting for a payment. If you are not sure it went through, ${CALL}.`,
  event_not_found: `We could not find this event. Please ${CALL} and we will help.`,
  invalid_amount: `We could not work out the amount to pay for this booking. Please ${CALL} and we will sort it out.`,
  payment_order_not_found: CALL_BEFORE_PAYING_AGAIN,
  order_mismatch: CALL_BEFORE_PAYING_AGAIN,
  amount_or_reference_mismatch: CALL_BEFORE_PAYING_AGAIN,
  capture_amount_mismatch: CALL_BEFORE_PAYING_AGAIN,
  capture_reference_mismatch: CALL_BEFORE_PAYING_AGAIN,
  confirmation_blocked: CALL_BEFORE_PAYING_AGAIN,
  capture_already_captured_pending_confirmation: CALL_BEFORE_PAYING_AGAIN,
}

/** Reasons the routes are known to answer with. Used by the tests to keep the table complete. */
export const KNOWN_EVENT_PAYMENT_REASONS = Object.keys(EVENT_PAYMENT_REASON_SENTENCES)

/**
 * What to say when a capture is refused for a reason this table does not know.
 * A capture is the step where money moves, so the safe line is the cautious one.
 */
export const EVENT_PAYMENT_CAPTURE_FALLBACK = CALL_BEFORE_PAYING_AGAIN

/** What to say when a payment cannot be started for an unknown reason. Nothing has been charged. */
export const EVENT_PAYMENT_START_FALLBACK = `We could not start this payment online. Nothing has been charged. Please ${CALL} and we will help.`

export function eventPaymentReasonSentence(
  reason: string | null | undefined,
  step: 'start' | 'capture'
): string {
  const known = reason ? EVENT_PAYMENT_REASON_SENTENCES[reason] : undefined
  if (known) return known
  return step === 'capture' ? EVENT_PAYMENT_CAPTURE_FALLBACK : EVENT_PAYMENT_START_FALLBACK
}

/**
 * The body of a refused event payment answer.
 *
 * `error` keeps the bare reason for the website as it stands today. `code` is
 * the same value under the name every other public route uses. `message` is the
 * sentence for the guest.
 */
export function eventPaymentRefusal(
  reason: string | null | undefined,
  step: 'start' | 'capture'
): { success: false; error: string; code: string; message: string } {
  const code = reason && reason.trim() ? reason : 'payment_blocked'
  return {
    success: false,
    error: code,
    code,
    message: eventPaymentReasonSentence(reason, step),
  }
}
