import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PAYPAL_DEFAULT_CURRENCY, getPayPalOrder, capturePayPalPayment, isPayPalOrderNotFoundError, PayPalApiError } from '@/lib/paypal'
import { logger } from '@/lib/logger'
import { finalizeDepositPayment } from '@/services/private-bookings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_PAYPAL_RECONCILIATION_ATTEMPTS = 5

type PendingPayPalBooking = {
  id: string
  paypal_deposit_order_id: string | null
  deposit_amount: number | null
  status: string | null
  paypal_reconciliation_attempts?: number | null
  paypal_reconciliation_last_error?: string | null
}

function getOrderAmountCurrency(order: any): string | null {
  const raw = order?.purchase_units?.[0]?.amount?.currency_code
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null
}

function getCaptureAmountCurrency(order: any): string | null {
  const raw = order?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.currency_code
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null
}

function summarizePayPalLookupError(error: unknown): string {
  if (error instanceof PayPalApiError) {
    return JSON.stringify({
      name: error.name,
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      details: error.details,
    })
  }

  if (error instanceof Error) {
    return JSON.stringify({
      name: error.name,
      message: error.message,
    })
  }

  return String(error)
}

async function resetPayPalReconciliationFailures(
  admin: ReturnType<typeof createAdminClient>,
  params: { bookingId: string; orderId: string }
): Promise<void> {
  const { error } = await admin
    .from('private_bookings')
    .update({
      paypal_reconciliation_attempts: 0,
      paypal_reconciliation_last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.bookingId)
    .eq('paypal_deposit_order_id', params.orderId)
    .is('deposit_paid_date', null)

  if (error) {
    logger.warn('PayPal reconciliation: failed to reset lookup failure counter', {
      metadata: { ...params, error: error.message },
    })
  }
}

async function recordPayPalReconciliationFailure(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    bookingId: string
    orderId: string
    currentAttempts: number | null | undefined
    error: unknown
  }
): Promise<number> {
  const attempts = (params.currentAttempts ?? 0) + 1
  const lastError = summarizePayPalLookupError(params.error).slice(0, 2000)

  const { error } = await admin
    .from('private_bookings')
    .update({
      paypal_reconciliation_attempts: attempts,
      paypal_reconciliation_last_error: lastError,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.bookingId)
    .eq('paypal_deposit_order_id', params.orderId)
    .is('deposit_paid_date', null)

  if (error) {
    logger.error('PayPal reconciliation: failed to record lookup failure', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        bookingId: params.bookingId,
        orderId: params.orderId,
        attempts,
      },
    })
  }

  return attempts
}

async function writePayPalReconciliationAudit(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    operationType: string
    bookingId: string
    additionalInfo: Record<string, unknown>
  }
): Promise<boolean> {
  const { error } = await admin.from('audit_logs').insert({
    operation_type: params.operationType,
    resource_type: 'private_booking',
    resource_id: params.bookingId,
    operation_status: 'success',
    additional_info: {
      ...params.additionalInfo,
      source: 'reconciliation_cron'
    }
  })

  if (error) {
    logger.warn('PayPal reconciliation: failed to write audit log', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        operationType: params.operationType,
        bookingId: params.bookingId
      }
    })
    return false
  }

  return true
}

async function clearStalePayPalOrder(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    bookingId: string
    orderId: string
    reason: string
    auditAction?: string
    orderStatus?: string
  }
): Promise<boolean> {
  const { data, error } = await admin
    .from('private_bookings')
    .update({
      paypal_deposit_order_id: null,
      paypal_reconciliation_attempts: 0,
      paypal_reconciliation_last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.bookingId)
    .eq('paypal_deposit_order_id', params.orderId)
    .is('deposit_paid_date', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.error('PayPal reconciliation: failed to clear stale order id', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: params
    })
    return false
  }

  if (!data) {
    logger.warn('PayPal reconciliation: stale order id clear skipped because booking changed', {
      metadata: params
    })
    return false
  }

  await writePayPalReconciliationAudit(admin, {
    operationType: params.auditAction ?? 'paypal_deposit_order_cleared',
    bookingId: params.bookingId,
    additionalInfo: {
      order_id: params.orderId,
      order_status: params.orderStatus ?? null,
      reason: params.reason,
    }
  })

  return true
}

