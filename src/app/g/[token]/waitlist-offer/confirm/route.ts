import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { acceptWaitlistOfferByRawToken } from '@/lib/events/waitlist-offers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { createEventPaymentToken } from '@/lib/events/event-payments'
import { createEventManageToken } from '@/lib/events/manage-booking'

type RouteContext = {
  params: Promise<{ token: string }>
}

function buildRedirectUrl(
  request: NextRequest,
  token: string,
  state: string,
  reason?: string
): URL {
  const redirectUrl = new URL(`/g/${token}/waitlist-offer`, request.url)
  redirectUrl.searchParams.set('state', state)
  if (reason) {
    redirectUrl.searchParams.set('reason', reason)
  }
  return redirectUrl
}

async function recordWaitlistAcceptanceAnalyticsSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
) {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed to record waitlist acceptance analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

async function sendAcceptanceSms(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  state: 'confirmed' | 'pending_payment',
  appBaseUrl: string
): Promise<void> {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id, seats, hold_expires_at')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingError || !booking?.customer_id) {
    logger.warn('Failed to load booking for waitlist acceptance SMS', {
      metadata: { bookingId, error: bookingError?.message }
    })
    return
  }

  const [
    { data: customer, error: customerError },
    { data: event, error: eventError },
  ] = await Promise.all([
    supabase
      .from('customers')
      .select('id, first_name, mobile_number, sms_status')
      .eq('id', booking.customer_id)
      .maybeSingle(),
    supabase
      .from('events')
      .select('id, name, start_datetime, payment_mode')
      .eq('id', booking.event_id)
      .maybeSingle()
  ])

  if (customerError) {
    logger.warn('Failed to load customer for waitlist acceptance SMS', {
      metadata: { bookingId, error: customerError.message },
    })
    return
  }

  if (eventError) {
    logger.warn('Failed to load event for waitlist acceptance SMS', {
      metadata: { bookingId, error: eventError.message },
    })
    return
  }

  if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return
  }

  if (!event) {
    logger.warn('Waitlist acceptance SMS event lookup affected no rows', {
      metadata: { bookingId, eventId: booking.event_id },
    })
    return
  }

  const firstName = customer.first_name || 'there'
  const eventName = event.name || 'your event'
  const seats = Math.max(1, Number(booking.seats ?? 1))
  const seatWord = seats === 1 ? 'seat' : 'seats'
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  let manageLink: string | null = null
  try {
    const manageToken = await createEventManageToken(supabase, {
      customerId: customer.id,
      bookingId: booking.id,
      eventStartIso: event.start_datetime || null,
      appBaseUrl
    })
    manageLink = manageToken.url
  } catch (error) {
    logger.warn('Failed to create manage token for waitlist acceptance', {
      metadata: {
        bookingId: booking.id,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }
  let message: string

  if (state === 'pending_payment') {
    let paymentLink: string | null = null
    if (booking.hold_expires_at) {
      try {
        const tokenResult = await createEventPaymentToken(supabase, {
          customerId: customer.id,
          bookingId: booking.id,
          holdExpiresAt: booking.hold_expires_at,
          appBaseUrl
        })
        paymentLink = tokenResult.url
      } catch (error) {
        logger.warn('Failed to create payment token for waitlist acceptance', {
          metadata: {
            bookingId: booking.id,
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }

    if (paymentLink) {
      message = `The Anchor: ${firstName}! ${seats} ${seatWord} held for ${eventName} — nice one! Complete your payment here: ${paymentLink}.${manageLink ? ` ${manageLink}` : ''}`
    } else {
      message = `The Anchor: ${firstName}! ${seats} ${seatWord} held for ${eventName} — nice one! We'll ping you a payment link shortly.${manageLink ? ` ${manageLink}` : ''}`
    }
  } else {
    const eventDateFormatted = event.start_datetime
      ? (() => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(event.start_datetime)) } catch { return '' } })()
      : ''
    const eventDatePart = eventDateFormatted ? ` on ${eventDateFormatted}` : ''
    message = `The Anchor: ${firstName}! You're in — ${seats} ${seatWord} confirmed for ${eventName}${eventDatePart}. See you there!${manageLink ? ` ${manageLink}` : ''}`
  }

  let smsResult: Awaited<ReturnType<typeof sendSMS>>
  try {
    smsResult = await sendSMS(
      customer.mobile_number,
      ensureReplyInstruction(message, supportPhone),
      {
        customerId: customer.id,
        metadata: {
          event_booking_id: booking.id,
          event_id: event.id,
          template_key: state === 'pending_payment' ? 'event_waitlist_accepted_pending_payment' : 'event_waitlist_accepted_confirmed'
        }
      }
    )
  } catch (smsError) {
    logger.warn('Waitlist acceptance SMS threw unexpectedly', {
      metadata: {
        bookingId: booking.id,
        customerId: customer.id,
        state,
        error: smsError instanceof Error ? smsError.message : String(smsError)
      }
    })
    return
  }

  if (!smsResult.success) {
    logger.warn('Failed to send waitlist acceptance SMS', {
      metadata: {
        bookingId: booking.id,
        customerId: customer.id,
        state,
        error: smsResult.error || 'Unknown SMS error'
      }
    })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_waitlist_offer_accept',
    maxAttempts: 8
  })

  if (!throttle.allowed) {
    return NextResponse.redirect(
      buildRedirectUrl(request, token, 'blocked', 'rate_limited'),
      { status: 303 }
    )
  }

  const supabase = createAdminClient()
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  try {
    const acceptance = await acceptWaitlistOfferByRawToken(supabase, token)

    if (acceptance.state !== 'confirmed' && acceptance.state !== 'pending_payment') {
      return NextResponse.redirect(
        buildRedirectUrl(request, token, 'blocked', acceptance.reason || 'offer_unavailable'),
        { status: 303 }
      )
    }

    const followUpTasks: Promise<unknown>[] = []

    if (acceptance.booking_id) {
      const { data: bookingRow } = await supabase
        .from('bookings')
        .select('customer_id, event_id')
        .eq('id', acceptance.booking_id)
        .maybeSingle()

      if (bookingRow?.customer_id) {
        followUpTasks.push(
          recordWaitlistAcceptanceAnalyticsSafe(supabase, {
            customerId: bookingRow.customer_id,
            eventBookingId: acceptance.booking_id,
            eventType: 'waitlist_offer_accepted',
            metadata: {
              booking_id: acceptance.booking_id,
              event_id: acceptance.event_id || bookingRow.event_id || null,
              state: acceptance.state
            }
          }, {
            customerId: bookingRow.customer_id,
            eventBookingId: acceptance.booking_id,
            eventId: acceptance.event_id || bookingRow.event_id || null,
            state: acceptance.state
          })
        )
      }

      followUpTasks.push(sendAcceptanceSms(supabase, acceptance.booking_id, acceptance.state, appBaseUrl))
    }

    if (followUpTasks.length > 0) {
      await Promise.allSettled(followUpTasks)
    }

    return NextResponse.redirect(
      buildRedirectUrl(request, token, acceptance.state),
      { status: 303 }
    )
  } catch (error) {
    logger.error('Failed to accept waitlist offer token', {
      error: error instanceof Error ? error : new Error(String(error))
    })

    return NextResponse.redirect(
      buildRedirectUrl(request, token, 'blocked', 'internal_error'),
      { status: 303 }
    )
  }
}
