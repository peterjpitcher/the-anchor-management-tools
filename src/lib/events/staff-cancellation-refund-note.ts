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
  /**
   * Of the refund chosen, what was paid at the bar in cash or by card and is handed back there,
   * not through PayPal (BK-135; review finding on PR 277). refundAmount is then the PayPal part.
   */
  barRefundAmount?: number
}): string | null {
  const amount = Number.isFinite(input.refundAmount) ? input.refundAmount : 0
  const barAmount = Number.isFinite(input.barRefundAmount) ? Math.max(0, input.barRefundAmount ?? 0) : 0
  const money = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
  if (barAmount > 0) {
    const bar = `we'll hand back the ${money(barAmount)} you paid at the bar`
    if (amount <= 0) return `You paid ${money(barAmount)} at the bar, so we'll be in touch to give it back.`
    if (input.refundStatus === 'succeeded') return `Refund issued: ${money(amount)}, and ${bar}.`
    if (input.refundStatus === 'pending') return `Refund pending: ${money(amount)}, and ${bar}.`
    return `We'll be in touch about your ${money(amount)} refund, and ${bar}.`
  }
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
