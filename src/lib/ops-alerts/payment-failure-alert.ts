/**
 * The text the pub gets when a payment fails on the public website.
 *
 * The website has no SMS provider, so it asks this app to send the text
 * (POST /api/website/payment-failure-alert). Everything about the message is
 * decided here, not by the caller:
 *
 *   - the wording is fixed. The caller picks one area and one reason from the
 *     two short lists below and nothing it sends is copied into the text;
 *   - no guest details exist anywhere in the contract, so none can leak;
 *   - the destination is this app's own setting, never a value in the request.
 */

export const PAYMENT_FAILURE_AREAS = [
  'table_deposit_start',
  'table_deposit_capture',
  'event_ticket_start',
  'event_ticket_capture',
  'parking_start',
  'parking_capture',
] as const

export type PaymentFailureArea = (typeof PAYMENT_FAILURE_AREAS)[number]

export const PAYMENT_FAILURE_REASONS = [
  'no_answer',
  'server_error',
  'refused',
  'unexpected_error',
] as const

export type PaymentFailureReason = (typeof PAYMENT_FAILURE_REASONS)[number]

const AREA_WORDING: Record<PaymentFailureArea, string> = {
  table_deposit_start: 'starting a table deposit',
  table_deposit_capture: 'taking a table deposit',
  event_ticket_start: 'starting an event ticket payment',
  event_ticket_capture: 'taking an event ticket payment',
  parking_start: 'starting a parking payment',
  parking_capture: 'taking a parking payment',
}

const REASON_WORDING: Record<PaymentFailureReason, string> = {
  no_answer: 'The booking system did not answer.',
  server_error: 'The booking system reported an error.',
  refused: 'The booking system refused the request.',
  unexpected_error: 'The website hit an unexpected error.',
}

/** One text per area in this window. */
export const PAYMENT_FAILURE_ALERT_WINDOW_MINUTES = 10
/** Texts in any 24 hours, across every area. */
export const PAYMENT_FAILURE_ALERT_DAILY_CAP = 6

/** The API key scope the endpoint asks for. No key holds it until it is granted on purpose. */
export const PAYMENT_FAILURE_ALERT_SCOPE = 'write:ops_alerts'

export const PAYMENT_FAILURE_ALERT_TEMPLATE_KEY = 'website_payment_failure_alert'

/** The env var holding the mobile number the alert goes to, in E.164 form. */
export const OPS_ALERT_SMS_NUMBER_ENV = 'OPS_ALERT_SMS_NUMBER'

const E164_PATTERN = /^\+[1-9]\d{7,14}$/

/**
 * The fixed wording. Plain GSM-7 characters and one segment (160 characters at
 * most) for every area and reason, which the tests check.
 */
export function buildPaymentFailureAlertText(area: PaymentFailureArea, reason: PaymentFailureReason): string {
  return `Anchor website alert: a payment failed while ${AREA_WORDING[area]}. ${REASON_WORDING[reason]} See the alert email for details.`
}

export type OpsAlertNumberResolution =
  | { configured: true; number: string }
  | { configured: false; problem: 'unset' | 'not_e164' }

/**
 * Where the alert goes. Read at call time so a changed setting needs no code
 * change. An unset or malformed value is "not configured": the endpoint says so
 * rather than guessing a number.
 */
export function resolveOpsAlertSmsNumber(
  env: Record<string, string | undefined> = process.env
): OpsAlertNumberResolution {
  const raw = env[OPS_ALERT_SMS_NUMBER_ENV]?.replace(/\s+/g, '') ?? ''
  if (!raw) {
    return { configured: false, problem: 'unset' }
  }
  if (!E164_PATTERN.test(raw)) {
    return { configured: false, problem: 'not_e164' }
  }
  return { configured: true, number: raw }
}

/**
 * The ten minute slot a moment falls in. Passed to the SMS idempotency guard as
 * the dedupe stage, so two server instances that both let a request through
 * still send one text for an area in a slot.
 */
export function paymentFailureAlertSlot(area: PaymentFailureArea, nowMs: number = Date.now()): string {
  const slot = Math.floor(nowMs / (PAYMENT_FAILURE_ALERT_WINDOW_MINUTES * 60 * 1000))
  return `${area}:${slot}`
}
