import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'
import {
  getTableManagePreviewByRawToken,
  updateTableBookingByRawToken
} from '@/lib/table-bookings/manage-booking'
import {
  CANCELLATION_DETAIL_MAX_LENGTH,
  isCancellationReasonCode
} from '@/lib/table-bookings/cancellation-reasons'
import {
  getCoverAddons,
  loadPreorderOrder,
  savePreorderCover,
  syncPreorderCovers,
  type PreorderSelectionInput,
  type SavePreorderCoverInput
} from '@/lib/table-bookings/preorder'
import { PREORDER_COURSES } from '@/types/preorders'
import { resolvePreorderCutoff } from '../preorder-data'

const ActionSchema = z.object({
  action: z.enum(['update', 'cancel']),
  party_size: z
    .preprocess((value) => {
      if (value == null) return undefined
      if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed.length > 0 ? Number.parseInt(trimmed, 10) : undefined
      }
      return value
    }, z.number().int().min(1).max(20).optional()),
  notes: z.preprocess(
    (value) => (typeof value === 'string' ? value : undefined),
    z.string().max(500).optional()
  ),
  // Both optional, always. A guest who will not say why must still be able to cancel, so an
  // unrecognised or absent reason is dropped silently rather than failing validation and
  // blocking the cancellation.
  cancellation_reason: z.preprocess(
    (value) => (isCancellationReasonCode(value) ? value : undefined),
    z.string().optional()
  ),
  cancellation_reason_detail: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length > 0 ? value : undefined),
    z.string().max(CANCELLATION_DETAIL_MAX_LENGTH).optional()
  )
})

type ParsedAction = z.infer<typeof ActionSchema>

function redirectWithStatus(request: NextRequest, token: string, status: string) {
  return NextResponse.redirect(new URL(`/g/${token}/table-manage?status=${encodeURIComponent(status)}`, request.url), 303)
}

function redirectWithPreorderStatus(
  request: NextRequest,
  token: string,
  preorder: 'saved' | 'seats_removed' | 'error' | 'rate_limited',
  seat?: number
) {
  const query = new URLSearchParams({ preorder })
  if (seat) query.set('seat', String(seat))
  return NextResponse.redirect(
    new URL(`/g/${token}/table-manage?${query.toString()}`, request.url),
    303
  )
}

/**
 * Bring the pre-order seats back in line after the booker has changed party size.
 *
 * The booking update has already committed by the time this runs, so a failure here is logged and
 * swallowed: telling a guest their amendment failed when it did not would be the worse lie. The
 * nightly drift check is the backstop. Harmless on ordinary bookings, which have no covers to sync.
 */
async function syncCoversAfterPartySizeChange(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string | null | undefined
): Promise<{ removed: number }> {
  if (!bookingId) return { removed: 0 }

  try {
    const result = await syncPreorderCovers(supabase, bookingId)
    return { removed: result.removed.length }
  } catch (error) {
    logger.warn('Could not sync pre-order seats after a guest party-size change', {
      metadata: {
        tableBookingId: bookingId,
        error: error instanceof Error ? error.message : String(error)
      }
    })
    return { removed: 0 }
  }
}

async function runGuestTableManageAction(request: NextRequest, token: string, payload: ParsedAction) {
  const supabase = createAdminClient()

  try {
    const result = await updateTableBookingByRawToken(supabase, {
      rawToken: token,
      action: payload.action,
      newPartySize: payload.party_size,
      notes: payload.notes,
      cancellationReason: payload.cancellation_reason,
      cancellationReasonDetail: payload.cancellation_reason_detail,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    })

    if (result.state === 'blocked') {
      logger.warn('Guest table-manage action blocked', {
        metadata: {
          reason: result.reason || 'unknown',
          action: payload.action,
          tableBookingId: result.table_booking_id || null
        }
      })
      return redirectWithStatus(request, token, 'error')
    }

    if (result.state === 'cancelled') {
      if (result.charge_request_id) {
        return redirectWithStatus(request, token, 'late_cancel_charge_requested')
      }
      return redirectWithStatus(request, token, 'cancelled')
    }

    const sync = await syncCoversAfterPartySizeChange(supabase, result.table_booking_id)

    if (result.charge_request_id) {
      return redirectWithStatus(request, token, 'charge_requested')
    }

    if (sync.removed > 0) {
      return redirectWithPreorderStatus(request, token, 'seats_removed')
    }

    return redirectWithStatus(request, token, 'updated')
  } catch (error) {
    logger.warn('Guest table-manage action failed unexpectedly', {
      metadata: {
        action: payload.action,
        error: error instanceof Error ? error.message : String(error)
      }
    })
    return redirectWithStatus(request, token, 'error')
  }
}

