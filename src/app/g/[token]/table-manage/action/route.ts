import { NextRequest, NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/env'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'
import { hashGuestToken } from '@/lib/guest/tokens'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
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
  PreorderCourseLimitError,
  savePreorderCover,
  syncPreorderCovers,
  type PreorderSelectionInput,
  type SavePreorderCoverInput
} from '@/lib/table-bookings/preorder'
import { PREORDER_COURSES } from '@/types/preorders'
import { changeChristmasPartyByRawToken } from '@/lib/table-bookings/guest-christmas-party'
import { CHRISTMAS_MAX_PARTY_SIZE } from '@/lib/table-bookings/christmas'
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
  seat?: number,
  reason?: 'courses'
) {
  const query = new URLSearchParams({ preorder })
  if (seat) query.set('seat', String(seat))
  if (seat && reason) query.set('reason', reason)
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
    logger.error('Could not sync pre-order seats after a guest party-size change', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: bookingId }
    })
    return { removed: 0 }
  }
}

/**
 * The banner a refused change lands on. Each says what to do next, with the phone number where a
 * person has to help, instead of "please try again" for a change that can never work (BK-053).
 */
function blockedStatus(reason: string | undefined): string {
  switch (reason) {
    case 'no_table':
      return 'no_table'
    case 'slot_full':
      return 'slot_full'
    case 'too_large_party':
      return 'too_large'
    case 'christmas_closed':
      return 'christmas_closed'
    case 'christmas_size':
      return 'christmas_size'
    case 'christmas_no_change':
      return 'christmas_no_change'
    case 'christmas_changed':
      return 'christmas_changed'
    case 'christmas_call_us':
      return 'christmas_call'
    case 'rate_limited':
      return 'rate_limited'
    default:
      return 'error'
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
      appBaseUrl: getAppUrl()
    })

    if (result.state === 'blocked') {
      logger.warn('Guest table-manage action blocked', {
        metadata: {
          reason: result.reason || 'unknown',
          action: payload.action,
          tableBookingId: result.table_booking_id || null
        }
      })
      // A bigger party that cannot be seated is told why, with the number to ring (BK-040, BK-091),
      // rather than "we could not process that request", which reads as a fault on our side.
      return redirectWithStatus(request, token, blockedStatus(result.reason))
    }

    if (result.state === 'cancelled') {
      return redirectWithStatus(request, token, 'cancelled')
    }

    const sync = await syncCoversAfterPartySizeChange(supabase, result.table_booking_id)

    // The bigger party now owes a deposit and the booking stays confirmed (D20, BK-044). Take the
    // guest straight to the payment page, which shows the amount, rather than a bare "Booking
    // updated" with no link. The same link is in the email.
    if (result.deposit_payment_url) {
      return NextResponse.redirect(result.deposit_payment_url, 303)
    }

    if (sync.removed > 0) {
      return redirectWithPreorderStatus(request, token, 'seats_removed')
    }

    return redirectWithStatus(request, token, 'updated')
  } catch (error) {
    // An error, not a warning: warnings are silent in production, and this is a guest whose change
    // did not save (BK-053).
    logger.error('Guest table-manage action failed unexpectedly', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { action: payload.action }
    })
    // A cancellation that crashed leaves the table booked, and nobody at the pub knows the guest
    // is not coming (BK-115). The guest sees the error banner with the pub's number; the manager
    // is told too. The booking is not known here, only the link, so the alert names the link's
    // hash (never the link itself, which is the guest's key).
    await alertMoneyNeedsAPerson(supabase, {
      domain: 'table_bookings',
      bookingId: hashGuestToken(token),
      kind: `guest_manage_${payload.action}_failed`,
      subjectTag: 'BOOKING ACTION NEEDED',
      path: '/table-bookings',
      title: payload.action === 'cancel'
        ? 'A guest tried to cancel a table booking online and it failed'
        : 'A guest tried to change a table booking online and it failed',
      summary: payload.action === 'cancel'
        ? 'A guest used their manage link to cancel, but the cancellation did not save, so the booking still holds its table. The guest was shown an error with the pub phone number. Check the log for this time, find the booking and cancel it if the guest calls or does not arrive.'
        : 'A guest used their manage link to change their booking, but the change did not save. The guest was shown an error with the pub phone number. Check the log for this time and the booking if the guest calls.',
      context: {
        Action: payload.action,
        'Link hash': hashGuestToken(token),
        Error: error instanceof Error ? error.message : String(error),
      },
    })
    return redirectWithStatus(request, token, 'error')
  }
}

