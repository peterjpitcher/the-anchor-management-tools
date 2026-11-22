/**
 * The guest's reply to the morning-after no-show email.
 *
 * POST, never GET, for the reason the confirm-booking action gives: mail scanners and messaging
 * apps open links. Opening the page changes nothing; only a pressed button reaches here. The rules
 * for each answer are in src/lib/table-bookings/no-show-guest-reply.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import {
  lookupNoShowFollowUpToken,
  recordGuestAttended,
  recordGuestCouldNotMakeIt,
  type NoShowReplyOutcome,
} from '@/lib/table-bookings/no-show-guest-reply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const back = (state?: string) =>
    NextResponse.redirect(
      new URL(`/g/${token}/no-show-follow-up${state ? `?state=${state}` : ''}`, request.url),
      { status: 303 },
    )

  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_no_show_follow_up',
    maxAttempts: 20,
  })
  if (!throttle.allowed) return back('busy')

  const form = await request.formData()
  const answer = String(form.get('answer') || '')
  // Public endpoint, so it writes with the admin client (anon has no access to these tables).
  const supabase = createAdminClient()

  const lookup = await lookupNoShowFollowUpToken(supabase, token)
  // The page tells a dead link its own story; no state needed.
  if (!lookup.ok) return back()

  let outcome: NoShowReplyOutcome
  try {
    if (answer === 'attended') {
      outcome = await recordGuestAttended(supabase, lookup.booking)
    } else if (answer === 'could_not_make_it') {
      outcome = await recordGuestCouldNotMakeIt(supabase, lookup.booking, {
        code: form.get('reason'),
        detail: form.get('detail'),
      })
    } else {
      return back()
    }
  } catch (error) {
    logger.error('A reply to the no-show email could not be handled', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: lookup.booking.id, answer },
    })
    outcome = { state: 'failed' }
  }

  if (outcome.state === 'failed') return back('error')
  // Already answered, or already sorted by staff: the page reads the booking and says so.
  if (outcome.state !== 'recorded') return back()
  return back(answer === 'attended' ? 'thanks_attended' : 'thanks_reason')
}
