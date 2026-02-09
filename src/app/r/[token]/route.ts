import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashGuestToken } from '@/lib/guest/tokens'
import { getGoogleReviewLink } from '@/lib/events/review-link'
import { logger } from '@/lib/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const supabase = createAdminClient()
  const fallbackTarget = await getGoogleReviewLink(supabase)
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_review_redirect',
    maxAttempts: 80
  })

  if (!throttle.allowed) {
    return NextResponse.redirect(fallbackTarget, { status: 302 })
  }

  try {
    const hashedToken = hashGuestToken(token)
    const nowIso = new Date().toISOString()

    const { data: guestToken, error: tokenError } = await supabase
      .from('guest_tokens')
      .select('id, customer_id, event_booking_id, table_booking_id, expires_at')
      .eq('hashed_token', hashedToken)
      .eq('action_type', 'review_redirect')
      .maybeSingle()

    if (tokenError || !guestToken || (!guestToken.event_booking_id && !guestToken.table_booking_id)) {
      return NextResponse.redirect(fallbackTarget, { status: 302 })
    }

    if (guestToken.expires_at && Date.parse(guestToken.expires_at) <= Date.now()) {
      return NextResponse.redirect(fallbackTarget, { status: 302 })
    }

    if (guestToken.event_booking_id) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('id, event_id, status')
        .eq('id', guestToken.event_booking_id)
        .maybeSingle()

      if (booking) {
        await supabase
          .from('bookings')
          .update({
            status: booking.status === 'completed' ? booking.status : 'review_clicked',
            review_clicked_at: nowIso,
            updated_at: nowIso
          })
          .eq('id', booking.id)
          .in('status', ['visited_waiting_for_review', 'confirmed', 'review_clicked'])

        if (guestToken.customer_id) {
          await recordAnalyticsEvent(supabase, {
            customerId: guestToken.customer_id,
            eventBookingId: booking.id,
            eventType: 'review_link_clicked',
            metadata: {
              event_id: booking.event_id,
              booking_type: 'event'
            }
          })
        }
      }
    }

    if (guestToken.table_booking_id) {
      const { data: tableBooking } = await supabase
        .from('table_bookings')
        .select('id, status, booking_type')
        .eq('id', guestToken.table_booking_id)
        .maybeSingle()

      if (tableBooking) {
        await (supabase.from('table_bookings') as any)
          .update({
            status: tableBooking.status === 'completed' ? tableBooking.status : 'review_clicked',
            review_clicked_at: nowIso,
            updated_at: nowIso
          })
          .eq('id', tableBooking.id)
          .in('status', ['visited_waiting_for_review', 'confirmed', 'review_clicked'])

        if (guestToken.customer_id) {
          await recordAnalyticsEvent(supabase, {
            customerId: guestToken.customer_id,
            tableBookingId: tableBooking.id,
            eventType: 'review_link_clicked',
            metadata: {
              booking_type: tableBooking.booking_type || 'table'
            }
          })
        }
      }
    }
  } catch (error) {
    logger.warn('Failed processing review redirect token', {
      metadata: {
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }

  return NextResponse.redirect(fallbackTarget, { status: 302 })
}
