import { NextRequest, NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import {
  getEventManagePreviewByRawToken,
  guestSeatChangeBlock,
  updateEventBookingSeatsByRawToken,
} from '@/lib/events/manage-booking'
import { raiseGuestChangeRequest } from '@/lib/events/guest-change-request'
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

    // BK-021 and owner decision D7: on a booking paid online the link asks a manager, who
    // decides any refund starting from what the guest paid. Nothing changes and nothing is
    // refunded here.
    if (intent === 'request_change') {
      const requested = toNumber(formData.get('seats'))
      const currentSeats = Math.max(1, Number(preview.seats ?? 1))
      if (!requested || requested < 1 || requested > 20 || requested === currentSeats || !preview.booking_id) {
        return redirectToState(request, token, { state: 'blocked', reason: 'invalid_seats' })
      }
      if (preview.payment_mode !== 'prepaid' || preview.status !== 'confirmed') {
        return redirectToState(request, token, { state: 'blocked', reason: 'request_not_needed' })
      }
      const startMs = preview.event_start_datetime ? Date.parse(preview.event_start_datetime) : Number.NaN
      if (!Number.isFinite(startMs) || startMs <= Date.now()) {
        return redirectToState(request, token, { state: 'blocked', reason: 'event_started' })
      }

      const raised = await raiseGuestChangeRequest(supabase, {
        bookingId: preview.booking_id,
        eventId: preview.event_id ?? null,
        eventName: preview.event_name ?? null,
        eventStart: preview.event_start_datetime ?? null,
        currentSeats,
        requestedSeats: requested,
      })
      if (!raised.sent && !raised.duplicate) {
        // The request reached nobody, so the guest must not be told it did.
        logger.error('A guest change request could not be passed to a manager', {
          error: new Error('guest_change_request_not_sent'),
          metadata: { bookingId: preview.booking_id, currentSeats, requestedSeats: requested },
        })
        return redirectToState(request, token, { state: 'blocked', reason: 'request_not_sent' })
      }

      await logAuditEvent({
        operation_type: 'update',
        resource_type: 'event_booking',
        resource_id: preview.booking_id,
        operation_status: 'success',
        additional_info: {
          action: 'guest_change_request',
          actor: 'guest_manage_link',
          old_seats: currentSeats,
          requested_seats: requested,
          paid: raised.facts.paid,
          manager_alerted: raised.sent,
        },
      })
      return redirectToState(request, token, { state: 'change_requested', seats: String(requested) })
    }

    if (intent === 'update_seats') {
      const seatsInput = toNumber(formData.get('seats'))
      if (!seatsInput || seatsInput < 1) {
        return redirectToState(request, token, {
          state: 'blocked',
          reason: 'invalid_seats'
        })
      }

      // The same rules staff work under, plus D7: named guests change guest by guest, a booking
      // paid online goes to a manager, and a multi-type booking's seats come from its lines.
      const block = await guestSeatChangeBlock(supabase, preview)
      if (block) {
        return redirectToState(request, token, { state: 'blocked', reason: block })
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

      if (
        updateResult.state === 'updated' &&
        Number(updateResult.delta ?? 0) !== 0 &&
        updateResult.booking_id
      ) {
        // BK-021: every guest seat change is on the record (counts only).
        await logAuditEvent({
          operation_type: 'update',
          resource_type: 'event_booking',
          resource_id: updateResult.booking_id,
          operation_status: 'success',
          additional_info: {
            action: 'guest_seat_change',
            actor: 'guest_manage_link',
            old_seats: updateResult.old_seats ?? null,
            new_seats: updateResult.new_seats ?? null,
            payment_mode: updateResult.payment_mode ?? null,
          },
        })

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
        delta: String(updateResult.delta ?? 0)
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
