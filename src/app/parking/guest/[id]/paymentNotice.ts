import type { ParkingBooking, ParkingPaymentStatus } from '@/types/parking'

export type ParkingPaymentNoticeTone = 'success' | 'warning' | 'error' | 'info'

export interface ParkingPaymentNotice {
  tone: ParkingPaymentNoticeTone
  title: string
  message: string
}

const FAILURE_QUERY_MESSAGES: Record<string, ParkingPaymentNotice> = {
  missing_parameters: {
    tone: 'error',
    title: 'Payment could not be checked',
    message: 'The payment return link was missing details. Please try the payment again or contact the team.',
  },
  not_found: {
    tone: 'error',
    title: 'Payment could not be matched',
    message: 'We could not match that PayPal payment to this booking. Please contact the team and quote your booking reference.',
  },
  failed: {
    tone: 'error',
    title: 'Payment failed',
    message: 'We were unable to confirm your payment. Please try again or contact the team and quote your booking reference.',
  },
  retry_failed: {
    tone: 'error',
    title: 'Payment retry unavailable',
    message: 'We could not prepare a fresh payment link. Please contact the team and quote your booking reference.',
  },
  expired: {
    tone: 'error',
    title: 'Payment window expired',
    message: 'This payment window has expired. Please contact the team and quote your booking reference.',
  },
  amount_changed: {
    tone: 'warning',
    title: 'The amount has changed',
    message: 'That payment link was for an amount that is no longer owed, so nothing was taken. This page shows what is owed now.',
  },
}

function formatPounds(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/**
 * The notice for a confirmed booking that still owes extra after its dates grew (spec section 7).
 * Comes before the plain "Payment received" notice, which would otherwise hide the balance.
 */
export function buildParkingBalanceNotice(balanceDue: number, paymentQuery?: string): ParkingPaymentNotice | null {
  if (!(balanceDue > 0)) return null
  if (paymentQuery && paymentQuery !== 'success' && FAILURE_QUERY_MESSAGES[paymentQuery]) {
    const failure = FAILURE_QUERY_MESSAGES[paymentQuery]
    return { ...failure, message: `${failure.message} There is ${formatPounds(balanceDue)} still to pay.` }
  }
  return {
    tone: 'warning',
    title: `${formatPounds(balanceDue)} still to pay`,
    message: `Your parking dates have changed. There is ${formatPounds(balanceDue)} still to pay for your new dates.`,
  }
}

export function buildParkingPaymentNotice(
  paymentStatus: ParkingPaymentStatus | string,
  paymentQuery?: string,
): ParkingPaymentNotice | null {
  if (paymentQuery === 'success' || paymentStatus === 'paid') {
    return {
      tone: 'success',
      title: 'Payment received',
      message: 'Thanks for completing your payment. Your parking space is now confirmed.',
    }
  }

  if (paymentQuery === 'cancelled') {
    return {
      tone: 'warning',
      title: 'Payment cancelled',
      message: 'Your booking is still awaiting payment. You can try again below.',
    }
  }

  if (paymentQuery && FAILURE_QUERY_MESSAGES[paymentQuery]) {
    return FAILURE_QUERY_MESSAGES[paymentQuery]
  }

  if (paymentStatus === 'failed') {
    return {
      tone: 'error',
      title: 'Payment needed',
      message: 'The last payment attempt failed. Please try again or contact the team and quote your booking reference.',
    }
  }

  if (paymentStatus === 'pending') {
    return {
      tone: 'warning',
      title: 'Payment needed',
      message: 'We have received your booking, but payment is still needed to confirm the space.',
    }
  }

  if (paymentStatus === 'refunded') {
    return {
      tone: 'info',
      title: 'Booking refunded',
      message: 'This booking has been refunded. If you have any questions, please contact the team.',
    }
  }

  if (paymentStatus === 'expired') {
    return {
      tone: 'error',
      title: 'Payment window expired',
      message: 'This payment window has expired. Please contact the team and quote your booking reference.',
    }
  }

  return null
}

export function canRetryParkingPayment(booking: ParkingBooking, now = new Date()): boolean {
  if (booking.status !== 'pending_payment') return false
  if (booking.payment_status !== 'pending' && booking.payment_status !== 'failed') return false

  const amount = booking.override_price ?? booking.calculated_price
  if (!amount || amount <= 0) return false

  if (!booking.payment_due_at) return false
  const dueAt = new Date(booking.payment_due_at)
  if (Number.isNaN(dueAt.getTime())) return false

  return dueAt > now
}
