import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { logger } from '@/lib/logger'
import { getTableManagePreviewByRawToken } from '@/lib/table-bookings/manage-booking'
import { isPreorderEnabled, loadPreorderOrder, syncPreorderCovers } from '@/lib/table-bookings/preorder'
import { preorderClosedMessage } from '@/lib/table-bookings/preorder-food-link-emails'
import type { PreorderOrder } from '@/types/preorders'
import { buildFoodSeatView, loadFoodInviteLedger } from '../food-data'
import { sendFoodChoicesCopy, sendFoodGuestInvite } from '../food-messages'
import { FoodSeatPayloadSchema, saveFoodSeat } from '../food-save'
import type { FoodActionResult } from '../food-types'
import { resolvePreorderCutoff } from '../preorder-data'

/**
 * The organiser's Christmas food page: save one guest's line, send a guest their own link, or email
 * the organiser a copy. JSON in and out, called by the line component on `/g/<token>/table-manage`.
 *
 * The manage link is the organiser's key to the whole booking, so any seat on it may be saved here,
 * but only on that booking: the seat is found by number on the booking the link resolves to, and a
 * seat id from the page that no longer matches is refused rather than guessed at. Choices close at
 * the cutoff (D8); only staff can change them after that, from the management app.
 */

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), seat: FoodSeatPayloadSchema }),
  z.object({
    action: z.literal('invite'),
    ordinal: z.number().int().min(1).max(60),
    coverId: z.string().uuid().nullable().optional(),
    email: z.string().max(400),
  }),
  z.object({ action: z.literal('copy') }),
])

const GENERIC_ERROR = `Something went wrong. Please try again, or call us on ${GUEST_CONTACT.phoneDisplay}.`
const STALE_ERROR = 'Your guest list changed while this page was open. Refresh the page and try again.'

function reply(body: FoodActionResult | { success: true; message: string }, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function fail(error: string, status: number) {
  return reply({ success: false, error }, status)
}

async function loadOrganiserOrder(
  supabase: ReturnType<typeof createAdminClient>,
  token: string,
): Promise<{ order: PreorderOrder } | { error: string; status: number }> {
  const preview = await getTableManagePreviewByRawToken(supabase, token)
  if (preview.state !== 'ready' || !preview.table_booking_id) {
    return {
      error:
        preview.reason === 'expired_token'
          ? `This link has expired. Call us on ${GUEST_CONTACT.phoneDisplay} and we'll help.`
          : `This link isn't valid. Call us on ${GUEST_CONTACT.phoneDisplay} and we'll help.`,
      status: 403,
    }
  }
  if (preview.status === 'cancelled' || preview.status === 'no_show') {
    return { error: `This booking is no longer active. Call us on ${GUEST_CONTACT.phoneDisplay} if that's wrong.`, status: 409 }
  }
  if (!(await isPreorderEnabled(supabase))) {
    return { error: `Food choices aren't open online just now. Call us on ${GUEST_CONTACT.phoneDisplay} and we'll take them.`, status: 409 }
  }

  // Seats first, so a party that grew since the page loaded has a seat for everyone.
  await syncPreorderCovers(supabase, preview.table_booking_id)
  const order = await loadPreorderOrder(supabase, preview.table_booking_id)
  if (!order || !order.hasGuestSeats || !order.courseCounts) {
    return { error: GENERIC_ERROR, status: 409 }
  }
  return { order }
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return fail(GENERIC_ERROR, 400)
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return fail(GENERIC_ERROR, 400)
  const body = parsed.data

  // Saving line by line is normal, so saves get a generous budget of their own. Emails get a small
  // one, so a link cannot be used to send a stranger a stream of messages.
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: body.action === 'save' ? 'guest_table_manage_food_save' : 'guest_table_manage_food_email',
    maxAttempts: body.action === 'save' ? 60 : 8,
  })
  if (!throttle.allowed) {
    return fail('Too many attempts in a short time. Please wait a few minutes and try again.', 429)
  }

  const supabase = createAdminClient()

  try {
    const loaded = await loadOrganiserOrder(supabase, token)
    if ('error' in loaded) return fail(loaded.error, loaded.status)
    const { order } = loaded

    if (body.action === 'copy') {
      const sent = await sendFoodChoicesCopy(supabase, { order })
      return sent.ok ? reply({ success: true, message: "Done. We've emailed you a copy." }) : fail(sent.error, 502)
    }

    const cutoff = resolvePreorderCutoff(order.bookingDate, order.preorderCutoffDays)
    if (!cutoff.editable) return fail(preorderClosedMessage(cutoff.at), 409)

    const ordinal = body.action === 'save' ? body.seat.ordinal : body.ordinal
    const expectedCoverId = body.action === 'save' ? body.seat.coverId : body.coverId
    const cover = order.covers.find((entry) => entry.ordinal === ordinal)
    if (!cover || ordinal > order.partySize) return fail(STALE_ERROR, 409)
    if (expectedCoverId && expectedCoverId !== cover.id) return fail(STALE_ERROR, 409)

    if (body.action === 'invite') {
      const ledger = await loadFoodInviteLedger(supabase, order.tableBookingId)
      const sent = await sendFoodGuestInvite(supabase, { order, cover, email: body.email, ledger })
      if (!sent.ok) return fail(sent.error, 422)
      const [after, afterLedger] = await Promise.all([
        loadPreorderOrder(supabase, order.tableBookingId),
        loadFoodInviteLedger(supabase, order.tableBookingId),
      ])
      return reply({
        success: true,
        seat: buildFoodSeatView(after ?? order, ordinal, afterLedger),
        message: 'Link sent.',
      })
    }

    const outcome = await saveFoodSeat(supabase, {
      order,
      cover,
      payload: body.seat,
      actor: { savedBy: 'organiser' },
      source: 'organiser_food_page',
    })
    const [after, ledger] = await Promise.all([
      loadPreorderOrder(supabase, order.tableBookingId),
      loadFoodInviteLedger(supabase, order.tableBookingId),
    ])
    const seat = buildFoodSeatView(after ?? order, ordinal, ledger)
    if (outcome.state === 'failed') return reply({ success: false, error: outcome.error, seat }, 422)
    return reply({ success: true, seat })
  } catch (error) {
    logger.error('Christmas food page request failed unexpectedly', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { action: body.action },
    })
    return fail(GENERIC_ERROR, 500)
  }
}
