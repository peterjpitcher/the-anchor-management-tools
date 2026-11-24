import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * Parking payment handlers. Every PayPal webhook URL dispatches here.
 *
 * A booking can hold more than one payment (a top-up after its dates grew, spec section 7), so an
 * event is matched to its own row by the PayPal capture or order id, never by "the newest row". An
 * event that matches no row is logged and acknowledged: throwing would only make PayPal retry it
 * for days. Database read errors still throw, so a real outage is retried.
 */

/** The PayPal order behind a capture event, from resource.supplementary_data.related_ids. */
function relatedOrderId(resource: any): string | null {
  const orderId = resource?.supplementary_data?.related_ids?.order_id
  return typeof orderId === 'string' && orderId.trim() ? orderId.trim() : null
}

type PaymentRowRef = { id: string; transaction_id: string | null; status: string; amount: unknown; currency: unknown }

/** The booking's payment row for this event, by capture id first, then by order id. */
async function findPaymentRowForEvent(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  captureId: string | null,
  orderId: string | null
): Promise<PaymentRowRef | null> {
  if (captureId) {
    const { data, error } = await supabase
      .from('parking_booking_payments')
      .select('id, transaction_id, status, amount, currency')
      .eq('booking_id', bookingId)
      .eq('transaction_id', captureId)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`Failed to load parking payment by capture id: ${error.message}`)
    if (data) return data as PaymentRowRef
  }
  if (orderId) {
    const { data, error } = await supabase
      .from('parking_booking_payments')
      .select('id, transaction_id, status, amount, currency')
      .eq('booking_id', bookingId)
      .eq('paypal_order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`Failed to load parking payment by order id: ${error.message}`)
    if (data) return data as PaymentRowRef
  }
  return null
}

function parsePayPalMoney(value: unknown): number | null {
  const amount = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null
}

function payPalMoneyMatches(actual: number, expected: number): boolean {
  return Math.abs(Number(actual.toFixed(2)) - Number(expected.toFixed(2))) <= 0.01
}

function normalizeCurrency(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null
}

