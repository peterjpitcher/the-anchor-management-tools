export function parkingGuestUrl(baseUrl: string, bookingId: string, payment?: string): string {
  const url = new URL(`/parking/guest/${encodeURIComponent(bookingId)}`, baseUrl)
  if (payment) {
    url.searchParams.set('payment', payment)
  }
  return url.toString()
}

export function parkingPaymentReturnUrl(baseUrl: string, bookingId: string): string {
  const url = new URL('/api/parking/payment/return', baseUrl)
  url.searchParams.set('booking_id', bookingId)
  return url.toString()
}

export function parkingPaymentErrorUrl(baseUrl: string, reason: string, bookingId?: string): string {
  const url = new URL('/parking/payment-error', baseUrl)
  url.searchParams.set('reason', reason)
  if (bookingId) {
    url.searchParams.set('booking_id', bookingId)
  }
  return url.toString()
}
