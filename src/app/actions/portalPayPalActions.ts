'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { PAYPAL_DEFAULT_CURRENCY, capturePayPalPayment, createSimplePayPalOrder, getPayPalOrder } from '@/lib/paypal'
import { verifyBookingToken } from '@/lib/private-bookings/booking-token'
import { logger } from '@/lib/logger'
import { finalizeDepositPayment } from '@/services/private-bookings'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'

function getPayPalOrderAmount(order: any): number | null {
  const raw = order?.purchase_units?.[0]?.amount?.value
  const amount = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isFinite(amount) ? amount : null
}

function getPayPalOrderCurrency(order: any): string | null {
  const raw = order?.purchase_units?.[0]?.amount?.currency_code
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null
}

function amountsMatch(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 0.01
}

function getPayPalOrderApproveUrl(order: any): string | null {
  const links = Array.isArray(order?.links) ? order.links : []
  const link = links.find((candidate: any) => candidate?.rel === 'payer-action')
    || links.find((candidate: any) => candidate?.rel === 'approve')
  return typeof link?.href === 'string' && link.href.trim() ? link.href : null
}

function payPalOrderBelongsToBooking(order: any, bookingId: string): boolean {
  const purchaseUnit = order?.purchase_units?.[0]
  return purchaseUnit?.reference_id === bookingId
    && purchaseUnit?.custom_id === `pb-deposit-${bookingId}`
}

function isReusablePayPalOrder(order: any): boolean {
  return ['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(order?.status)
    && getPayPalOrderApproveUrl(order) !== null
}

function paymentOrderRequestId(bookingId: string, updatedAt: string | null | undefined): string {
  const generation = updatedAt?.replace(/[^0-9]/g, '').slice(0, 17) || 'initial'
  return `pb-deposit-portal-${bookingId}-${generation}`
}

async function writePrivateBookingAudit(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    operationType: string
    bookingId: string
    additionalInfo: Record<string, unknown>
  }
) {
  return admin.from('audit_logs').insert({
    operation_type: params.operationType,
    resource_type: 'private_booking',
    resource_id: params.bookingId,
    operation_status: 'success',
    additional_info: params.additionalInfo,
  })
}

/**
 * Create a fresh PayPal deposit order from the signed booking portal link.
 * This lets customers recover from an expired PayPal approval URL without staff
 * manually resending the email.
 */