export async function handlePaymentCompleted(supabase: ReturnType<typeof createAdminClient>, event: any) {
  const resource = event.resource
  const bookingId = resource.custom_id
  const captureId = resource.id
  const amount = parsePayPalMoney(resource.amount?.value)
  const currency = normalizeCurrency(resource.amount?.currency_code)

  if (!bookingId) {
    throw new Error('Parking payment completed webhook missing booking ID')
  }
  if (amount === null || !currency) {
    throw new Error('Parking payment completed webhook missing amount or currency')
  }

  const { data: booking, error: bookingLookupError } = await supabase
    .from('parking_bookings')
    .select('id, payment_status, status, reference')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingLookupError) {
    throw new Error(`Failed to load parking booking: ${bookingLookupError.message}`)
  }

  if (!booking) {
    throw new Error(`Parking booking not found for payment webhook: ${bookingId}`)
  }

  const expectedPayment = await findPaymentRowForEvent(supabase, bookingId, captureId ?? null, relatedOrderId(resource))
  if (!expectedPayment) {
    // Not ours to place: an event for an order this booking never recorded. Acknowledge it.
    logger.error('Parking capture webhook matched no payment row; acknowledged without changes', {
      error: new Error('Unplaced parking capture event'),
      metadata: { bookingId, captureId, orderId: relatedOrderId(resource), eventId: event.id }
    })
    return
  }

  const expectedAmount = parsePayPalMoney(expectedPayment.amount)
  const expectedCurrency = normalizeCurrency(expectedPayment.currency)
  if (
    expectedAmount === null ||
    !expectedCurrency ||
    !payPalMoneyMatches(amount, expectedAmount) ||
    currency !== expectedCurrency
  ) {
    throw new Error(`PayPal capture amount or currency mismatch for parking booking ${bookingId}`)
  }

  const { data: updatedPayment, error: paymentUpdateError } = await supabase
    .from('parking_booking_payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      transaction_id: captureId,
      metadata: {
        capture_id: captureId,
        webhook_event_id: event.id,
        amount
      }
    })
    .eq('id', expectedPayment.id)
    .eq('status', 'pending')
    .select('id, transaction_id')
    .maybeSingle()

  if (paymentUpdateError) {
    throw new Error(`Failed to update parking payment from webhook: ${paymentUpdateError.message}`)
  }

  if (!updatedPayment) {
    const { data: existingPayment, error: existingPaymentLookupError } = await supabase
      .from('parking_booking_payments')
      .select('id, transaction_id, status')
      .eq('id', expectedPayment.id)
      .maybeSingle()

    if (existingPaymentLookupError) {
      throw new Error(`Failed to verify existing parking payment: ${existingPaymentLookupError.message}`)
    }

    if (!existingPayment) {
      throw new Error(`No parking payment found for booking ${bookingId}`)
    }

    if (
      existingPayment.transaction_id &&
      captureId &&
      existingPayment.transaction_id !== captureId
    ) {
      throw new Error(
        `Capture id mismatch for booking ${bookingId}: existing=${existingPayment.transaction_id} incoming=${captureId}`
      )
    }

    if (existingPayment.status === 'refunded') {
      logger.warn('Ignoring stale PayPal capture completion for already-refunded booking', {
        metadata: { bookingId }
      })
      return
    }

    if (existingPayment.status === 'failed') {
      const { data: recoveredPayment, error: recoverPaymentError } = await supabase
        .from('parking_booking_payments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          transaction_id: captureId,
          metadata: {
            capture_id: captureId,
            webhook_event_id: event.id,
            amount
          }
        })
        .eq('id', existingPayment.id)
        .eq('status', 'failed')
        .select('id')
        .maybeSingle()

      if (recoverPaymentError) {
        throw new Error(`Failed to recover failed parking payment to paid: ${recoverPaymentError.message}`)
      }

      if (!recoveredPayment) {
        throw new Error(`Failed to recover parking payment ${existingPayment.id} to paid`)
      }
    } else if (existingPayment.status !== 'paid') {
      throw new Error(`Unsupported parking payment status for completion webhook: ${existingPayment.status}`)
    }
  }

  if (booking.payment_status !== 'refunded') {
    if (booking.status === 'cancelled') {
      const { data: cancelledBookingPaymentRow, error: cancelledBookingPaymentUpdateError } = await supabase
        .from('parking_bookings')
        .update({
          payment_status: 'paid'
        })
        .eq('id', bookingId)
        .select('id')
        .maybeSingle()

      if (cancelledBookingPaymentUpdateError) {
        throw new Error(`Failed to update cancelled parking booking payment state: ${cancelledBookingPaymentUpdateError.message}`)
      }
      if (!cancelledBookingPaymentRow) {
        throw new Error(`Cancelled parking booking missing during payment webhook update: ${bookingId}`)
      }
    } else if (booking.status === 'confirmed' || booking.status === 'completed') {
      // A live or finished booking keeps its status and confirmation time: this is a late event
      // for its first payment, or a top-up. Only a payment state that is not yet 'paid' is set.
      if (booking.payment_status !== 'paid') {
        const { error: paidError } = await supabase
          .from('parking_bookings')
          .update({ payment_status: 'paid' })
          .eq('id', bookingId)
          .neq('payment_status', 'refunded')
        if (paidError) {
          throw new Error(`Failed to update parking booking payment state: ${paidError.message}`)
        }
      }
    } else {
      const { data: bookingUpdateRow, error: bookingUpdateError } = await supabase
        .from('parking_bookings')
        .update({
          payment_status: 'paid',
          status: 'confirmed',
          confirmed_at: new Date().toISOString()
        })
        .eq('id', bookingId)
        .select('id')
        .maybeSingle()

      if (bookingUpdateError) {
        throw new Error(`Failed to update parking booking from webhook: ${bookingUpdateError.message}`)
      }
      if (!bookingUpdateRow) {
        throw new Error(`Parking booking missing during payment webhook update: ${bookingId}`)
      }
    }
  } else {
    logger.warn('Skipping booking status update for refunded parking booking', {
      metadata: { bookingId }
    })
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      operation_type: 'payment_webhook_confirmed',
      resource_type: 'parking_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        amount,
        event_id: event.id,
        transaction_id: captureId,
        reference: booking.reference
      }
    })

  if (auditError) {
    throw new Error(`Failed to write parking payment webhook audit log: ${auditError.message}`)
  }
}

