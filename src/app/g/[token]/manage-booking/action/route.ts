import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  cancelEventBookingByRawToken,
  createSeatIncreaseCheckoutByManageToken,
  getEventManagePreviewByRawToken,
  getEventRefundPolicy,
  processEventRefund,
  updateEventBookingSeatsByRawToken
} from '@/lib/events/manage-booking'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'

type RouteContext = {
  params: Promise<{ token: string }>
}

function toNumber(input: FormDataEntryValue | null): number | null {
  if (typeof input !== 'string') return null
  const parsed = Number.parseInt(input, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function toMoney(value: number): number {
  return Number(value.toFixed(2))
}

function redirectToState(request: NextRequest, token: string, params: Record<string, string>): NextResponse {
  const redirectUrl = new URL(`/g/${token}/manage-booking`, request.url)
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value)
  }
  return NextResponse.redirect(redirectUrl, { status: 303 })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_event_manage_action',
    maxAttempts: 12
  })

  if (!throttle.allowed) {
    return redirectToState(request, token, {
      state: 'blocked',
      reason: 'rate_limited'
    })
  }

  const supabase = createAdminClient()

  try {
    const formData = await request.formData()
    const intent = typeof formData.get('intent') === 'string' ? String(formData.get('intent')) : ''

    const preview = await getEventManagePreviewByRawToken(supabase, token)
    if (preview.state !== 'ready') {
      return redirectToState(request, token, {
        state: 'blocked',
        reason: preview.reason || 'unavailable'
      })
    }

    if (intent === 'cancel') {
      const cancelResult = await cancelEventBookingByRawToken(supabase, {
        rawToken: token,
        cancelledBy: 'guest'
      })

      if (cancelResult.state !== 'cancelled') {
        return redirectToState(request, token, {
          state: 'blocked',
          reason: cancelResult.reason || (cancelResult.state === 'already_cancelled' ? 'already_cancelled' : 'unavailable')
        })
      }

      let refundStatus = 'none'
      let refundAmount = 0

      if (
        cancelResult.payment_mode === 'prepaid' &&
        cancelResult.previous_status === 'confirmed' &&
        cancelResult.booking_id &&
        cancelResult.customer_id &&
        cancelResult.event_id &&
        cancelResult.event_start_datetime
      ) {
        const seatCount = Math.max(1, Number(cancelResult.seats ?? 1))
        const pricePerSeat = Math.max(0, Number(cancelResult.price_per_seat ?? 0))
        const policy = getEventRefundPolicy(cancelResult.event_start_datetime)
        const candidateRefundAmount = toMoney(seatCount * pricePerSeat * policy.refundRate)
        const refundResult = await processEventRefund(supabase, {
          bookingId: cancelResult.booking_id,
          customerId: cancelResult.customer_id,
          eventId: cancelResult.event_id,
          amount: candidateRefundAmount,
          reason: `event_cancel_${policy.policyBand}`
        })
        refundStatus = refundResult.status
        refundAmount = refundResult.amount
      }

      if (cancelResult.customer_id && cancelResult.booking_id) {
        await recordAnalyticsEvent(supabase, {
          customerId: cancelResult.customer_id,
          eventBookingId: cancelResult.booking_id,
          eventType: 'event_booking_cancelled',
          metadata: {
            event_id: cancelResult.event_id ?? null,
            seats: cancelResult.seats ?? null,
            payment_mode: cancelResult.payment_mode ?? null,
            refund_status: refundStatus,
            refund_amount: refundAmount
          }
        })
      }

      return redirectToState(request, token, {
        state: 'cancelled',
        refund_status: refundStatus,
        refund_amount: String(refundAmount)
      })
    }

    if (intent === 'update_seats') {
      const seatsInput = toNumber(formData.get('seats'))
      if (!seatsInput || seatsInput < 1) {
        return redirectToState(request, token, {
          state: 'blocked',
          reason: 'invalid_seats'
        })
      }

      const currentSeats = Math.max(1, Number(preview.seats ?? 1))
      if (
        preview.payment_mode === 'prepaid' &&
        preview.status === 'confirmed' &&
        seatsInput > currentSeats
      ) {
        const checkoutResult = await createSeatIncreaseCheckoutByManageToken(supabase, {
          rawToken: token,
          targetSeats: seatsInput,
          appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
        })

        if (checkoutResult.state !== 'created') {
          return redirectToState(request, token, {
            state: 'blocked',
            reason: checkoutResult.reason
          })
        }

        return NextResponse.redirect(checkoutResult.checkoutUrl, { status: 303 })
      }

      const updateResult = await updateEventBookingSeatsByRawToken(supabase, {
        rawToken: token,
        newSeats: seatsInput,
        actor: 'guest'
      })

      if (updateResult.state === 'blocked') {
        return redirectToState(request, token, {
          state: 'blocked',
          reason: updateResult.reason || 'unavailable'
        })
      }

      let refundStatus = 'none'
      let refundAmount = 0

      if (
        updateResult.state === 'updated' &&
        Number(updateResult.delta ?? 0) < 0 &&
        updateResult.payment_mode === 'prepaid' &&
        updateResult.status === 'confirmed' &&
        updateResult.customer_id &&
        updateResult.booking_id &&
        updateResult.event_id &&
        updateResult.event_start_datetime
      ) {
        const reducedSeats = Math.abs(Number(updateResult.delta ?? 0))
        const pricePerSeat = Math.max(0, Number(updateResult.price_per_seat ?? 0))
        const policy = getEventRefundPolicy(updateResult.event_start_datetime)
        const candidateRefundAmount = toMoney(reducedSeats * pricePerSeat * policy.refundRate)

        const refundResult = await processEventRefund(supabase, {
          bookingId: updateResult.booking_id,
          customerId: updateResult.customer_id,
          eventId: updateResult.event_id,
          amount: candidateRefundAmount,
          reason: `seat_reduction_${policy.policyBand}`,
          metadata: {
            reduced_seats: reducedSeats,
            old_seats: updateResult.old_seats ?? null,
            new_seats: updateResult.new_seats ?? null
          }
        })
        refundStatus = refundResult.status
        refundAmount = refundResult.amount
      }

      return redirectToState(request, token, {
        state: updateResult.state,
        delta: String(updateResult.delta ?? 0),
        refund_status: refundStatus,
        refund_amount: String(refundAmount)
      })
    }

    return redirectToState(request, token, {
      state: 'blocked',
      reason: 'invalid_intent'
    })
  } catch (error) {
    logger.error('Failed to process guest manage-booking action', {
      error: error instanceof Error ? error : new Error(String(error))
    })

    return redirectToState(request, token, {
      state: 'blocked',
      reason: 'internal_error'
    })
  }
}