export async function createDepositPaymentOrderByToken(
  portalToken: string
): Promise<{ success?: boolean; approveUrl?: string; error?: string }> {
  const bookingId = verifyBookingToken(portalToken)
  if (!bookingId) {
    return { error: 'Invalid booking link' }
  }

  const admin = createAdminClient()
  const { data: booking, error: fetchError } = await admin
    .from('private_bookings')
    .select('id, deposit_amount, deposit_paid_date, paypal_deposit_order_id, status, event_date, event_type, updated_at')
    .eq('id', bookingId)
    .maybeSingle()

  if (fetchError) {
    logger.error('Portal PayPal order: failed to load booking', {
      error: fetchError,
      metadata: { bookingId },
    })
    return { error: 'Unable to load booking details' }
  }

  if (!booking) {
    return { error: 'Booking not found' }
  }

  if (booking.status === 'cancelled' || booking.status === 'completed') {
    return { error: 'This booking can no longer accept a deposit payment' }
  }

  if (booking.deposit_paid_date) {
    return { error: 'Deposit has already been paid' }
  }

  const depositAmount = Number(booking.deposit_amount ?? 0)
  if (depositAmount <= 0) {
    return { error: 'No deposit is required for this booking' }
  }

  // Reuse a live order. This is important for email security scanners and
  // customers with several tabs open: creating a new order must not invalidate
  // the valid link they already have.
  if (booking.paypal_deposit_order_id) {
    try {
      const existingOrder = await getPayPalOrder(booking.paypal_deposit_order_id)
      const existingAmount = getPayPalOrderAmount(existingOrder)
      const existingCurrency = getPayPalOrderCurrency(existingOrder)
      const approveUrl = getPayPalOrderApproveUrl(existingOrder)

      if (
        isReusablePayPalOrder(existingOrder)
        && payPalOrderBelongsToBooking(existingOrder, bookingId)
        && existingAmount !== null
        && amountsMatch(existingAmount, depositAmount)
        && existingCurrency === PAYPAL_DEFAULT_CURRENCY
        && approveUrl
      ) {
        return { success: true, approveUrl }
      }
    } catch (error) {
      logger.warn('Portal PayPal order: existing order could not be reused', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId, orderId: booking.paypal_deposit_order_id },
      })
    }
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const portalUrl = `${appUrl}/booking-portal/${portalToken}`
    const result = await createSimplePayPalOrder({
      customId: `pb-deposit-${bookingId}`,
      reference: bookingId,
      description: `Deposit for ${booking.event_type || 'Private Booking'} on ${booking.event_date}`,
      amount: depositAmount,
      returnUrl: `${portalUrl}?payment_pending=1`,
      cancelUrl: portalUrl,
      currency: PAYPAL_DEFAULT_CURRENCY,
      brandName: 'The Anchor',
      // Requests that raced from the same booking version get the same PayPal
      // idempotency key and therefore the same order.
      requestId: paymentOrderRequestId(bookingId, booking.updated_at),
    })

    const { data: updatedBooking, error: updateError } = await admin
      .from('private_bookings')
      .update({
        paypal_deposit_order_id: result.orderId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .is('deposit_paid_date', null)
      .select('id')
      .maybeSingle()

    if (updateError || !updatedBooking) {
      logger.error('Portal PayPal order: failed to persist order ID', {
        error: updateError ?? new Error('Portal PayPal order update affected no rows'),
        metadata: { bookingId, orderId: result.orderId },
      })
      return { error: 'Unable to prepare your payment link. Please contact us.' }
    }

    const { error: auditError } = await writePrivateBookingAudit(admin, {
      operationType: 'paypal_deposit_order_created_via_portal',
      bookingId,
      additionalInfo: {
        order_id: result.orderId,
        source: 'booking_portal',
      },
    })

    if (auditError) {
      logger.error('Portal PayPal order: failed to write audit log', {
        error: auditError,
        metadata: { bookingId, orderId: result.orderId },
      })
    }

    return { success: true, approveUrl: result.approveUrl }
  } catch (error) {
    logger.error('Portal PayPal order: failed to create PayPal order', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return { error: 'Unable to create a fresh payment link. Please contact us.' }
  }
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

  const expectedAmount = Number(booking.deposit_amount ?? 0)
  if (expectedAmount <= 0) {
    return { error: 'No deposit is required for this booking' }
  }

  const captureKey = `private-booking-deposit-capture:${bookingId}`
  const captureHash = computeIdempotencyRequestHash({ bookingId, action: 'capture_deposit' })
  let captureClaimed = false
  let paymentCaptured = false
  const pendingConfirmationResponse = {
    error: 'Your payment has been received and is being confirmed. Please wait a moment before trying again.',
  }

  try {
    const order = await getPayPalOrder(paypalOrderId)
    const orderAmount = getPayPalOrderAmount(order)
    const orderCurrency = getPayPalOrderCurrency(order)

    // A newer order may have been stored after an email scanner or another tab
    // opened the portal. Accept the returned order only when PayPal itself says
    // it belongs to this exact booking.
    if (!payPalOrderBelongsToBooking(order, bookingId)) {
      logger.error('Portal capture: order does not belong to booking', {
        metadata: { bookingId, expected: booking.paypal_deposit_order_id, received: paypalOrderId }
      })
      return { error: 'Payment reference does not match this booking' }
    }

    if (
      orderAmount === null ||
      !amountsMatch(orderAmount, expectedAmount) ||
      orderCurrency !== PAYPAL_DEFAULT_CURRENCY
    ) {
      logger.error('Portal capture: order amount mismatch before capture', {
        metadata: { bookingId, paypalOrderId, orderAmount, orderCurrency, expectedAmount, expectedCurrency: PAYPAL_DEFAULT_CURRENCY }
      })
      return { error: 'Payment amount does not match the expected deposit. Please contact us.' }
    }

    const claim = await claimIdempotencyKey(admin, captureKey, captureHash)
    if (claim.state === 'in_progress') {
      return { error: 'Your payment is already being confirmed. Please wait a moment.' }
    }
    if (claim.state === 'conflict') {
      return { error: 'We could not safely confirm this payment. Please contact us for assistance.' }
    }
    if (claim.state === 'replay') {
      const replay = claim.response as { success?: boolean; error?: string } | null
      return replay?.success
        ? { success: true }
        : { error: replay?.error || pendingConfirmationResponse.error }
    }
    captureClaimed = true

    const captureResult = await capturePayPalPayment(paypalOrderId, PAYPAL_DEFAULT_CURRENCY)
    paymentCaptured = true

    // From this point onward PayPal has taken the money. Persist that fact before
    // local finalisation so another valid order cannot be captured if this
    // invocation is interrupted.
    try {
      await persistIdempotencyResponse(
        admin,
        captureKey,
        captureHash,
        pendingConfirmationResponse,
      )
    } catch (persistError) {
      logger.error('Portal capture: failed to persist captured-payment state', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: { bookingId, paypalOrderId },
      })
    }

    // Validate captured amount matches expected deposit
    const capturedAmount = parseFloat(captureResult.amount)
    if (!amountsMatch(capturedAmount, expectedAmount)) {
      logger.error('Portal capture: amount mismatch', {
        metadata: { bookingId, paypalOrderId, capturedAmount, expectedAmount }
      })
      return pendingConfirmationResponse
    }

    const finalizeResult = await finalizeDepositPayment({
      bookingId,
      amount: capturedAmount,
      method: 'paypal',
      paypalCaptureId: captureResult.transactionId,
    }, admin)

    // Audit log
    if (!finalizeResult.alreadyRecorded) {
      const { error: auditError } = await writePrivateBookingAudit(admin, {
        operationType: 'paypal_deposit_captured_via_portal',
        bookingId,
        additionalInfo: {
          capture_id: captureResult.transactionId,
          order_id: paypalOrderId,
          amount: captureResult.amount,
          currency: captureResult.currency,
        }
      })

      if (auditError) {
        logger.error('Portal capture: failed to write audit log', {
          error: auditError,
          metadata: { bookingId, captureId: captureResult.transactionId },
        })
      }
    }

    logger.info('Portal capture: deposit recorded successfully', {
      metadata: { bookingId, captureId: captureResult.transactionId }
    })

    try {
      await persistIdempotencyResponse(admin, captureKey, captureHash, { success: true })
    } catch (persistError) {
      logger.error('Portal capture: failed to persist successful capture response', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: { bookingId, paypalOrderId },
      })
    }
    return { success: true }
  } catch (error) {
    if (captureClaimed && !paymentCaptured) {
      try {
        await releaseIdempotencyClaim(admin, captureKey, captureHash)
      } catch (releaseError) {
        logger.error('Portal capture: failed to release capture claim', {
          error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
          metadata: { bookingId, paypalOrderId },
        })
      }
    }

    logger.error('Portal capture: PayPal capture failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId, paypalOrderId }
    })
    return paymentCaptured
      ? pendingConfirmationResponse
      : { error: 'We could not process your payment. Please contact us for assistance.' }
  }
}
