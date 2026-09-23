/**
 * The one list of PayPal webhook endpoints this app runs, and what each one needs
 * subscribed in the PayPal dashboard.
 *
 * It is shared by the health cron and by the registration instructions so the two can never
 * drift. `requiredEvents` are the capture lifecycle events PayPal documents and that the
 * handler here actually does something with: a missing one is a real gap. `optionalEvents`
 * are refund lifecycle names the handler recognises; subscribe them where the dashboard
 * offers them, but their absence is reported for review rather than treated as a fault,
 * because the subscribable set differs by PayPal product and is not ours to assume.
 *
 * The legacy `/api/webhooks/paypal` route is deliberately absent: it has no registration and
 * none is wanted.
 */

export type PayPalWebhookEndpoint = {
  /** Value written to `webhook_logs.params.source` by this endpoint. */
  source: string
  /** Path under the app URL, no trailing slash. */
  path: string
  /** Human label for alerts. */
  label: string
  requiredEvents: string[]
  optionalEvents: string[]
}

export const PAYPAL_WEBHOOK_ENDPOINTS: PayPalWebhookEndpoint[] = [
  {
    source: 'invoices',
    path: '/api/webhooks/paypal/invoices',
    label: 'Invoices',
    requiredEvents: ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED'],
    optionalEvents: [],
  },
  {
    source: 'private_bookings',
    path: '/api/webhooks/paypal/private-bookings',
    label: 'Private bookings',
    requiredEvents: [
      'PAYMENT.CAPTURE.COMPLETED',
      'PAYMENT.CAPTURE.DENIED',
      'PAYMENT.CAPTURE.REFUNDED',
    ],
    optionalEvents: ['PAYMENT.REFUND.PENDING', 'PAYMENT.REFUND.FAILED'],
  },
  {
    source: 'table_bookings',
    path: '/api/webhooks/paypal/table-bookings',
    label: 'Table bookings',
    // No PAYMENT.CAPTURE.DENIED handler here, unlike invoices and private bookings.
    requiredEvents: ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED'],
    optionalEvents: ['PAYMENT.REFUND.PENDING', 'PAYMENT.REFUND.FAILED'],
  },
  {
    source: 'parking',
    path: '/api/webhooks/paypal/parking',
    label: 'Parking',
    requiredEvents: [
      'PAYMENT.CAPTURE.COMPLETED',
      'PAYMENT.CAPTURE.DENIED',
      'PAYMENT.CAPTURE.REFUNDED',
    ],
    optionalEvents: ['PAYMENT.REFUND.PENDING', 'PAYMENT.REFUND.FAILED'],
  },
  {
    source: 'event_bookings',
    path: '/api/webhooks/paypal/event-bookings',
    label: 'Event bookings',
    requiredEvents: ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED'],
    optionalEvents: [
      'PAYMENT.REFUND.COMPLETED',
      'PAYMENT.REFUND.FAILED',
      'PAYMENT.REFUND.CANCELLED',
    ],
  },
]

/**
 * `webhook_logs.status` values that mean a delivery did not end up applied. Includes the
 * legacy `signature_failed`, which pre-dates the split into specific causes and will keep
 * appearing in the 24 hour window during the transition, and the post-verification failures
 * that a signature-only check would miss entirely.
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

export function getPayPalWebhookEndpointBySource(source: string): PayPalWebhookEndpoint | undefined {
  return PAYPAL_WEBHOOK_ENDPOINTS.find((endpoint) => endpoint.source === source)
}
