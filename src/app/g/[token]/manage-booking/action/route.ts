import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/env'
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import {
  createSeatIncreaseCheckoutByManageToken,
  getEventManagePreviewByRawToken,
  getEventRefundPolicy,
  processEventRefund,
  updateEventBookingSeatsByRawToken,
} from '@/lib/events/manage-booking'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import {
  syncPubOpsEventCalendarByBookingId,
  syncPubOpsEventCalendarByEventId,
} from '@/lib/google-calendar-events'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'
import { bookerCanEditGuestDetails, guestDetailsEditSchema } from '@/lib/events/guest-details-edit'
import { loadBookingGuestDetails, saveBookingGuestDetails } from '@/lib/events/guest-details-server'

type RouteContext = {
  params: Promise<{ token: string }>
}

function toNumber(input: FormDataEntryValue | null): number | null {
  if (typeof input !== 'string') return null
  const parsed = Number.parseInt(input, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The guest details form posts one guest_id per ticket, in order, with guest_name_<n> and
 * answer_<n>_<questionId> beside it. Anything else in the form is ignored.
 */
function readGuestDetailsForm(formData: FormData): unknown {
  const ids = formData.getAll('guest_id').map(String)
  return ids.map((id, index) => {
    const answers: Record<string, string> = {}
    const prefix = `answer_${index}_`
    for (const [key, value] of formData.entries()) {
      if (key.startsWith(prefix) && typeof value === 'string') answers[key.slice(prefix.length)] = value
    }
    const name = formData.get(`guest_name_${index}`)
    return { id, name: typeof name === 'string' ? name : '', answers }
  })
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

    // Guest self-cancel has been removed — cancellations are handled by staff in
    // AMS so a manager can make the refund decision. Guests can still change seats.
    if (intent === 'cancel') {
      return redirectToState(request, token, {
        state: 'blocked',
        reason: 'cancel_not_available'
      })
    }

    // BK-016: the booker adds or corrects each guest's name and answers.
    if (intent === 'update_guest_details') {
      if (!preview.booking_id) {
        return redirectToState(request, token, { state: 'blocked', reason: 'booking_not_found' })
      }
      const loaded = await loadBookingGuestDetails(supabase, preview.booking_id)
      if (!loaded || !bookerCanEditGuestDetails({
        status: preview.status,
        eventStart: preview.event_start_datetime,
        salesCutoff: loaded.event.salesCutoff,
      })) {
        return redirectToState(request, token, { state: 'blocked', reason: 'guest_details_closed' })
      }
      if (formData.get('details_confirmed') !== 'yes') {
        return redirectToState(request, token, { state: 'blocked', reason: 'guest_details_unconfirmed' })
      }
      const edits = guestDetailsEditSchema.safeParse(readGuestDetailsForm(formData))
      if (!edits.success) {
        return redirectToState(request, token, { state: 'blocked', reason: 'guest_details_invalid' })
      }
      const saved = await saveBookingGuestDetails(supabase, preview.booking_id, edits.data, {
        confirmedAt: new Date().toISOString(),
      })
      if (!saved.ok) {
        return redirectToState(request, token, {
          state: 'blocked',
          reason: saved.reason === 'conflict' || saved.error.startsWith('The guest list has changed')
            ? 'guest_details_changed'
            : saved.reason === 'not_editable' ? 'guest_details_closed' : 'guest_details_invalid',
        })
      }
      // Counts only: the answers never reach the audit log.
      await logAuditEvent({
        operation_type: 'update',
        resource_type: 'event_booking',
        resource_id: preview.booking_id,
        operation_status: 'success',
        additional_info: { field: 'guest_details', actor: 'guest_manage_link', guest_count: saved.guestCount, created: saved.created },
      })
      return redirectToState(request, token, { state: 'guest_details_saved' })
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
          appBaseUrl: getAppUrl()
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
            // One key per seat change (BK-024): old seats, new seats and this request. A second
            // reduction in the same refund band used to count as already refunded. A repeat of
            // this request cannot refund twice either way: the seats are already reduced, so it
            // finds no change to refund.
            idempotency_key: `guest-seat-reduction:${updateResult.booking_id}:${updateResult.old_seats ?? 'x'}-${updateResult.new_seats ?? 'x'}:${randomUUID()}`,
            reduced_seats: reducedSeats,
            old_seats: updateResult.old_seats ?? null,
            new_seats: updateResult.new_seats ?? null
          }
        })
        refundStatus = refundResult.status
        refundAmount = refundResult.amount
        if (refundResult.status === 'failed' || refundResult.status === 'manual_required') {
          // The guest is owed money for the seats they gave up (BK-114).
          await alertEventPaymentNeedsAPerson(supabase, {
            bookingId: updateResult.booking_id,
            kind: 'refund_failed',
            reason: refundResult.reason ?? refundResult.status,
            amount: candidateRefundAmount,
            source: 'guest seat reduction',
          })
        }
      }

      if (
        updateResult.state === 'updated' &&
        Number(updateResult.delta ?? 0) !== 0 &&
        updateResult.booking_id
      ) {
        try {
          await sendEventBookingSeatUpdateSms(supabase, {
            bookingId: updateResult.booking_id,
            eventName: updateResult.event_name || null,
            oldSeats: Math.max(1, Number(updateResult.old_seats ?? seatsInput)),
            newSeats: Math.max(1, Number(updateResult.new_seats ?? seatsInput)),
            appBaseUrl: getAppUrl()
          })
        } catch (smsError) {
          logger.warn('Failed to send guest seat update SMS', {
            metadata: {
              bookingId: updateResult.booking_id,
              error: smsError instanceof Error ? smsError.message : String(smsError)
            }
          })
        }
      }

      if (
        updateResult.state === 'updated' &&
        Number(updateResult.delta ?? 0) !== 0
      ) {
        if (updateResult.event_id) {
          await syncPubOpsEventCalendarByEventId(supabase, updateResult.event_id, {
            bookingId: updateResult.booking_id ?? null,
            context: 'guest_event_booking_seats_updated',
          })
        } else if (updateResult.booking_id) {
          await syncPubOpsEventCalendarByBookingId(supabase, updateResult.booking_id, {
            context: 'guest_event_booking_seats_updated',
          })
        }
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