/** A "how many join on this tier" box: blank is none, anything else a whole number in range. */
function readJoinCount(formData: FormData, name: string): number | null {
  const raw = formData.get(name)
  if (raw == null) return 0
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  if (!/^\d{1,2}$/.test(trimmed)) return null
  const value = Number.parseInt(trimmed, 10)
  return value <= CHRISTMAS_MAX_PARTY_SIZE ? value : null
}

/**
 * The Christmas numbers form (BK-053, D21): who is not coming, by seat, and how many join on each
 * tier. The change itself, and every rule it must pass, lives in guest-christmas-party.ts.
 */
async function runGuestChristmasPartyChange(request: NextRequest, token: string, formData: FormData) {
  const supabase = createAdminClient()

  const removedSeats: number[] = []
  for (const value of formData.getAll('remove_seat')) {
    if (typeof value !== 'string' || !/^\d{1,2}$/.test(value.trim())) {
      return redirectWithStatus(request, token, 'error')
    }
    removedSeats.push(Number.parseInt(value.trim(), 10))
  }
  // The course list the page showed, so a change from a page left open after the numbers changed is
  // refused rather than removing whoever now holds that seat number.
  const expectedRaw = formData.get('expected_courses')
  let expectedCourses: number[] | undefined
  if (typeof expectedRaw === 'string' && expectedRaw.trim() !== '') {
    if (!/^[1-3](,[1-3]){0,19}$/.test(expectedRaw.trim())) return redirectWithStatus(request, token, 'error')
    expectedCourses = expectedRaw.trim().split(',').map((value) => Number.parseInt(value, 10))
  }
  const oneCourse = readJoinCount(formData, 'add_1')
  const twoCourses = readJoinCount(formData, 'add_2')
  const threeCourses = readJoinCount(formData, 'add_3')
  if (oneCourse === null || twoCourses === null || threeCourses === null) {
    return redirectWithStatus(request, token, 'christmas_size')
  }

  try {
    const result = await changeChristmasPartyByRawToken(supabase, {
      rawToken: token,
      removedSeats,
      expectedCourses,
      added: { oneCourse, twoCourses, threeCourses },
      appBaseUrl: getAppUrl()
    })

    if (result.state === 'blocked') {
      logger.warn('Guest Christmas numbers change refused', {
        metadata: { reason: result.reason, tableBookingId: result.tableBookingId ?? null }
      })
      return redirectWithStatus(request, token, blockedStatus(result.reason))
    }

    // Seats for anyone joining. The leaving guests' seats were removed with the change itself.
    await syncCoversAfterPartySizeChange(supabase, result.tableBookingId)
    return redirectWithStatus(request, token, 'christmas_updated')
  } catch (error) {
    logger.error('Guest Christmas numbers change failed unexpectedly', {
      error: error instanceof Error ? error : new Error(String(error))
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
 * Record a guest's saved seats on the audit trail (BK-149), as staff saves already are, so an "I
 * ordered the beef" question can be traced. Seat numbers and dish ids only: never a name or a
 * dietary note. Never throws: the choices are already saved.
 */
async function auditGuestPreorderSave(input: {
  tableBookingId: string
  bookingReference: string
  seats: number[]
  dishIds: string[]
  failedSeat?: number
}): Promise<void> {
  if (input.seats.length === 0) return
  try {
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'table_booking_preorder',
      resource_id: input.tableBookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: input.bookingReference,
        seats_saved: input.seats,
        dish_ids: Array.from(new Set(input.dishIds)),
        source: 'guest_manage_page',
        ...(input.failedSeat ? { stopped_at_seat: input.failedSeat } : {}),
      },
    })
  } catch (error) {
    logger.error('Could not audit a guest pre-order save', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        tableBookingId: input.tableBookingId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
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
    // Names and dietary notes save on every Christmas seat, 1 course included (BK-148).
    if (!order || !order.hasGuestSeats) {
      return redirectWithPreorderStatus(request, token, 'error')
    }

    const cutoff = resolvePreorderCutoff(order.bookingDate, order.preorderCutoffDays)
    if (!cutoff.editable) {
      return redirectWithPreorderStatus(request, token, 'error')
    }

    const coversByOrdinal = new Map(order.covers.map((cover) => [cover.ordinal, cover]))
    let sawAnySeatField = false
    const savedSeats: number[] = []
    const savedDishIds: string[] = []

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
        savedSeats.push(ordinal)
        for (const entry of input.selections ?? []) {
          if (entry.menuItemId) savedDishIds.push(entry.menuItemId)
        }
        savedDishIds.push(...(input.addonMenuItemIds ?? []))
      } catch (error) {
        // Never log the seat's dietary note or name: this field is staff-and-kitchen only. Too many
        // courses for the seat's tier is the guest's choice to fix (a warning); anything else is a
        // fault that loses their food choice (an error, BK-115).
        const logSeatFailure = error instanceof PreorderCourseLimitError ? logger.warn : logger.error
        logSeatFailure.call(logger, 'Guest pre-order seat could not be saved', {
          metadata: {
            tableBookingId: order.tableBookingId,
            ordinal,
            error: error instanceof Error ? error.message : String(error)
          }
        })
        await auditGuestPreorderSave({
          tableBookingId: order.tableBookingId,
          bookingReference: order.bookingReference,
          seats: savedSeats,
          dishIds: savedDishIds,
          failedSeat: ordinal
        })
        // A seat that chose more courses than its tier pays for is told so, rather than being told
        // the dish may have come off the menu.
        return redirectWithPreorderStatus(
          request,
          token,
          'error',
          ordinal,
          error instanceof PreorderCourseLimitError ? 'courses' : undefined
        )
      }
    }

    if (!sawAnySeatField) {
      return redirectWithPreorderStatus(request, token, 'error')
    }

    await auditGuestPreorderSave({
      tableBookingId: order.tableBookingId,
      bookingReference: order.bookingReference,
      seats: savedSeats,
      dishIds: savedDishIds
    })

    return redirectWithPreorderStatus(request, token, 'saved')
  } catch (error) {
    logger.error('Guest pre-order save failed unexpectedly', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        error: error instanceof Error ? error.message : String(error)
      }
    })
    return redirectWithPreorderStatus(request, token, 'error')
  }
}

/**
 * A GET never changes a booking (BK-109, customer bookings review of 24 October 2026).
 *
 * This used to cancel the table, and refund the deposit, for `?action=cancel&confirm=1`, so that
 * a plain link could cancel from a sandboxed frame that blocks forms. Anything that fetched the
 * address did the same: a link scanner, a browser extension, a preview. Cancelling is now a POST
 * only. An old link, or anyone who opens this address, is sent back to the manage page with the
 * cancel step open, where the guest confirms with a button.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const wantsCancel = request.nextUrl.searchParams.get('action') === 'cancel'
  const target = wantsCancel ? `/g/${token}/table-manage?confirmCancel=1` : `/g/${token}/table-manage`
  return NextResponse.redirect(new URL(target, request.url), 303)
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

  if (formData.get('action') === 'christmas_party') {
    return runGuestChristmasPartyChange(request, token, formData)
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
