export function tablePaymentBlockedReasonMessage(reason: string | undefined): string {
  switch (reason) {
    case 'invalid_token':
      return 'This payment link is invalid. Please request a fresh payment link.'
    case 'token_used':
      return 'This payment link has already been used.'
    case 'token_expired':
      return 'This payment link has expired.'
    case 'booking_not_found':
      return 'We could not find the booking for this payment link.'
    case 'booking_not_pending_payment':
      return 'This booking is no longer awaiting payment.'
    case 'hold_expired':
      return 'The payment window for this booking has expired.'
    case 'token_customer_mismatch':
      return 'This payment link does not match the booking details.'
    case 'invalid_amount':
      return 'The payment amount for this booking could not be verified.'
    case 'stripe_unavailable':
      return 'Our secure payment service is temporarily unavailable. Please try again shortly.'
    case 'internal_error':
      return 'We hit an internal error while opening this payment link.'
    case 'rate_limited':
      return 'Too many attempts were made with this payment link. Please wait a few minutes and try again.'
    default:
      return 'This payment link is no longer available.'
  }
}
