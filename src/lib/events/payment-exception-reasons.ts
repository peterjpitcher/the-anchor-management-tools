/**
 * Staff wording for each reason an event payment needs a person (event_payment_exceptions.reason).
 * Kept apart from the server actions so the event page can use it too.
 */
const REASON_TEXT: Record<string, string> = {
  capacity_unavailable_after_capture: 'Paid after the hold ran out, and the places had been taken',
  table_unavailable_after_capture: 'Paid, but no table was free',
  booking_expired_after_capture: 'Paid after the hold had run out',
  confirmation_failed_after_capture: 'Paid, but the booking could not be updated',
  manual_refund_required: 'A refund needs doing by hand',
}

export function describeEventPaymentExceptionReason(reason: string): string {
  return REASON_TEXT[reason] ?? 'Needs a person to check'
}
