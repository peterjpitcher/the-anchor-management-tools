/**
 * The guest's answer to "are you still coming?".
 *
 * POST, never GET, and that is the whole reason this route exists separately from the
 * page. Some carriers and messaging apps prefetch links in an SMS. A GET that confirmed
 * the booking would record "yes" for a guest who never opened the text, which turns the
 * one signal this feature exists to produce into noise, and makes the call list wrong in
 * the one direction that costs the pub a table.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { isAnswerable, lookupConfirmToken } from '@/lib/table-bookings/confirm-token'
import { updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const supabase = createAdminClient()

  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_booking_confirm',
    maxAttempts: 40,
  })

  if (!throttle.allowed) {
    return NextResponse.redirect(new URL(`/g/${token}/confirm-booking?state=busy`, request.url), {
      status: 303,
    })
  }

  const form = await request.formData()
  const answer = String(form.get('answer') || '')

  const lookup = await lookupConfirmToken(supabase, token)
  if (!lookup.ok) {
    return NextResponse.redirect(
      new URL(`/g/${token}/confirm-booking?state=${lookup.reason}`, request.url),
      { status: 303 },
    )
  }

  if (!isAnswerable(lookup.booking.status)) {
    return NextResponse.redirect(
      new URL(`/g/${token}/confirm-booking?state=not_answerable`, request.url),
      { status: 303 },
    )
  }

  if (answer === 'yes') {
    // Idempotent by construction: a second tap writes the same column again and the guest
    // sees the same page. Messaging apps retry POSTs, and a guest who is unsure often taps
    // twice, so a duplicate must be uneventful rather than an error.
    const { error } = await supabase
      .from('table_bookings')
      .update({ guest_confirmed_at: new Date().toISOString() })
      .eq('id', lookup.booking.id)

    if (error) {
      logger.error('Failed to record a guest booking confirmation', {
        metadata: { tableBookingId: lookup.booking.id, error: error.message },
      })
      return NextResponse.redirect(
        new URL(`/g/${token}/confirm-booking?state=error`, request.url),
        { status: 303 },
      )
    }

    return NextResponse.redirect(
      new URL(`/g/${token}/confirm-booking?state=confirmed`, request.url),
      { status: 303 },
    )
  }

  if (answer === 'no') {
    // Cancelling goes through the existing guest cancel path rather than writing the
    // status here. That path owns freeing the table, the audit row and the cancellation
    // message; a second implementation would drift from it and silently stop releasing
    // capacity, which is the opposite of what this feature is for.
    try {
      await updateTableBookingByRawToken(supabase, {
        rawToken: token,
        action: 'cancel',
        cancellationReason: 'guest_declined_confirmation',
        allowedActionTypes: ['booking_confirm'],
      })
    } catch (cancelError) {
      logger.error('Failed to cancel a booking from the confirm link', {
        metadata: {
          tableBookingId: lookup.booking.id,
          error: cancelError instanceof Error ? cancelError.message : String(cancelError),
        },
      })
      return NextResponse.redirect(
        new URL(`/g/${token}/confirm-booking?state=cancel_failed`, request.url),
        { status: 303 },
      )
    }

    return NextResponse.redirect(
      new URL(`/g/${token}/confirm-booking?state=cancelled`, request.url),
      { status: 303 },
    )
  }

  return NextResponse.redirect(new URL(`/g/${token}/confirm-booking`, request.url), { status: 303 })
}