/** A seat's course field carries a menu item id, or an empty string meaning "not having one". */
const MenuItemIdSchema = z.union([z.literal(''), z.string().uuid()])

/** A ticked add-on box always carries an id. There is no "none" value: an unticked box sends nothing. */
const AddonMenuItemIdSchema = z.string().uuid()

const SEAT_NAME_MAX_LENGTH = 100
const SEAT_NOTE_MAX_LENGTH = 200

function normaliseSeatText(value: string, maxLength: number): string | null {
  const trimmed = value.trim().slice(0, maxLength)
  return trimmed === '' ? null : trimmed
}

/**
 * Save the booker's food choices, one seat at a time through the shared write path.
 *
 * Seats the guest did not change are skipped rather than rewritten, which keeps a party of twenty
 * to a handful of queries and stops `updated_at` churning on rows nobody touched. Add-ons are read
 * as a whole set per seat rather than as a patch, for the reason spelled out where they are parsed.
 *
 * On a failure the earlier seats stay saved and the guest is sent back with that seat flagged. A
 * half-filled pre-order is a valid state by design, so a partial save is not a broken one.
 */
async function runGuestPreorderSave(request: NextRequest, token: string, formData: FormData) {
  const supabase = createAdminClient()

  try {
    const preview = await getTableManagePreviewByRawToken(supabase, token)
    if (
      preview.state !== 'ready' ||
      !preview.table_booking_id ||
      preview.status === 'cancelled' ||
      preview.status === 'no_show'
    ) {
      return redirectWithPreorderStatus(request, token, 'error')
    }

    // Seats first. If the party size moved since the page was rendered, the save must land on the
    // seats that now exist rather than on stale ids.
    await syncPreorderCovers(supabase, preview.table_booking_id)

    const order = await loadPreorderOrder(supabase, preview.table_booking_id)
    if (!order || !order.requiresPreorder) {
      return redirectWithPreorderStatus(request, token, 'error')
    }

    const cutoff = resolvePreorderCutoff(order.bookingDate, order.preorderCutoffDays)
    if (!cutoff.editable) {
      return redirectWithPreorderStatus(request, token, 'error')
    }

    const coversByOrdinal = new Map(order.covers.map((cover) => [cover.ordinal, cover]))
    let sawAnySeatField = false

    for (let ordinal = 1; ordinal <= order.partySize; ordinal += 1) {
      const cover = coversByOrdinal.get(ordinal)
      // A seat the sync could not create. The nightly drift check reports it; refusing the whole
      // save because of it would lose the choices the guest did make.
      if (!cover) continue

      const input: SavePreorderCoverInput = { coverId: cover.id }
      let changed = false

      const nameField = formData.get(`seat_${ordinal}_name`)
      if (typeof nameField === 'string') {
        sawAnySeatField = true
        const guestName = normaliseSeatText(nameField, SEAT_NAME_MAX_LENGTH)
        if (guestName !== cover.guestName) {
          input.guestName = guestName
          changed = true
        }
      }

      const noteField = formData.get(`seat_${ordinal}_note`)
      if (typeof noteField === 'string') {
        sawAnySeatField = true
        const dietaryNote = normaliseSeatText(noteField, SEAT_NOTE_MAX_LENGTH)
        if (dietaryNote !== cover.dietaryNote) {
          input.dietaryNote = dietaryNote
          changed = true
        }
      }

      const selections: PreorderSelectionInput[] = []
      for (const course of PREORDER_COURSES) {
        const courseField = formData.get(`seat_${ordinal}_${course}`)
        if (typeof courseField !== 'string') continue
        sawAnySeatField = true

        const parsed = MenuItemIdSchema.safeParse(courseField.trim())
        if (!parsed.success) {
          return redirectWithPreorderStatus(request, token, 'error', ordinal)
        }

        const menuItemId = parsed.data === '' ? null : parsed.data
        const current = cover.selections.find((selection) => selection.course === course) ?? null
        if (menuItemId !== (current?.menuItemId ?? null)) {
          selections.push({ course, menuItemId })
          changed = true
        }
      }

      if (selections.length > 0) input.selections = selections

      // Add-ons are tick-boxes, and an unticked box sends nothing at all, so "the guest has just
      // cleared every add-on" and "this form had no add-on block on it" arrive looking identical.
      // The hidden marker the form renders next to the boxes is what separates them. Without it the
      // only safe reading is "leave add-ons alone", and a guest could add an extra but never remove
      // one, which is how somebody ends up charged on the night for something they took off.
      const addonMarker = formData.get(`seat_${ordinal}_addons_present`)
      if (typeof addonMarker === 'string') {
        sawAnySeatField = true

        const ticked: string[] = []
        for (const rawValue of formData.getAll(`seat_${ordinal}_addon`)) {
          if (typeof rawValue !== 'string') continue
          const parsed = AddonMenuItemIdSchema.safeParse(rawValue.trim())
          if (!parsed.success) {
            return redirectWithPreorderStatus(request, token, 'error', ordinal)
          }
          ticked.push(parsed.data)
        }

        // Whole-set, not a patch: this is exactly what the seat wants, and anything absent is
        // unticked. Compared against the LIVE add-ons only, because a withdrawn one has no tick-box
        // to come back in and would otherwise make every save look like a change.
        const wanted = Array.from(new Set(ticked)).sort()
        const current = getCoverAddons(cover)
          .filter((addon) => !addon.itemWithdrawn)
          .map((addon) => addon.menuItemId)
          .sort()

        if (wanted.length !== current.length || wanted.some((id, index) => id !== current[index])) {
          input.addonMenuItemIds = wanted
          changed = true
        }
      }

      if (!changed) continue

      try {
        await savePreorderCover(supabase, input)
      } catch (error) {
        // Never log the seat's dietary note or name: this field is staff-and-kitchen only.
        logger.warn('Guest pre-order seat could not be saved', {
          metadata: {
            tableBookingId: order.tableBookingId,
            ordinal,
            error: error instanceof Error ? error.message : String(error)
          }
        })
        return redirectWithPreorderStatus(request, token, 'error', ordinal)
      }
    }

    if (!sawAnySeatField) {
      return redirectWithPreorderStatus(request, token, 'error')
    }

    return redirectWithPreorderStatus(request, token, 'saved')
  } catch (error) {
    logger.warn('Guest pre-order save failed unexpectedly', {
      metadata: {
        error: error instanceof Error ? error.message : String(error)
      }
    })
    return redirectWithPreorderStatus(request, token, 'error')
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_table_manage_action',
    maxAttempts: 12
  })

  if (!throttle.allowed) {
    return redirectWithStatus(request, token, 'rate_limited')
  }

  const action = request.nextUrl.searchParams.get('action')
  const confirm = request.nextUrl.searchParams.get('confirm')

  if (action !== 'cancel' || confirm !== '1') {
    logger.warn('Guest table-manage GET action rejected', {
      metadata: {
        action,
        hasConfirm: Boolean(confirm)
      }
    })
    return redirectWithStatus(request, token, 'error')
  }

  // The "cancel without giving a reason" fallback, and the path sandboxed frames take when
  // they cannot submit a form. No reason is recorded, by design.
  return runGuestTableManageAction(request, token, {
    action: 'cancel',
    party_size: undefined,
    notes: undefined,
    cancellation_reason: undefined,
    cancellation_reason_detail: undefined
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const formData = await request.formData()

  // Food choices get their own budget. Saving a form of six seats is a normal thing to do several
  // times over, and it must not eat the allowance a guest needs to cancel.
  const isPreorder = formData.get('action') === 'preorder'

  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: isPreorder ? 'guest_table_manage_preorder' : 'guest_table_manage_action',
    maxAttempts: isPreorder ? 20 : 12
  })

  if (!throttle.allowed) {
    return isPreorder
      ? redirectWithPreorderStatus(request, token, 'rate_limited')
      : redirectWithStatus(request, token, 'rate_limited')
  }

  if (isPreorder) {
    return runGuestPreorderSave(request, token, formData)
  }

  const parsed = ActionSchema.safeParse({
    action: formData.get('action'),
    party_size: formData.get('party_size'),
    notes: formData.get('notes'),
    cancellation_reason: formData.get('cancellation_reason'),
    cancellation_reason_detail: formData.get('cancellation_reason_detail')
  })

  if (!parsed.success) {
    logger.warn('Guest table-manage action form validation failed', {
      metadata: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code
        })),
        action: formData.get('action'),
        hasPartySize: formData.has('party_size'),
        hasNotes: formData.has('notes')
      }
    })
    return redirectWithStatus(request, token, 'error')
  }

  return runGuestTableManageAction(request, token, parsed.data)
}
