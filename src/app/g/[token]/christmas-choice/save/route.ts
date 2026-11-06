import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { logger } from '@/lib/logger'
import { loadPreorderOrder } from '@/lib/table-bookings/preorder'
import { preorderClosedMessage } from '@/lib/table-bookings/preorder-food-link-emails'
import { buildFoodSeatView } from '../../table-manage/food-data'
import { FoodSeatPayloadSchema, saveFoodSeat } from '../../table-manage/food-save'
import type { FoodActionResult } from '../../table-manage/food-types'
import { resolvePreorderCutoff } from '../../table-manage/preorder-data'
import { loadGuestChoiceContext } from '../guest-data'

/**
 * One guest saving their own Christmas dinner from the link they were sent (D5).
 *
 * The seat comes from the token, never from the request: a cover id in the body is only checked
 * against it, and a body naming any other seat is refused outright. The posted seat number is
 * ignored, because seat numbers close up when a guest leaves. The save goes through
 * `savePreorderCover` as `{ savedBy: 'guest', coverId }`, which refuses another seat a second time.
 * Refused after the cutoff (D8).
 */

const BodySchema = z.object({ seat: FoodSeatPayloadSchema })

const GENERIC_ERROR = `Something went wrong. Please try again, or call us on ${GUEST_CONTACT.phoneDisplay}.`
const NOT_YOURS = 'This link is for one guest only, so it cannot change anyone else.'

function reply(body: FoodActionResult, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params

  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_christmas_choice_save',
    maxAttempts: 30,
  })
  if (!throttle.allowed) {
    return reply({ success: false, error: 'Too many saves in a short time. Please wait a few minutes and try again.' }, 429)
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return reply({ success: false, error: GENERIC_ERROR }, 400)
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return reply({ success: false, error: GENERIC_ERROR }, 400)
  const payload = parsed.data.seat

  const supabase = createAdminClient()
  try {
    const guest = await loadGuestChoiceContext(supabase, token)
    if (!guest.ok) {
      if (guest.reason === 'expired_token') {
        return reply({ success: false, error: preorderClosedMessage(null) }, 409)
      }
      return reply({ success: false, error: `This link can't be used. Call us on ${GUEST_CONTACT.phoneDisplay} and we'll help.` }, 403)
    }
    const { order, cover } = guest

    // The seat is the token's cover, found by id on the token's own booking, at whatever number it
    // has now. The posted seat number is not trusted: when another guest leaves, the seats close up,
    // and a page opened before that still posts the old number for the right guest. A posted cover
    // id that is not the token's (another seat, or a seat on another booking) is still refused.
    if (payload.coverId && payload.coverId !== cover.id) {
      logger.warn('Guest food link tried to save a seat it is not scoped to', {
        metadata: { tableBookingId: order.tableBookingId },
      })
      return reply({ success: false, error: NOT_YOURS }, 403)
    }

    const cutoff = resolvePreorderCutoff(order.bookingDate, order.preorderCutoffDays)
    if (!cutoff.editable) return reply({ success: false, error: preorderClosedMessage(cutoff.at) }, 409)

    const outcome = await saveFoodSeat(supabase, {
      order,
      cover,
      payload: { ...payload, ordinal: cover.ordinal },
      actor: { savedBy: 'guest', coverId: cover.id },
      source: 'guest_choice_link',
    })
    const after = await loadPreorderOrder(supabase, order.tableBookingId)
    // The guest never sees who was invited or when, so the invite fields are left out.
    const seat = { ...buildFoodSeatView(after ?? order, cover.ordinal), inviteEmail: null, inviteSentAt: null, canResendInvite: false }
    if (outcome.state === 'failed') return reply({ success: false, error: outcome.error, seat }, 422)
    return reply({ success: true, seat })
  } catch (error) {
    logger.error('Guest food link save failed unexpectedly', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return reply({ success: false, error: GENERIC_ERROR }, 500)
  }
}