export async function handlePaymentDenied(supabase: ReturnType<typeof createAdminClient>, event: any) {
  const resource = event.resource
  const bookingId = resource.custom_id
  const reason = resource.status_details?.reason || 'DENIED'

  if (!bookingId) {
    throw new Error('Parking payment denied webhook missing booking ID')
  }

  // Scoped to the denied order when the event names it, so a late denial for one order never
  // fails another order's pending row (a top-up made since).
  const orderId = relatedOrderId(resource)
  let denyQuery = supabase
    .from('parking_booking_payments')
    .update({
      status: 'failed',
      metadata: {
        webhook_event_id: event.id,
        failure_reason: reason
      }
    })
    .eq('booking_id', bookingId)
    .eq('status', 'pending')
  if (orderId) denyQuery = denyQuery.eq('paypal_order_id', orderId)
  const { data: deniedPayment, error: paymentUpdateError } = await denyQuery
    .select('id')
    .maybeSingle()

  if (paymentUpdateError) {
    throw new Error(`Failed to mark parking payment denied: ${paymentUpdateError.message}`)
  }

  if (!deniedPayment) {
    let existingQuery = supabase
      .from('parking_booking_payments')
      .select('id, status')
      .eq('booking_id', bookingId)
    if (orderId) existingQuery = existingQuery.eq('paypal_order_id', orderId)
    const { data: existingPayment, error: existingPaymentLookupError } = await existingQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingPaymentLookupError) {
      throw new Error(`Failed to verify existing parking payment after denied webhook: ${existingPaymentLookupError.message}`)
    }

    if (!existingPayment) {
      if (orderId) {
        logger.error('Parking capture denial matched no payment row; acknowledged without changes', {
          error: new Error('Unplaced parking denial event'),
          metadata: { bookingId, orderId, eventId: event.id }
        })
        return
      }
      throw new Error(`No parking payment found for denied webhook booking ${bookingId}`)
    }

    if (existingPayment.status === 'failed') {
      await markParkingBookingPaymentFailed(supabase, bookingId, event.id)
    } else if (existingPayment.status === 'paid' || existingPayment.status === 'refunded' || existingPayment.status === 'expired') {
      return
    } else {
      throw new Error(`Unsupported parking payment status for denied webhook: ${existingPayment.status}`)
    }
  } else {
    await markParkingBookingPaymentFailed(supabase, bookingId, event.id)
  }

  const { error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      operation_type: 'payment_webhook_denied',
      resource_type: 'parking_booking',
      resource_id: bookingId,
      operation_status: 'failure',
      additional_info: {
        event_id: event.id,
        reason
      }
    })

  if (auditError) {
    throw new Error(`Failed to write denied parking payment audit log: ${auditError.message}`)
  }
}

async function markParkingBookingPaymentFailed(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  eventId: string
) {
  const { data: updatedBooking, error: bookingUpdateError } = await supabase
    .from('parking_bookings')
    .update({ payment_status: 'failed' })
    .eq('id', bookingId)
    .eq('payment_status', 'pending')
    .select('id')
    .maybeSingle()

  if (bookingUpdateError) {
    throw new Error(`Failed to mark parking booking payment failed: ${bookingUpdateError.message}`)
  }

  if (updatedBooking) {
    return
  }

  const { data: booking, error: bookingLookupError } = await supabase
    .from('parking_bookings')
    .select('id, payment_status')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingLookupError) {
    throw new Error(`Failed to verify parking booking payment state: ${bookingLookupError.message}`)
  }

  if (!booking) {
    throw new Error(`Parking booking not found for denied payment webhook: ${bookingId}`)
  }

  if (booking.payment_status === 'failed') {
    return
  }

  if (booking.payment_status === 'paid' || booking.payment_status === 'refunded' || booking.payment_status === 'expired') {
    logger.warn('Ignoring stale PayPal capture denial for terminal parking booking', {
      metadata: {
        bookingId,
        eventId,
        paymentStatus: booking.payment_status
      }
    })
    return
  }

  throw new Error(`Unsupported parking booking payment status for denied webhook: ${booking.payment_status}`)
}
