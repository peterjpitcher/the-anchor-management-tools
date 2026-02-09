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

  const [{ data: customer }, { data: event }] = await Promise.all([
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

  if (!customer || customer.sms_status !== 'active' || !customer.mobile_number) {
    return
  }

  const firstName = customer.first_name || 'there'
  const eventName = event?.name || 'your event'
  const seats = Math.max(1, Number(booking.seats ?? 1))
  const seatWord = seats === 1 ? 'seat' : 'seats'
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  let manageLink: string | null = null
  try {
    const manageToken = await createEventManageToken(supabase, {
      customerId: customer.id,
      bookingId: booking.id,
      eventStartIso: event?.start_datetime || null,
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
      message = `The Anchor: Hi ${firstName}, your waitlist offer is confirmed and ${seats} ${seatWord} are reserved for ${eventName}. Pay here: ${paymentLink}.${manageLink ? ` Manage booking: ${manageLink}` : ''}`
    } else {
      message = `The Anchor: Hi ${firstName}, your waitlist offer is confirmed and ${seats} ${seatWord} are reserved for ${eventName}. Your booking is pending payment and we'll text your payment link shortly.${manageLink ? ` Manage booking: ${manageLink}` : ''}`
    }
  } else {
    const cashOnArrivalText = event?.payment_mode === 'cash_only' ? ' Payment is cash on arrival.' : ''
    message = `The Anchor: Hi ${firstName}, your waitlist offer is confirmed. You're booked for ${eventName} with ${seats} ${seatWord}.${cashOnArrivalText}${manageLink ? ` Manage booking: ${manageLink}` : ''}`
  }

  await sendSMS(
    customer.mobile_number,
    ensureReplyInstruction(message, supportPhone),
    {
      customerId: customer.id,
      metadata: {
        event_booking_id: booking.id,
        event_id: event?.id ?? null,
        template_key: state === 'pending_payment' ? 'event_waitlist_accepted_pending_payment' : 'event_waitlist_accepted_confirmed'
      }
    }
  )
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
          recordAnalyticsEvent(supabase, {
            customerId: bookingRow.customer_id,
            eventBookingId: acceptance.booking_id,
            eventType: 'waitlist_offer_accepted',
            metadata: {
              booking_id: acceptance.booking_id,
              event_id: acceptance.event_id || bookingRow.event_id || null,
              state: acceptance.state
            }
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
