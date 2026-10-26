/**
 * What a capture's own status means for a booking (BK-019, customer bookings review of
 * 24 October 2026). Only `completed` may confirm a booking or record a deposit as paid.
 * `pending` is money PayPal is holding for review: nothing is confirmed, nothing is offered for
 * payment again, and the PAYMENT.CAPTURE.COMPLETED webhook settles it later. Anything else
 * (DECLINED, FAILED, or no status at all) has not been paid. A missing status is treated as
 * pending rather than declined, because a person should look before the guest is told no money
 * moved.
 */
export type PayPalCaptureOutcome = 'completed' | 'pending' | 'declined'

export function payPalCaptureOutcome(captureStatus: string | null | undefined): PayPalCaptureOutcome {
  const status = typeof captureStatus === 'string' ? captureStatus.trim().toUpperCase() : ''
  if (status === 'COMPLETED') return 'completed'
  if (status === 'PENDING' || status === '') return 'pending'
  return 'declined'
}
