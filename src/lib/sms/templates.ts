import { getSmartFirstName } from '@/lib/sms/name-utils'

/**
 * SMS sent to customers when an event's date or time changes.
 */
export function buildEventRescheduledSms(payload: {
  firstName: string | null | undefined
  eventName: string
  newDate: string // Pre-formatted London datetime string
  seats: number
  manageLink?: string | null
}): string {
  const name = getSmartFirstName(payload.firstName)
  const seatWord = payload.seats === 1 ? 'seat' : 'seats'
  const managePart = payload.manageLink ? ` ${payload.manageLink}` : ''
  return `The Anchor: Hi ${name}, heads up — ${payload.eventName} has moved to ${payload.newDate}. Your booking for ${payload.seats} ${seatWord} is still confirmed.${managePart}`
}

/**
 * SMS sent to customers when an event is cancelled.
 */
export function buildEventCancelledSms(payload: {
  firstName: string | null | undefined
  eventName: string
  eventDate: string // Pre-formatted London datetime string
  refundNote?: string | null
}): string {
  const name = getSmartFirstName(payload.firstName)
  const refundPart = payload.refundNote ? ` ${payload.refundNote}` : ''
  return `The Anchor: Hi ${name}, unfortunately ${payload.eventName} on ${payload.eventDate} has been cancelled.${refundPart} We're sorry for the inconvenience.`
}

/**
 * Builds the refund note for cancellation SMS based on payment state.
 */
export function buildRefundNote(params: {
  isPrepaid: boolean
  refundSucceeded: boolean
  refundAmount?: number | null
}): string | null {
  if (!params.isPrepaid) return null
  if (params.refundSucceeded && params.refundAmount) {
    return `Your payment of £${params.refundAmount.toFixed(2)} will be refunded within 5-10 business days.`
  }
  if (params.refundSucceeded) {
    return 'Your payment will be refunded within 5-10 business days.'
  }
  return 'Please contact us about your refund.'
}
