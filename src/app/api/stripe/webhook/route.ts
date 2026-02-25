import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import {
  createStripeRefund,
  retrieveStripeSetupIntent,
  verifyStripeWebhookSignature
} from '@/lib/payments/stripe'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  sendEventBookingSeatUpdateSms,
  sendEventPaymentConfirmationSms,
  sendEventPaymentRetrySms
} from '@/lib/events/event-payments'
import {
  sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed,
  sendTableBookingConfirmedAfterDepositSmsIfAllowed,
} from '@/lib/table-bookings/bookings'

export const runtime = 'nodejs'

type StripeWebhookEvent = {
  id: string
  type: string
  data?: {
    object?: any
  }
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeStripeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const allowedKeys = [
    'content-type',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-request-id',
    'x-vercel-id'
  ]
  const sanitized: Record<string, string> = {}

  for (const key of allowedKeys) {
    if (headers[key]) {
      sanitized[key] = headers[key]
    }
  }

  sanitized['stripe-signature-present'] = headers['stripe-signature'] ? 'true' : 'false'
  return sanitized
}

async function logStripeWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    status: string
    headers: Record<string, string>
    body: string
    eventId?: string
    eventType?: string
    errorMessage?: string
  }
): Promise<void> {
  try {
    await (supabase.from('webhook_logs') as any).insert({
      webhook_type: 'stripe',
      status: input.status,
      headers: sanitizeStripeHeadersForLog(input.headers),
      body: truncate(input.body, 10000),
      params: {
        event_id: input.eventId ?? null,
        event_type: input.eventType ?? null
      },
      error_message: truncate(input.errorMessage, 500)
    })
  } catch (error) {
    logger.warn('Failed to store Stripe webhook log', {
      metadata: {
        status: input.status,
        eventId: input.eventId,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }
}

type CheckoutCompletedResult = {
  state: 'confirmed' | 'already_confirmed' | 'blocked'
  booking_id?: string
  customer_id?: string
  event_id?: string
  event_name?: string
  seats?: number
}

type SeatIncreaseCompletedResult = {
  state: 'updated' | 'blocked'
  reason?: string
  booking_id?: string
  customer_id?: string
  event_id?: string
  event_name?: string
  old_seats?: number
  new_seats?: number
  delta?: number
}

type TableCardCaptureCompletedResult = {
  state: 'confirmed' | 'already_confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  customer_id?: string
  booking_reference?: string
  status?: string
}

type TableDepositCompletedResult = {
  state: 'confirmed' | 'already_confirmed' | 'blocked'
  reason?: string
  table_booking_id?: string
  customer_id?: string
  booking_reference?: string
  party_size?: number
}

function mapRefundStatus(status: string | null): 'refunded' | 'pending' | 'failed' {
  switch (status) {
    case 'succeeded':
      return 'refunded'
    case 'pending':
    case 'requires_action':
      return 'pending'
    default:
      return 'failed'
  }
}

function getSessionMetadata(stripeSession: any): Record<string, string> {
  if (typeof stripeSession?.metadata === 'object' && stripeSession.metadata !== null) {
    return stripeSession.metadata as Record<string, string>
  }
  return {}
}

type EventPaymentRetrySmsResult = {
  success?: boolean
  code?: string | null
  logFailure?: boolean
  error?: string | null
} | null | undefined

function logEventPaymentRetrySmsOutcome(input: {
  bookingId: string
  checkoutSessionId: string
  context: 'blocked_checkout' | 'checkout_failure'
}, smsResult: EventPaymentRetrySmsResult): void {
  if (!smsResult || smsResult.success === true) {
    return
  }

  const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
  const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
  const smsError = typeof smsResult.error === 'string' ? smsResult.error : null

  if (smsLogFailure) {
    logger.error('Stripe webhook event payment retry SMS reported logging failure', {
      metadata: {
        bookingId: input.bookingId,
        checkoutSessionId: input.checkoutSessionId,
        context: input.context,
        code: smsCode,
        logFailure: smsLogFailure,
        error: smsError
      }
    })
    return
  }

  logger.warn('Stripe webhook event payment retry SMS send returned non-success', {
    metadata: {
      bookingId: input.bookingId,
      checkoutSessionId: input.checkoutSessionId,
      context: input.context,
      code: smsCode,
      logFailure: smsLogFailure,
      error: smsError
    }
  })
}

async function recordAnalyticsEventSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: string
) {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record Stripe webhook analytics event', {
      metadata: {
        context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

async function handleSeatIncreaseCheckoutCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  stripeSession: any,
  appBaseUrl: string
): Promise<void> {
  const checkoutSessionId = typeof stripeSession?.id === 'string' ? stripeSession.id : null
  if (!checkoutSessionId) {
    return
  }

  const metadata = getSessionMetadata(stripeSession)
  const bookingId = typeof metadata.event_booking_id === 'string'
    ? metadata.event_booking_id
    : typeof stripeSession?.client_reference_id === 'string'
      ? stripeSession.client_reference_id
      : null
  const targetSeats = Number.parseInt(metadata.target_seats || '', 10)
  const paymentIntentId = typeof stripeSession?.payment_intent === 'string'
    ? stripeSession.payment_intent
    : ''
  const amount = typeof stripeSession?.amount_total === 'number'
    ? Number((stripeSession.amount_total / 100).toFixed(2))
    : 0
  const currency = typeof stripeSession?.currency === 'string'
    ? stripeSession.currency.toUpperCase()
    : 'GBP'

  if (!bookingId || !Number.isFinite(targetSeats) || targetSeats < 1) {
    return
  }

  const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('apply_event_seat_increase_payment_v05', {
    p_event_booking_id: bookingId,
    p_target_seats: targetSeats,
    p_checkout_session_id: checkoutSessionId,
    p_payment_intent_id: paymentIntentId,
    p_amount: amount,
    p_currency: currency
  })

  if (rpcError) {
    throw rpcError
  }

  const rpcResult = (rpcResultRaw ?? {}) as SeatIncreaseCompletedResult

  if (rpcResult.state === 'updated' && rpcResult.booking_id && rpcResult.customer_id) {
    const [analyticsOutcome, smsOutcome] = await Promise.allSettled([
      recordAnalyticsEventSafe(supabase, {
        customerId: rpcResult.customer_id,
        eventBookingId: rpcResult.booking_id,
        eventType: 'payment_succeeded',
        metadata: {
          payment_kind: 'seat_increase',
          stripe_checkout_session_id: checkoutSessionId,
          stripe_payment_intent_id: paymentIntentId || null,
          amount,
          currency,
          old_seats: rpcResult.old_seats ?? null,
          new_seats: rpcResult.new_seats ?? null,
          delta: rpcResult.delta ?? null
        }
      }, 'seat_increase_payment_succeeded'),
      sendEventBookingSeatUpdateSms(supabase, {
        bookingId: rpcResult.booking_id,
        eventName: rpcResult.event_name || null,
        oldSeats: Math.max(1, Number(rpcResult.old_seats ?? 1)),
        newSeats: Math.max(1, Number(rpcResult.new_seats ?? 1)),
        appBaseUrl
      })
    ])

    if (analyticsOutcome.status === 'rejected') {
      const reason = analyticsOutcome.reason instanceof Error ? analyticsOutcome.reason.message : String(analyticsOutcome.reason)
      logger.warn('Seat increase analytics task rejected unexpectedly', {
        metadata: {
          bookingId: rpcResult.booking_id,
          checkoutSessionId,
          error: reason,
        },
      })
    }

    if (smsOutcome.status === 'rejected') {
      const reason = smsOutcome.reason instanceof Error ? smsOutcome.reason.message : String(smsOutcome.reason)
      logger.error('Seat increase seat-update SMS task rejected unexpectedly', {
        error: smsOutcome.reason instanceof Error ? smsOutcome.reason : new Error(String(smsOutcome.reason)),
        metadata: {
          bookingId: rpcResult.booking_id,
          checkoutSessionId,
          error: reason,
        },
      })
    } else {
      const smsResult = smsOutcome.value as {
        success?: boolean
        code?: string | null
        logFailure?: boolean
        error?: string | null
      } | null
      const smsCode = typeof smsResult?.code === 'string' ? smsResult.code : null
      const smsLogFailure = smsResult?.logFailure === true || smsCode === 'logging_failed'
      if (smsResult && smsResult.success !== true) {
        if (smsLogFailure) {
          logger.error('Seat increase seat-update SMS reported logging failure', {
            metadata: {
              bookingId: rpcResult.booking_id,
              checkoutSessionId,
              code: smsCode,
              logFailure: smsLogFailure,
              error: typeof smsResult.error === 'string' ? smsResult.error : null
            }
          })
        } else {
          logger.warn('Seat increase seat-update SMS send returned non-success', {
            metadata: {
              bookingId: rpcResult.booking_id,
              checkoutSessionId,
              code: smsCode,
              logFailure: smsLogFailure,
              error: typeof smsResult.error === 'string' ? smsResult.error : null
            }
          })
        }
      }
    }
    return
  }

  if (rpcResult.state === 'blocked') {
    const { data: markedPayments, error: markPaymentFailedError } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        metadata: {
          payment_kind: 'seat_increase',
          apply_reason: rpcResult.reason || 'blocked'
        }
      })
      .eq('stripe_checkout_session_id', checkoutSessionId)
      .eq('status', 'pending')
      .select('id, status')

    if (markPaymentFailedError) {
      throw markPaymentFailedError
    }

    if (!Array.isArray(markedPayments) || markedPayments.length === 0) {
      const { data: existingPayment, error: existingPaymentLookupError } = await supabase
        .from('payments')
        .select('id, status')
        .eq('stripe_checkout_session_id', checkoutSessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingPaymentLookupError) {
        throw existingPaymentLookupError
      }

      if (!existingPayment) {
        throw new Error(`Seat increase blocked checkout missing payment row: ${checkoutSessionId}`)
      }

      const existingStatus =
        typeof (existingPayment as any)?.status === 'string'
          ? ((existingPayment as any).status as string)
          : null

      if (existingStatus !== 'failed' && existingStatus !== 'refunded') {
        throw new Error(
          `Seat increase blocked checkout payment row was not transitioned to failed: ${checkoutSessionId}`
        )
      }
    }

    if (paymentIntentId && amount > 0) {
      try {
        const refund = await createStripeRefund({
          paymentIntentId,
          amountMinor: Math.round(amount * 100),
          reason: 'requested_by_customer',
          idempotencyKey: `seat_increase_refund_${checkoutSessionId}`
        })

        const refundStatus = mapRefundStatus(refund.status)
        const paymentStatus = refundStatus === 'refunded' ? 'refunded' : refundStatus === 'pending' ? 'pending' : 'failed'

        const { error: refundPaymentInsertError } = await supabase.from('payments').insert({
          event_booking_id: bookingId,
          charge_type: 'refund',
          stripe_payment_intent_id: paymentIntentId,
          amount,
          currency,
          status: paymentStatus,
          metadata: {
            payment_kind: 'seat_increase',
            stripe_refund_id: refund.id,
            stripe_refund_status: refund.status,
            seat_increase_block_reason: rpcResult.reason || null,
            checkout_session_id: checkoutSessionId
          }
        })

        if (refundPaymentInsertError) {
          throw refundPaymentInsertError
        }
      } catch (refundError) {
        logger.error('Failed to auto-refund blocked seat increase payment', {
          error: refundError instanceof Error ? refundError : new Error(String(refundError)),
          metadata: { bookingId, checkoutSessionId }
        })
        throw refundError
      }
    }

    if (rpcResult.customer_id && rpcResult.booking_id) {
      try {
        await recordAnalyticsEvent(supabase, {
          customerId: rpcResult.customer_id,
          eventBookingId: rpcResult.booking_id,
          eventType: 'payment_failed',
          metadata: {
            payment_kind: 'seat_increase',
            reason: rpcResult.reason || 'blocked',
            stripe_checkout_session_id: checkoutSessionId
          }
        })
      } catch (analyticsError) {
        logger.warn('Failed recording seat increase blocked payment analytics event', {
          metadata: {
            bookingId: rpcResult.booking_id,
            customerId: rpcResult.customer_id,
            checkoutSessionId,
            error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
          }
        })
      }
    }
  }
}

async function handleCheckoutSessionCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  stripeSession: any,
  appBaseUrl: string
): Promise<void> {
  const checkoutSessionId = typeof stripeSession?.id === 'string' ? stripeSession.id : null
  if (!checkoutSessionId) {
    return
  }

  const metadata = getSessionMetadata(stripeSession)
  const paymentKind = metadata.payment_kind || 'prepaid_event'

  if (paymentKind === 'table_card_capture') {
    const tableBookingId = typeof metadata.table_booking_id === 'string'
      ? metadata.table_booking_id
      : typeof stripeSession?.client_reference_id === 'string'
        ? stripeSession.client_reference_id
        : null

    if (!tableBookingId) {
      return
    }

    const setupIntentId = typeof stripeSession?.setup_intent === 'string'
      ? stripeSession.setup_intent
      : ''

    let paymentMethodId = ''
    let stripeCustomerId = ''
    if (setupIntentId) {
      try {
        const setupIntent = await retrieveStripeSetupIntent(setupIntentId)
        paymentMethodId = setupIntent.payment_method || ''
        stripeCustomerId = setupIntent.customer || ''
      } catch (error) {
        logger.warn('Failed to fetch setup intent details for table card capture', {
          metadata: {
            tableBookingId,
            setupIntentId,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }

    const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('complete_table_card_capture_v05', {
      p_table_booking_id: tableBookingId,
      p_setup_intent_id: setupIntentId || null,
      p_payment_method_id: paymentMethodId || null
    })

    if (rpcError) {
      throw rpcError
    }

    const rpcResult = (rpcResultRaw ?? {}) as TableCardCaptureCompletedResult

    if (rpcResult.state === 'confirmed' && rpcResult.table_booking_id && rpcResult.customer_id) {
      const [customerUpdateOutcome, analyticsOutcome, smsOutcome] = await Promise.allSettled([
        stripeCustomerId
          ? supabase
              .from('customers')
              .update({
                stripe_customer_id: stripeCustomerId,
                updated_at: new Date().toISOString()
              })
              .eq('id', rpcResult.customer_id)
              .is('stripe_customer_id', null)
              .select('id')
          : Promise.resolve(),
        recordAnalyticsEventSafe(supabase, {
          customerId: rpcResult.customer_id,
          tableBookingId: rpcResult.table_booking_id,
          eventType: 'card_capture_completed',
          metadata: {
            stripe_checkout_session_id: checkoutSessionId,
            stripe_setup_intent_id: setupIntentId || null,
            stripe_customer_id: stripeCustomerId || null,
            stripe_payment_method_id: paymentMethodId || null,
            booking_reference: rpcResult.booking_reference || null
          }
        }, 'table_card_capture_completed'),
        sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed(supabase, rpcResult.table_booking_id)
      ])

      if (customerUpdateOutcome.status === 'rejected') {
        const reason = customerUpdateOutcome.reason instanceof Error
          ? customerUpdateOutcome.reason.message
          : String(customerUpdateOutcome.reason)
        logger.error('Table card capture customer update task rejected unexpectedly', {
          error: customerUpdateOutcome.reason instanceof Error
            ? customerUpdateOutcome.reason
            : new Error(String(customerUpdateOutcome.reason)),
          metadata: {
            customerId: rpcResult.customer_id,
            tableBookingId: rpcResult.table_booking_id,
            checkoutSessionId,
            setupIntentId: setupIntentId || null,
            error: reason
          }
        })
      } else if (stripeCustomerId) {
        const result = customerUpdateOutcome.value as {
          data?: Array<{ id?: string | null }> | null
          error?: unknown
        } | undefined
        const updateError = result?.error
        if (updateError) {
          const reason = updateError instanceof Error
            ? updateError.message
            : typeof updateError === 'object' && updateError && 'message' in updateError
              ? String((updateError as any).message)
              : String(updateError)
          logger.error('Table card capture failed to update customer with stripe_customer_id', {
            error: updateError instanceof Error ? updateError : new Error(reason),
            metadata: {
              customerId: rpcResult.customer_id,
              tableBookingId: rpcResult.table_booking_id,
              checkoutSessionId,
              setupIntentId: setupIntentId || null,
              error: reason
            }
          })
        } else if (!Array.isArray(result?.data)) {
          logger.error('Table card capture customer stripe_customer_id sync returned unavailable mutation rows', {
            error: new Error('mutation_result_unavailable'),
            metadata: {
              customerId: rpcResult.customer_id,
              tableBookingId: rpcResult.table_booking_id,
              checkoutSessionId,
              setupIntentId: setupIntentId || null,
              stripeCustomerId,
              error: 'mutation_result_unavailable'
            }
          })
        } else if (result.data.length === 0) {
          const {
            data: existingCustomer,
            error: existingCustomerLookupError
          } = await supabase
            .from('customers')
            .select('id, stripe_customer_id')
            .eq('id', rpcResult.customer_id)
            .maybeSingle()

          if (existingCustomerLookupError) {
            logger.error('Table card capture failed verifying zero-row customer stripe_customer_id update', {
              error: new Error(existingCustomerLookupError.message),
              metadata: {
                customerId: rpcResult.customer_id,
                tableBookingId: rpcResult.table_booking_id,
                checkoutSessionId,
                setupIntentId: setupIntentId || null,
                stripeCustomerId,
                error: existingCustomerLookupError.message
              }
            })
          } else if (!existingCustomer) {
            logger.error('Table card capture customer missing after zero-row stripe_customer_id update', {
              error: new Error('customer_missing'),
              metadata: {
                customerId: rpcResult.customer_id,
                tableBookingId: rpcResult.table_booking_id,
                checkoutSessionId,
                setupIntentId: setupIntentId || null,
                stripeCustomerId,
                error: 'customer_missing'
              }
            })
          } else {
            const existingStripeCustomerId =
              typeof (existingCustomer as any)?.stripe_customer_id === 'string'
                ? ((existingCustomer as any).stripe_customer_id as string)
                : null

            if (!existingStripeCustomerId) {
              logger.error('Table card capture zero-row stripe_customer_id update left customer unset', {
                error: new Error('stripe_customer_id_unset'),
                metadata: {
                  customerId: rpcResult.customer_id,
                  tableBookingId: rpcResult.table_booking_id,
                  checkoutSessionId,
                  setupIntentId: setupIntentId || null,
                  stripeCustomerId,
                  error: 'stripe_customer_id_unset'
                }
              })
            } else if (existingStripeCustomerId !== stripeCustomerId) {
              logger.warn('Table card capture customer already mapped to different stripe_customer_id', {
                metadata: {
                  customerId: rpcResult.customer_id,
                  tableBookingId: rpcResult.table_booking_id,
                  checkoutSessionId,
                  setupIntentId: setupIntentId || null,
                  stripeCustomerId,
                  existingStripeCustomerId
                }
              })
            }
          }
        }
      }

      if (analyticsOutcome.status === 'rejected') {
        const reason = analyticsOutcome.reason instanceof Error ? analyticsOutcome.reason.message : String(analyticsOutcome.reason)
        logger.warn('Table card capture analytics task rejected unexpectedly', {
          metadata: {
            customerId: rpcResult.customer_id,
            tableBookingId: rpcResult.table_booking_id,
            checkoutSessionId,
            setupIntentId: setupIntentId || null,
            error: reason
          }
        })
      }

      if (smsOutcome.status === 'rejected') {
        const reason = smsOutcome.reason instanceof Error ? smsOutcome.reason.message : String(smsOutcome.reason)
        logger.error('Table card capture confirmation SMS task rejected unexpectedly', {
          error: smsOutcome.reason instanceof Error ? smsOutcome.reason : new Error(String(smsOutcome.reason)),
          metadata: {
            tableBookingId: rpcResult.table_booking_id,
            checkoutSessionId,
            setupIntentId: setupIntentId || null,
            error: reason
          }
        })
      } else {
        const smsResult = smsOutcome.value as {
          success?: boolean
          code?: string | null
          logFailure?: boolean
          error?: string | null
        } | null
        const smsCode = typeof smsResult?.code === 'string' ? smsResult.code : null
        const smsLogFailure = smsResult?.logFailure === true || smsCode === 'logging_failed'
        if (smsResult && smsResult.success !== true) {
          if (smsLogFailure) {
            logger.error('Table card capture confirmation SMS reported logging failure', {
              metadata: {
                tableBookingId: rpcResult.table_booking_id,
                checkoutSessionId,
                setupIntentId: setupIntentId || null,
                code: smsCode,
                logFailure: smsLogFailure,
                error: typeof smsResult.error === 'string' ? smsResult.error : null
              }
            })
          } else {
            logger.warn('Table card capture confirmation SMS send returned non-success', {
              metadata: {
                tableBookingId: rpcResult.table_booking_id,
                checkoutSessionId,
                setupIntentId: setupIntentId || null,
                code: smsCode,
                logFailure: smsLogFailure,
                error: typeof smsResult.error === 'string' ? smsResult.error : null
              }
            })
          }
        }
      }
      return
    }

    if (rpcResult.state === 'blocked' && rpcResult.table_booking_id) {
      const { data: booking } = await supabase
        .from('table_bookings')
        .select('customer_id')
        .eq('id', rpcResult.table_booking_id)
        .maybeSingle()

      if (booking?.customer_id) {
        await recordAnalyticsEventSafe(supabase, {
          customerId: booking.customer_id,
          tableBookingId: rpcResult.table_booking_id,
          eventType: 'card_capture_expired',
          metadata: {
            reason: rpcResult.reason || 'blocked',
            stripe_checkout_session_id: checkoutSessionId
          }
        }, 'table_card_capture_blocked')
      }
    }

    return
  }

  if (paymentKind === 'table_deposit') {
    const tableBookingId = typeof metadata.table_booking_id === 'string'
      ? metadata.table_booking_id
      : typeof stripeSession?.client_reference_id === 'string'
        ? stripeSession.client_reference_id
        : null

    if (!tableBookingId) {
      return
    }

    const paymentIntentId = typeof stripeSession?.payment_intent === 'string'
      ? stripeSession.payment_intent
      : ''
    const amount = typeof stripeSession?.amount_total === 'number'
      ? Number((stripeSession.amount_total / 100).toFixed(2))
      : null
    const currency = typeof stripeSession?.currency === 'string'
      ? stripeSession.currency.toUpperCase()
      : 'GBP'

    const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('confirm_table_payment_v05', {
      p_table_booking_id: tableBookingId,
      p_checkout_session_id: checkoutSessionId,
      p_payment_intent_id: paymentIntentId || null,
      p_amount: amount,
      p_currency: currency,
    })

    if (rpcError) {
      throw rpcError
    }

    const rpcResult = (rpcResultRaw ?? {}) as TableDepositCompletedResult

    if (rpcResult.state === 'confirmed' && rpcResult.table_booking_id && rpcResult.customer_id) {
      const [analyticsOutcome, smsOutcome] = await Promise.allSettled([
        recordAnalyticsEventSafe(supabase, {
          customerId: rpcResult.customer_id,
          tableBookingId: rpcResult.table_booking_id,
          eventType: 'payment_succeeded',
          metadata: {
            payment_kind: 'table_deposit',
            stripe_checkout_session_id: checkoutSessionId,
            stripe_payment_intent_id: paymentIntentId || null,
            amount,
            currency,
            booking_reference: rpcResult.booking_reference || null,
            party_size: rpcResult.party_size ?? null,
          }
        }, 'table_deposit_payment_succeeded'),
        sendTableBookingConfirmedAfterDepositSmsIfAllowed(supabase, rpcResult.table_booking_id),
      ])

      if (analyticsOutcome.status === 'rejected') {
        const reason = analyticsOutcome.reason instanceof Error
          ? analyticsOutcome.reason.message
          : String(analyticsOutcome.reason)
        logger.warn('Table deposit payment analytics task rejected unexpectedly', {
          metadata: {
            tableBookingId: rpcResult.table_booking_id,
            customerId: rpcResult.customer_id,
            checkoutSessionId,
            error: reason,
          }
        })
      }

      if (smsOutcome.status === 'rejected') {
        const reason = smsOutcome.reason instanceof Error ? smsOutcome.reason.message : String(smsOutcome.reason)
        logger.error('Table deposit confirmation SMS task rejected unexpectedly', {
          error: smsOutcome.reason instanceof Error ? smsOutcome.reason : new Error(String(smsOutcome.reason)),
          metadata: {
            tableBookingId: rpcResult.table_booking_id,
            checkoutSessionId,
            error: reason,
          }
        })
      } else {
        const smsResult = smsOutcome.value as {
          success?: boolean
          code?: string | null
          logFailure?: boolean
          error?: string | null
        } | null
        const smsCode = typeof smsResult?.code === 'string' ? smsResult.code : null
        const smsLogFailure = smsResult?.logFailure === true || smsCode === 'logging_failed'
        if (smsResult && smsResult.success !== true) {
          if (smsLogFailure) {
            logger.error('Table deposit confirmation SMS reported logging failure', {
              metadata: {
                tableBookingId: rpcResult.table_booking_id,
                checkoutSessionId,
                code: smsCode,
                logFailure: smsLogFailure,
                error: typeof smsResult.error === 'string' ? smsResult.error : null,
              }
            })
          } else {
            logger.warn('Table deposit confirmation SMS send returned non-success', {
              metadata: {
                tableBookingId: rpcResult.table_booking_id,
                checkoutSessionId,
                code: smsCode,
                logFailure: smsLogFailure,
                error: typeof smsResult.error === 'string' ? smsResult.error : null,
              }
            })
          }
        }
      }
      return
    }

    if (rpcResult.state === 'blocked') {
      const candidateCustomerId =
        typeof rpcResult.customer_id === 'string' && rpcResult.customer_id.length > 0
          ? rpcResult.customer_id
          : null
      const customerId = candidateCustomerId || (
        await (async () => {
          const { data: booking } = await (supabase.from('table_bookings') as any)
            .select('customer_id')
            .eq('id', tableBookingId)
            .maybeSingle()
          return typeof booking?.customer_id === 'string' ? booking.customer_id : null
        })()
      )

      if (customerId) {
        await recordAnalyticsEventSafe(supabase, {
          customerId,
          tableBookingId,
          eventType: 'payment_failed',
          metadata: {
            payment_kind: 'table_deposit',
            stripe_checkout_session_id: checkoutSessionId,
            reason: rpcResult.reason || 'blocked',
          }
        }, 'table_deposit_payment_blocked')
      }
    }

    return
  }

  if (paymentKind === 'seat_increase') {
    await handleSeatIncreaseCheckoutCompleted(supabase, stripeSession, appBaseUrl)
    return
  }

  const bookingId = typeof metadata.event_booking_id === 'string'
    ? metadata.event_booking_id
    : typeof stripeSession?.client_reference_id === 'string'
      ? stripeSession.client_reference_id
      : null

  if (!bookingId) {
    return
  }

  const paymentIntentId = typeof stripeSession?.payment_intent === 'string'
    ? stripeSession.payment_intent
    : ''
  const amount = typeof stripeSession?.amount_total === 'number'
    ? Number((stripeSession.amount_total / 100).toFixed(2))
    : null
  const currency = typeof stripeSession?.currency === 'string'
    ? stripeSession.currency.toUpperCase()
    : 'GBP'

  const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('confirm_event_payment_v05', {
    p_event_booking_id: bookingId,
    p_checkout_session_id: checkoutSessionId,
    p_payment_intent_id: paymentIntentId,
    p_amount: amount,
    p_currency: currency
  })

  if (rpcError) {
    throw rpcError
  }

  const rpcResult = (rpcResultRaw ?? {}) as CheckoutCompletedResult

  if (rpcResult.state === 'confirmed' && rpcResult.booking_id && rpcResult.customer_id) {
    const [analyticsOutcome, smsOutcome] = await Promise.allSettled([
      recordAnalyticsEventSafe(supabase, {
        customerId: rpcResult.customer_id,
        eventBookingId: rpcResult.booking_id,
        eventType: 'payment_succeeded',
        metadata: {
          stripe_checkout_session_id: checkoutSessionId,
          stripe_payment_intent_id: paymentIntentId || null,
          amount: amount ?? null,
          currency
        }
      }, 'prepaid_event_payment_succeeded'),
      sendEventPaymentConfirmationSms(supabase, {
        bookingId: rpcResult.booking_id,
        eventName: rpcResult.event_name || 'your event',
        seats: Math.max(1, Number(rpcResult.seats ?? 1)),
        appBaseUrl
      })
    ])

    if (analyticsOutcome.status === 'rejected') {
      const reason = analyticsOutcome.reason instanceof Error ? analyticsOutcome.reason.message : String(analyticsOutcome.reason)
      logger.warn('Prepaid event payment analytics task rejected unexpectedly', {
        metadata: {
          bookingId: rpcResult.booking_id,
          customerId: rpcResult.customer_id,
          checkoutSessionId,
          error: reason
        }
      })
    }

    if (smsOutcome.status === 'rejected') {
      const reason = smsOutcome.reason instanceof Error ? smsOutcome.reason.message : String(smsOutcome.reason)
      logger.error('Prepaid event payment confirmation SMS task rejected unexpectedly', {
        error: smsOutcome.reason instanceof Error ? smsOutcome.reason : new Error(String(smsOutcome.reason)),
        metadata: {
          bookingId: rpcResult.booking_id,
          checkoutSessionId,
          error: reason
        }
      })
    } else {
      const smsResult = smsOutcome.value as {
        success?: boolean
        code?: string | null
        logFailure?: boolean
        error?: string | null
      } | null
      const smsCode = typeof smsResult?.code === 'string' ? smsResult.code : null
      const smsLogFailure = smsResult?.logFailure === true || smsCode === 'logging_failed'
      if (smsResult && smsResult.success !== true) {
        if (smsLogFailure) {
          logger.error('Prepaid event payment confirmation SMS reported logging failure', {
            metadata: {
              bookingId: rpcResult.booking_id,
              checkoutSessionId,
              code: smsCode,
              logFailure: smsLogFailure,
              error: typeof smsResult.error === 'string' ? smsResult.error : null
            }
          })
        } else {
          logger.warn('Prepaid event payment confirmation SMS send returned non-success', {
            metadata: {
              bookingId: rpcResult.booking_id,
              checkoutSessionId,
              code: smsCode,
              logFailure: smsLogFailure,
              error: typeof smsResult.error === 'string' ? smsResult.error : null
            }
          })
        }
      }
    }
  }

  if (rpcResult.state === 'blocked' && rpcResult.booking_id) {
    try {
      const retrySmsResult = await sendEventPaymentRetrySms(supabase, {
        bookingId: rpcResult.booking_id,
        appBaseUrl
      })
      logEventPaymentRetrySmsOutcome(
        {
          bookingId: rpcResult.booking_id,
          checkoutSessionId,
          context: 'blocked_checkout'
        },
        retrySmsResult
      )
    } catch (retrySmsError) {
      logger.warn('Failed to send event payment retry SMS from Stripe webhook (blocked checkout)', {
        metadata: {
          bookingId: rpcResult.booking_id,
          checkoutSessionId,
          error: retrySmsError instanceof Error ? retrySmsError.message : String(retrySmsError)
        }
      })
    }
  }
}

async function handleApprovedChargePaymentIntentEvent(
  supabase: ReturnType<typeof createAdminClient>,
  paymentIntent: any,
  eventType: string
): Promise<void> {
  const paymentIntentId = typeof paymentIntent?.id === 'string' ? paymentIntent.id : null
  if (!paymentIntentId) {
    return
  }

  const metadata =
    typeof paymentIntent?.metadata === 'object' && paymentIntent.metadata !== null
      ? (paymentIntent.metadata as Record<string, string>)
      : {}

  if (metadata.payment_kind !== 'approved_charge') {
    return
  }

  const chargeRequestId = typeof metadata.charge_request_id === 'string'
    ? metadata.charge_request_id
    : null

  if (!chargeRequestId) {
    return
  }

  const amount = typeof paymentIntent?.amount === 'number'
    ? Number((paymentIntent.amount / 100).toFixed(2))
    : 0
  const currency = typeof paymentIntent?.currency === 'string'
    ? paymentIntent.currency.toUpperCase()
    : 'GBP'

  const mappedStatus = eventType === 'payment_intent.succeeded' ? 'succeeded' : 'failed'
  const paymentStatus = mappedStatus
  const errorMessage =
    eventType === 'payment_intent.payment_failed'
      ? typeof paymentIntent?.last_payment_error?.message === 'string'
        ? paymentIntent.last_payment_error.message
        : 'payment_failed'
      : null

  const { data: chargeRequest, error: chargeRequestError } = await (supabase.from('charge_requests') as any)
    .select('id, table_booking_id, metadata, charge_status')
    .eq('id', chargeRequestId)
    .maybeSingle()

  if (chargeRequestError) {
    throw chargeRequestError
  }

  if (!chargeRequest?.table_booking_id) {
    return
  }

  const existingChargeStatus = typeof (chargeRequest as any)?.charge_status === 'string'
    ? ((chargeRequest as any).charge_status as string)
    : null
  const shouldSkipFailureDowngrade = mappedStatus === 'failed' && existingChargeStatus === 'succeeded'
  if (shouldSkipFailureDowngrade) {
    logger.warn('Ignoring Stripe payment failure webhook after approved charge already succeeded', {
      metadata: {
        chargeRequestId,
        paymentIntentId,
        eventType
      }
    })
    return
  }

  const { data: updatedChargeRequest, error: chargeRequestUpdateError } = await (supabase.from('charge_requests') as any)
    .update({
      charge_status: mappedStatus,
      stripe_payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
      metadata: {
        ...((chargeRequest as any)?.metadata || {}),
        payment_kind: 'approved_charge',
        payment_intent_event: eventType,
        payment_intent_error: errorMessage
      }
    })
    .eq('id', chargeRequestId)
    .select('id')
    .maybeSingle()

  if (chargeRequestUpdateError) {
    throw chargeRequestUpdateError
  }
  if (!updatedChargeRequest) {
    throw new Error(`Charge request missing during approved charge webhook update: ${chargeRequestId}`)
  }

  let paymentUpdateQuery = (supabase.from('payments') as any)
    .update({
      status: paymentStatus,
      metadata: {
        payment_kind: 'approved_charge',
        payment_intent_event: eventType,
        payment_intent_error: errorMessage
      }
    })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('table_booking_id', chargeRequest.table_booking_id)

  if (mappedStatus === 'failed') {
    paymentUpdateQuery = paymentUpdateQuery.in('status', ['pending', 'failed'])
  }

  const { data: updatedPayments, error: paymentUpdateError } = await paymentUpdateQuery.select('id')
  if (paymentUpdateError) {
    throw paymentUpdateError
  }
  if (!Array.isArray(updatedPayments) || updatedPayments.length === 0) {
    throw new Error(`Payment rows missing during approved charge webhook update: ${paymentIntentId}`)
  }

  const { data: booking, error: bookingLookupError } = await (supabase.from('table_bookings') as any)
    .select('customer_id')
    .eq('id', chargeRequest.table_booking_id)
    .maybeSingle()

  if (bookingLookupError) {
    throw bookingLookupError
  }

  if (booking?.customer_id) {
    try {
      await recordAnalyticsEvent(supabase, {
        customerId: booking.customer_id,
        tableBookingId: chargeRequest.table_booking_id,
        eventType: mappedStatus === 'succeeded' ? 'charge_succeeded' : 'charge_failed',
        metadata: {
          charge_request_id: chargeRequestId,
          stripe_payment_intent_id: paymentIntentId,
          amount,
          currency,
          source_event: eventType,
          reason: errorMessage
        }
      })
    } catch (analyticsError) {
      logger.warn('Failed to record analytics for approved charge payment intent webhook', {
        metadata: {
          chargeRequestId,
          paymentIntentId,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        }
      })
    }
  }
}

async function handleChargeRefunded(
  supabase: ReturnType<typeof createAdminClient>,
  charge: any
): Promise<void> {
  const paymentIntentId = typeof charge?.payment_intent === 'string' ? charge.payment_intent : null
  if (!paymentIntentId) {
    return
  }

  const fullyRefunded = charge?.refunded === true
  const newStatus = fullyRefunded ? 'refunded' : 'partial_refund'

  const { data: payments, error: lookupError } = await (supabase.from('payments') as any)
    .select('id, table_booking_id, event_booking_id, customer_id')
    .eq('stripe_payment_intent_id', paymentIntentId)

  if (lookupError) {
    throw lookupError
  }

  if (!Array.isArray(payments) || payments.length === 0) {
    return
  }

  const { error: updateError } = await (supabase.from('payments') as any)
    .update({ status: newStatus })
    .eq('stripe_payment_intent_id', paymentIntentId)

  if (updateError) {
    throw updateError
  }

  const payment = payments[0] as { table_booking_id?: string; event_booking_id?: string; customer_id?: string }
  const customerId = payment.customer_id

  if (customerId) {
    await recordAnalyticsEventSafe(supabase, {
      customerId,
      tableBookingId: payment.table_booking_id,
      eventBookingId: payment.event_booking_id,
      eventType: fullyRefunded ? 'payment_refunded' : 'payment_partially_refunded',
      metadata: {
        stripe_payment_intent_id: paymentIntentId,
        refund_status: newStatus
      }
    }, 'handleChargeRefunded')
  }
}

async function handleCheckoutSessionFailure(
  supabase: ReturnType<typeof createAdminClient>,
  stripeSession: any,
  failureType: string,
  appBaseUrl: string
): Promise<void> {
  const checkoutSessionId = typeof stripeSession?.id === 'string' ? stripeSession.id : null
  if (!checkoutSessionId) {
    return
  }

  const metadata = getSessionMetadata(stripeSession)
  const paymentKind = metadata.payment_kind || 'prepaid_event'

  if (paymentKind === 'table_card_capture') {
    return
  }

  if (paymentKind === 'table_deposit') {
    const nowIso = new Date().toISOString()
    const { data: rows, error } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        metadata: {
          payment_kind: paymentKind,
          stripe_failure_type: failureType,
          updated_at: nowIso
        }
      })
      .eq('stripe_checkout_session_id', checkoutSessionId)
      .eq('charge_type', 'table_deposit')
      .eq('status', 'pending')
      .select('table_booking_id')

    if (error) {
      throw error
    }

    let tableBookingId = rows?.[0]?.table_booking_id as string | undefined

    if (!Array.isArray(rows) || rows.length === 0) {
      const { data: existingPayment, error: existingPaymentLookupError } = await supabase
        .from('payments')
        .select('id, status, table_booking_id')
        .eq('stripe_checkout_session_id', checkoutSessionId)
        .eq('charge_type', 'table_deposit')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingPaymentLookupError) {
        throw new Error(
          `Failed to verify existing table-deposit payment after checkout failure webhook: ${existingPaymentLookupError.message}`
        )
      }

      if (!existingPayment) {
        throw new Error(`Checkout failure webhook missing table-deposit payment row: ${checkoutSessionId}`)
      }

      const existingStatus =
        typeof (existingPayment as any)?.status === 'string'
          ? ((existingPayment as any).status as string)
          : null

      if (
        existingStatus !== 'failed' &&
        existingStatus !== 'succeeded' &&
        existingStatus !== 'refunded' &&
        existingStatus !== 'partially_refunded'
      ) {
        throw new Error(
          `Checkout failure webhook table-deposit payment row was not transitioned to failed: ${checkoutSessionId}`
        )
      }

      tableBookingId =
        typeof (existingPayment as any)?.table_booking_id === 'string'
          ? ((existingPayment as any).table_booking_id as string)
          : undefined
    }

    if (!tableBookingId) {
      return
    }

    const { data: booking, error: bookingLookupError } = await (supabase.from('table_bookings') as any)
      .select('id, customer_id')
      .eq('id', tableBookingId)
      .maybeSingle()

    if (bookingLookupError) {
      logger.warn('Checkout failure webhook could not load table booking for analytics', {
        metadata: {
          tableBookingId,
          checkoutSessionId,
          error: bookingLookupError.message,
        }
      })
      return
    }

    if (booking?.customer_id) {
      await recordAnalyticsEventSafe(supabase, {
        customerId: booking.customer_id,
        tableBookingId,
        eventType: 'payment_failed',
        metadata: {
          payment_kind: paymentKind,
          stripe_checkout_session_id: checkoutSessionId,
          failure_type: failureType,
        }
      }, 'table_deposit_checkout_failure')
    }

    return
  }

  const { data: rows, error } = await supabase
    .from('payments')
    .update({
      status: 'failed',
      metadata: {
        payment_kind: paymentKind,
        stripe_failure_type: failureType,
        updated_at: new Date().toISOString()
      }
    })
    .eq('stripe_checkout_session_id', checkoutSessionId)
    .eq('status', 'pending')
    .select('event_booking_id')

  if (error) {
    throw error
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    const { data: existingPayment, error: existingPaymentLookupError } = await supabase
      .from('payments')
      .select('id, status')
      .eq('stripe_checkout_session_id', checkoutSessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingPaymentLookupError) {
      throw new Error(
        `Failed to verify existing payment after checkout failure webhook: ${existingPaymentLookupError.message}`
      )
    }

    if (!existingPayment) {
      throw new Error(`Checkout failure webhook missing payment row: ${checkoutSessionId}`)
    }

    const existingStatus =
      typeof (existingPayment as any)?.status === 'string'
        ? ((existingPayment as any).status as string)
        : null

    if (
      existingStatus !== 'failed' &&
      existingStatus !== 'succeeded' &&
      existingStatus !== 'refunded' &&
      existingStatus !== 'partially_refunded'
    ) {
      throw new Error(
        `Checkout failure webhook payment row was not transitioned to failed: ${checkoutSessionId}`
      )
    }

    return
  }

  const bookingId = rows?.[0]?.event_booking_id as string | undefined
  if (!bookingId) {
    throw new Error(`Checkout failure webhook updated payment without booking id: ${checkoutSessionId}`)
  }

  const { data: booking, error: bookingLookupError } = await supabase
    .from('bookings')
    .select('id, customer_id')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingLookupError) {
    logger.warn('Checkout failure webhook could not load booking for analytics', {
      metadata: {
        bookingId,
        checkoutSessionId,
        error: bookingLookupError.message
      }
    })
  }

  if (booking && booking.customer_id) {
    await recordAnalyticsEventSafe(supabase, {
      customerId: booking.customer_id,
      eventBookingId: bookingId,
      eventType: 'payment_failed',
      metadata: {
        payment_kind: paymentKind,
        stripe_checkout_session_id: checkoutSessionId,
        failure_type: failureType
      }
    }, 'checkout_session_failure')
  }

  if (paymentKind !== 'seat_increase') {
    try {
      const retrySmsResult = await sendEventPaymentRetrySms(supabase, {
        bookingId,
        appBaseUrl
      })
      logEventPaymentRetrySmsOutcome(
        {
          bookingId,
          checkoutSessionId,
          context: 'checkout_failure'
        },
        retrySmsResult
      )
    } catch (retrySmsError) {
      logger.warn('Failed to send event payment retry SMS from Stripe webhook', {
        metadata: {
          bookingId,
          checkoutSessionId,
          error: retrySmsError instanceof Error ? retrySmsError.message : String(retrySmsError)
        }
      })
    }
  }
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!webhookSecret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 500 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!verifyStripeWebhookSignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: StripeWebhookEvent
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const eventId = typeof event.id === 'string' ? event.id.trim() : ''
  if (!eventId) {
    return NextResponse.json({ error: 'Missing event id' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const headers = Object.fromEntries(request.headers.entries())
  const requestHash = computeIdempotencyRequestHash(event)
  const idempotencyKey = `webhook:stripe:${eventId}`

  const idempotency = await claimIdempotencyKey(
    supabase,
    idempotencyKey,
    requestHash,
    24 * 30
  )

  if (idempotency.state === 'conflict') {
    await logStripeWebhook(supabase, {
      status: 'idempotency_conflict',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type,
      errorMessage: 'Event id reused with a different payload'
    })
    return NextResponse.json({ error: 'Conflict' }, { status: 409 })
  }

  if (idempotency.state === 'in_progress') {
    await logStripeWebhook(supabase, {
      status: 'in_progress',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type
    })
    return NextResponse.json(
      { error: 'Event is currently being processed' },
      { status: 409 }
    )
  }

  if (idempotency.state === 'replay') {
    await logStripeWebhook(supabase, {
      status: 'duplicate',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type
    })
    return NextResponse.json({ received: true, duplicate: true })
  }

  await logStripeWebhook(supabase, {
    status: 'received',
    headers,
    body: rawBody,
    eventId: event.id,
    eventType: event.type
  })

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutSessionCompleted(supabase, event.data?.object, appBaseUrl)
    } else if (event.type === 'checkout.session.expired') {
      await handleCheckoutSessionFailure(supabase, event.data?.object, 'checkout_session_expired', appBaseUrl)
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await handleCheckoutSessionFailure(supabase, event.data?.object, 'checkout_session_async_failed', appBaseUrl)
    } else if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      await handleApprovedChargePaymentIntentEvent(supabase, event.data?.object, event.type)
    } else if (event.type === 'charge.refunded') {
      await handleChargeRefunded(supabase, event.data?.object)
    }

    try {
      await persistIdempotencyResponse(
        supabase,
        idempotencyKey,
        requestHash,
        {
          state: 'processed',
          event_id: event.id,
          event_type: event.type,
          processed_at: new Date().toISOString()
        },
        24 * 30
      )
    } catch (persistError) {
      // Returning 500 causes Stripe to retry, which can trigger duplicate sends/mutations when
      // the main handler has already committed but idempotency persistence failed.
      logger.error('Stripe webhook processed but failed to persist idempotency response', {
        error: persistError instanceof Error ? persistError : new Error(String(persistError)),
        metadata: {
          eventId: event.id,
          eventType: event.type
        }
      })

      await logStripeWebhook(supabase, {
        status: 'idempotency_persist_failed',
        headers,
        body: rawBody,
        eventId: event.id,
        eventType: event.type,
        errorMessage: persistError instanceof Error ? persistError.message : String(persistError)
      })

      return NextResponse.json({ received: true, idempotency_persist_failed: true })
    }

    await logStripeWebhook(supabase, {
      status: 'success',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    logger.error('Failed to process Stripe webhook event', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        eventId: event.id,
        eventType: event.type
      }
    })

    try {
      await releaseIdempotencyClaim(supabase, idempotencyKey, requestHash)
    } catch (releaseError) {
      logger.error('Failed to release Stripe webhook idempotency claim', {
        error: releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
        metadata: { eventId: event.id }
      })
    }

    await logStripeWebhook(supabase, {
      status: 'error',
      headers,
      body: rawBody,
      eventId: event.id,
      eventType: event.type,
      errorMessage: error instanceof Error ? error.message : String(error)
    })

    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
