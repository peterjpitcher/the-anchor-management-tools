'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { capturePayPalPayment, getPayPalOrder } from '@/lib/paypal'
import { verifyBookingToken } from '@/lib/private-bookings/booking-token'
import { logger } from '@/lib/logger'
import { finalizeDepositPayment } from '@/services/private-bookings'

function getPayPalOrderAmount(order: any): number | null {
  const raw = order?.purchase_units?.[0]?.amount?.value
  const amount = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isFinite(amount) ? amount : null
}

function amountsMatch(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 0.01
}

/**
 * Capture a PayPal deposit payment using the booking portal token as authorisation.
 * This is the customer-facing equivalent of captureDepositPayment — no staff auth required.
 * The HMAC-signed portal token proves the caller has a valid link for this booking.
 */
export async function captureDepositPaymentByToken(
  portalToken: string,
  paypalOrderId: string
): Promise<{ success?: boolean; error?: string }> {
  // Verify the portal token — this IS the authorisation
  const bookingId = verifyBookingToken(portalToken)
  if (!bookingId) {
    return { error: 'Invalid booking link' }
  }

  if (!paypalOrderId || typeof paypalOrderId !== 'string') {
    return { error: 'Missing payment reference' }
  }

  const admin = createAdminClient()

  const { data: booking, error: fetchError } = await admin
    .from('private_bookings')
    .select('id, deposit_amount, deposit_paid_date, paypal_deposit_order_id, status')
    .eq('id', bookingId)
    .maybeSingle()

  if (fetchError) {
    logger.error('Portal capture: failed to load booking', {
      error: fetchError,
      metadata: { bookingId }
    })
    return { error: 'Unable to load booking details' }
  }

  if (!booking) {
    return { error: 'Booking not found' }
  }

  // Already paid — idempotent success
  if (booking.deposit_paid_date) {
    return { success: true }
  }

  // Verify the order ID matches what we stored
  if (booking.paypal_deposit_order_id !== paypalOrderId) {
    logger.error('Portal capture: order ID mismatch', {
      metadata: { bookingId, expected: booking.paypal_deposit_order_id, received: paypalOrderId }
    })
    return { error: 'Payment reference does not match this booking' }
  }

  try {
    const expectedAmount = Number(booking.deposit_amount ?? 0)
    if (expectedAmount <= 0) {
      return { error: 'No deposit is required for this booking' }
    }

    const order = await getPayPalOrder(paypalOrderId)
    const orderAmount = getPayPalOrderAmount(order)
    if (orderAmount === null || !amountsMatch(orderAmount, expectedAmount)) {
      logger.error('Portal capture: order amount mismatch before capture', {
        metadata: { bookingId, paypalOrderId, orderAmount, expectedAmount }
      })
      return { error: 'Payment amount does not match the expected deposit. Please contact us.' }
    }

    const captureResult = await capturePayPalPayment(paypalOrderId)

    // Validate captured amount matches expected deposit
    const capturedAmount = parseFloat(captureResult.amount)
    if (!amountsMatch(capturedAmount, expectedAmount)) {
      logger.error('Portal capture: amount mismatch', {
        metadata: { bookingId, paypalOrderId, capturedAmount, expectedAmount }
      })
      return { error: 'Payment amount does not match the expected deposit. Please contact us.' }
    }

    const finalizeResult = await finalizeDepositPayment({
      bookingId,
      amount: capturedAmount,
      method: 'paypal',
      paypalCaptureId: captureResult.transactionId,
      requireAmountMatch: true,
    }, admin)

    // Audit log
    if (!finalizeResult.alreadyRecorded) {
      await admin.from('audit_logs').insert({
        action: 'paypal_deposit_captured_via_portal',
        entity_type: 'private_booking',
        entity_id: bookingId,
        metadata: {
          capture_id: captureResult.transactionId,
          order_id: paypalOrderId,
          amount: captureResult.amount,
        }
      })
    }

    logger.info('Portal capture: deposit recorded successfully', {
      metadata: { bookingId, captureId: captureResult.transactionId }
    })

    return { success: true }
  } catch (error) {
    logger.error('Portal capture: PayPal capture failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId, paypalOrderId }
    })
    return { error: 'We could not process your payment. Please contact us for assistance.' }
  }
}