export async function GET(request: NextRequest) {
  logger.info('PayPal deposit reconciliation cron starting', {
    metadata: { startedAt: new Date().toISOString() }
  })

  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    logger.warn('Unauthorized PayPal reconciliation attempt', {
      metadata: { reason: authResult.reason || null }
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Find all bookings with a PayPal order but no deposit recorded
  const { data: pendingBookings, error: queryError } = await admin
    .from('private_bookings')
    .select('id, paypal_deposit_order_id, deposit_amount, status, paypal_reconciliation_attempts, paypal_reconciliation_last_error')
    .not('paypal_deposit_order_id', 'is', null)
    .is('deposit_paid_date', null)
    .in('status', ['draft', 'confirmed'])
    .limit(20) // Process in batches to stay within function timeout

  if (queryError) {
    logger.error('PayPal reconciliation: failed to query pending bookings', {
      error: queryError instanceof Error ? queryError : new Error(String(queryError)),
      metadata: { queryError }
    })
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  if (!pendingBookings || pendingBookings.length === 0) {
    return NextResponse.json({ reconciled: 0, message: 'No pending PayPal deposits' })
  }

  const results: Array<{ bookingId: string; outcome: string }> = []

  for (const booking of pendingBookings as PendingPayPalBooking[]) {
    const bookingId = booking.id
    const orderId = booking.paypal_deposit_order_id

    if (!orderId) {
      results.push({ bookingId, outcome: 'missing_order_id' })
      continue
    }

    let order: Awaited<ReturnType<typeof getPayPalOrder>>
    try {
      order = await getPayPalOrder(orderId)
      if ((booking.paypal_reconciliation_attempts ?? 0) > 0 || booking.paypal_reconciliation_last_error) {
        await resetPayPalReconciliationFailures(admin, { bookingId, orderId })
      }
    } catch (error) {
      if (isPayPalOrderNotFoundError(error)) {
        const cleared = await clearStalePayPalOrder(admin, {
          bookingId,
          orderId,
          reason: 'paypal_order_not_found'
        })
        results.push({ bookingId, outcome: cleared ? 'cleared_missing_order' : 'missing_order_clear_failed' })
        continue
      }

      const attempts = await recordPayPalReconciliationFailure(admin, {
        bookingId,
        orderId,
        currentAttempts: booking.paypal_reconciliation_attempts,
        error,
      })

      logger.error('PayPal reconciliation: failed to check order', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          bookingId,
          orderId,
          attempts,
          maxAttempts: MAX_PAYPAL_RECONCILIATION_ATTEMPTS,
          paypalStatus: error instanceof PayPalApiError ? error.status : null,
          paypalDetails: error instanceof PayPalApiError ? error.details : null,
          errorMessage: error instanceof Error ? error.message : String(error),
        }
      })

      if (attempts >= MAX_PAYPAL_RECONCILIATION_ATTEMPTS) {
        const cleared = await clearStalePayPalOrder(admin, {
          bookingId,
          orderId,
          reason: 'paypal_order_exhausted_retries'
        })
        results.push({ bookingId, outcome: cleared ? 'cleared_exhausted_retries' : 'exhausted_retry_clear_failed' })
        continue
      }

      results.push({ bookingId, outcome: 'lookup_failed' })
      continue
    }

    try {
      const orderStatus: string = order.status

      if (orderStatus === 'COMPLETED') {
        // Already captured — record the deposit
        const captureId = order.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null
        const capturedAmount = Number(order.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? 0)
        const capturedCurrency = getCaptureAmountCurrency(order)
        const expectedAmount = Number(booking.deposit_amount ?? 0)
        if (
          (expectedAmount > 0 && Math.abs(capturedAmount - expectedAmount) > 0.01) ||
          capturedCurrency !== PAYPAL_DEFAULT_CURRENCY
        ) {
          logger.error('PayPal reconciliation: amount mismatch on completed order', {
            metadata: { bookingId, orderId, capturedAmount, capturedCurrency, expectedAmount, expectedCurrency: PAYPAL_DEFAULT_CURRENCY }
          })
          results.push({ bookingId, outcome: 'amount_mismatch' })
          continue
        }

        const finalizeResult = await finalizeDepositPayment({
          bookingId,
          amount: capturedAmount,
          method: 'paypal',
          paypalCaptureId: captureId,
        }, admin)

        if (!finalizeResult.alreadyRecorded) {
          await writePayPalReconciliationAudit(admin, {
            operationType: 'paypal_deposit_reconciled',
            bookingId,
            additionalInfo: { capture_id: captureId, order_id: orderId, amount: capturedAmount }
          })
          results.push({ bookingId, outcome: 'recorded_completed' })
        } else {
          results.push({ bookingId, outcome: 'already_recorded' })
        }

      } else if (orderStatus === 'APPROVED') {
        // Customer approved but capture never happened — capture now
        try {
          const orderCurrency = getOrderAmountCurrency(order)
          if (orderCurrency !== PAYPAL_DEFAULT_CURRENCY) {
            logger.error('PayPal reconciliation: currency mismatch before capture', {
              metadata: { bookingId, orderId, orderCurrency, expectedCurrency: PAYPAL_DEFAULT_CURRENCY }
            })
            results.push({ bookingId, outcome: 'amount_mismatch' })
            continue
          }

          const captureResult = await capturePayPalPayment(orderId, PAYPAL_DEFAULT_CURRENCY)

          const capturedAmount = parseFloat(captureResult.amount)
          const expectedAmount = Number(booking.deposit_amount ?? 0)
          if (expectedAmount > 0 && Math.abs(capturedAmount - expectedAmount) > 0.01) {
            logger.error('PayPal reconciliation: amount mismatch during capture', {
              metadata: { bookingId, orderId, capturedAmount, expectedAmount }
            })
            results.push({ bookingId, outcome: 'amount_mismatch' })
            continue
          }

          const finalizeResult = await finalizeDepositPayment({
            bookingId,
            amount: capturedAmount,
            method: 'paypal',
            paypalCaptureId: captureResult.transactionId,
          }, admin)

          if (!finalizeResult.alreadyRecorded) {
            await writePayPalReconciliationAudit(admin, {
              operationType: 'paypal_deposit_reconciled',
              bookingId,
              additionalInfo: {
                capture_id: captureResult.transactionId,
                order_id: orderId,
                amount: captureResult.amount,
                source_detail: 'reconciliation_cron_captured'
              }
            })
            results.push({ bookingId, outcome: 'captured_and_recorded' })
          } else {
            results.push({ bookingId, outcome: 'already_recorded' })
          }
        } catch (captureError) {
          logger.error('PayPal reconciliation: capture failed for approved order', {
            error: captureError instanceof Error ? captureError : new Error(String(captureError)),
            metadata: { bookingId, orderId }
          })
          results.push({ bookingId, outcome: 'capture_failed' })
        }

      } else if (orderStatus === 'VOIDED' || orderStatus === 'EXPIRED' || orderStatus === 'SAVED') {
        // Order expired or voided — clear the order ID so staff can resend
        const cleared = await clearStalePayPalOrder(admin, {
          bookingId,
          orderId,
          orderStatus,
          reason: `paypal_order_${orderStatus.toLowerCase()}`,
          auditAction: 'paypal_deposit_order_expired'
        })

        results.push({ bookingId, outcome: cleared ? `cleared_${orderStatus.toLowerCase()}` : `clear_${orderStatus.toLowerCase()}_failed` })

      } else {
        // CREATED, PAYER_ACTION_REQUIRED, etc. — customer hasn't completed approval yet
        results.push({ bookingId, outcome: `pending_${orderStatus.toLowerCase()}` })
      }
    } catch (error) {
      logger.error('PayPal reconciliation: failed to process order', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId, orderId }
      })
      results.push({ bookingId, outcome: 'error' })
    }
  }

  logger.info('PayPal deposit reconciliation completed', { metadata: { results } })
  return NextResponse.json({ reconciled: results.length, results })
}
