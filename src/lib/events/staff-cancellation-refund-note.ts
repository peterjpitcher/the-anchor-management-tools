/**
 * The refund sentence in the text a guest gets when staff cancel their event booking.
 *
 * It used to say "No refund is due under the event cancellation policy." whenever no refund was
 * issued, so guests who never paid (free nights, pay on the night, unpaid holds) read it as money
 * lost (BK-090, customer bookings review of 24 October 2026). The email already knew whether money
 * was taken; the text now gets the same fact. Wording approved under owner decision D15.
 *
 * Plain ASCII apostrophes only: the text stays in GSM-7.
 */
export type StaffCancellationRefundStatus = 'succeeded' | 'pending' | 'manual_required' | 'failed' | 'none'

export function buildStaffCancellationRefundNote(input: {
  refundStatus: StaffCancellationRefundStatus | string
  refundAmount: number
  /** True when money was actually taken for this booking (what it could be refunded). */
  paymentTaken: boolean
}): string | null {
  const amount = Number.isFinite(input.refundAmount) ? input.refundAmount : 0
  if (amount <= 0) {
    // Nothing was paid, so there is nothing to say about a refund.
    if (!input.paymentTaken) return null
    return 'This booking was not refunded.'
  }
  const formatted = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
  if (input.refundStatus === 'succeeded') return `Refund issued: ${formatted}.`
  if (input.refundStatus === 'pending') return `Refund pending: ${formatted}.`
  if (input.refundStatus === 'manual_required' || input.refundStatus === 'failed') {
    return `We'll be in touch about your ${formatted} refund.`
  }
  return null
}
