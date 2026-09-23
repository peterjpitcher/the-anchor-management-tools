/**
 * What the PayPal webhook registration SHOULD look like.
 *
 * PayPal fans every event on the app out to every registered webhook, and gives no way to scope
 * a registration to a subset of transactions. A webhook per domain was therefore five copies of
 * one feed, each endpoint discarding four fifths of what it received, and no endpoint able to
 * tell whose event it had. So the target is one registration, on one URL, carrying every event
 * type the app acts on; the app routes on the payload from there.
 *
 * Extra registrations are not a fault, just waste, so they are reported as redundant rather
 * than alerted on: the per-domain URLs still work and share the same dispatcher, which is what
 * makes reducing to one registration safe to do at any time.
 */

export const PAYPAL_CANONICAL_WEBHOOK_PATH = '/api/webhooks/paypal'

/**
 * The legacy per-domain URLs. Each still works, but none needs its own registration.
 */
export const PAYPAL_LEGACY_WEBHOOK_PATHS = [
  '/api/webhooks/paypal/invoices',
  '/api/webhooks/paypal/private-bookings',
  '/api/webhooks/paypal/table-bookings',
  '/api/webhooks/paypal/parking',
  '/api/webhooks/paypal/event-bookings',
]

/**
 * Event types the app acts on. A registration missing one of these loses real work:
 * PAYMENT.CAPTURE.COMPLETED records money in, DENIED releases a dead order, REFUNDED reconciles
 * a refund. `optionalEvents` are refund lifecycle names some PayPal products do not offer for
 * subscription, so their absence is reported for review rather than treated as a fault.
 */
export const PAYPAL_REQUIRED_EVENTS = [
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
]

export const PAYPAL_OPTIONAL_EVENTS = [
  'PAYMENT.REFUND.COMPLETED',
  'PAYMENT.REFUND.PENDING',
  'PAYMENT.REFUND.FAILED',
  'PAYMENT.REFUND.CANCELLED',
]

/**
 * `webhook_logs.status` values that mean a delivery did not end up applied. Includes the legacy
 * `signature_failed`, which pre-dates the split into specific causes and will keep appearing in
 * the 24 hour window during the transition, and the post-verification failures that a
 * signature-only check would miss entirely.
 *
 * `unrouted` is deliberately NOT here. Now that one endpoint receives everything, an event we
 * do not own is an ordinary occurrence, not a failure.
 */
export const PAYPAL_WEBHOOK_FAILURE_STATUSES = [
  // Pre-verification
  'signature_failed',
  'missing_signature_headers',
  'stale_transmission',
  'signature_rejected',
  'verification_unavailable',
  'configuration_error',
  'invalid_payload',
  // Post-verification: a cryptographically valid event that still never landed
  'error',
  'idempotency_conflict',
  'idempotency_persist_failed',
] as const
