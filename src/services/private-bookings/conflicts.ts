import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * Conflict prevention + capacity rules (SOP pack §6):
 * - Holds and confirmed bookings block their spaces (including setup and
 *   clear-down windows) against other bookings.
 * - Whole-venue spaces (blocks_all_spaces) conflict with every other space.
 * - Guest counts are checked against the correct capacity for the booked
 *   layout (seated / standing / mixed).
 *
 * Conflict detection delegates to the get_private_booking_conflicts RPC so
 * the window maths lives in one place (the database: private_booking_occupied_window).
 *
 * A check that could not run fails CLOSED (review BK-070, 24 October 2026). It
 * used to return "no clashes" on any error, so a hire could be saved over
 * another one whenever the diary read failed. Staff saves now refuse with
 * DIARY_CHECK_FAILED_MESSAGE; the deposit path catches the error, records the
 * money and leaves the booking a draft.
 */

export const DIARY_CHECK_FAILED_MESSAGE =
  'Could not check the diary for other private hires in these rooms, so nothing was saved. Please try again.'

function diaryCheckFailed(cause: unknown, metadata: Record<string, unknown>): Error {
  logger.error('Private booking conflict check failed', {
    error: cause instanceof Error ? cause : new Error(String(cause)),
    metadata,
  })
  return new Error(DIARY_CHECK_FAILED_MESSAGE)
}

export type BookingConflict = {
  booking_id: string
  customer_name: string | null
  booking_status: string
  space_name: string
  blocks_all: boolean
  occupies_from: string
  occupies_until: string
}

export async function findBookingConflicts(input: {
  eventDate: string
  startTime?: string | null
  endTime?: string | null
  setupDate?: string | null
  setupTime?: string | null
  cleardownTime?: string | null
  spaceIds: string[]
  excludeBookingId?: string | null
}): Promise<BookingConflict[]> {
  const metadata = { eventDate: input.eventDate, spaceIds: input.spaceIds }
  let result: { data: unknown; error: { message: string } | null }
  try {
    const admin = createAdminClient()
    result = await admin.rpc('get_private_booking_conflicts', {
      p_event_date: input.eventDate,
      p_start_time: input.startTime ?? null,
      p_end_time: input.endTime ?? null,
      p_setup_date: input.setupDate ?? null,
      p_setup_time: input.setupTime ?? null,
      p_cleardown_time: input.cleardownTime ?? null,
      p_space_ids: input.spaceIds,
      p_exclude_booking_id: input.excludeBookingId ?? null,
    })
  } catch (rpcError) {
    throw diaryCheckFailed(rpcError, metadata)
  }

  if (result.error) {
    throw diaryCheckFailed(new Error(result.error.message), metadata)
  }

  return (result.data ?? []) as BookingConflict[]
}

export type CapacityCheckResult = { ok: boolean; reason?: string; capacity?: number }

/**
 * Pure capacity check (SOP §6): compare the expected guest count against the
 * correct capacity for the booked space(s) and layout.
 * - 'seated' uses the seated capacity, 'standing' and 'mixed' use the
 *   standing capacity, and a missing layout uses max(seated, standing).
 * - Spaces with missing or zero capacity data are treated as unknown and
 *   skipped; when EVERY selected space lacks capacity data the check passes
 *   with reason 'capacity data missing' (we cannot enforce what we do not
 *   know — settings data should be fixed instead).
 */
export function checkCapacity(input: {
  spaces: Array<{ name: string; capacity_seated?: number | null; capacity_standing?: number | null }>
  guestCount?: number | null
  layout?: 'seated' | 'standing' | 'mixed' | null
}): CapacityCheckResult {
  const { spaces, guestCount, layout } = input

  const capacityFor = (space: {
    capacity_seated?: number | null
    capacity_standing?: number | null
  }): number | null => {
    const seated = space.capacity_seated ?? null
    const standing = space.capacity_standing ?? null
    let value: number | null
    if (layout === 'seated') {
      value = seated
    } else if (layout === 'standing' || layout === 'mixed') {
      value = standing
    } else {
      value = Math.max(seated ?? 0, standing ?? 0)
    }
    return value !== null && value > 0 ? value : null
  }

  const assessed = spaces.map((space) => ({ name: space.name, capacity: capacityFor(space) }))
  const known = assessed.filter((space) => space.capacity !== null)
  const skipped = assessed.filter((space) => space.capacity === null)

  if (known.length === 0) {
    return { ok: true, reason: 'capacity data missing' }
  }

  const capacity = known.reduce((sum, space) => sum + (space.capacity as number), 0)

  if (guestCount === null || guestCount === undefined || guestCount <= 0) {
    return { ok: true, capacity }
  }

  if (guestCount > capacity) {
    const layoutLabel =
      layout === 'seated' ? 'seated' : layout === 'standing' ? 'standing' : layout === 'mixed' ? 'standing (mixed)' : 'maximum'
    const spaceNames = known.map((space) => space.name).join(', ')
    const skippedNote =
      skipped.length > 0
        ? ` (${skipped.length} selected space${skipped.length === 1 ? '' : 's'} without capacity data excluded)`
        : ''
    return {
      ok: false,
      capacity,
      reason: `Guest count ${guestCount} exceeds the ${layoutLabel} capacity of ${capacity} for ${spaceNames}${skippedNote}`,
    }
  }

  return { ok: true, capacity }
}

/**
 * Space item ids currently attached to a booking (item_type 'space'). Throws when they cannot be
 * read: an empty list would skip the clash check as if the booking had no rooms (BK-070).
 */
export async function getBookingSpaceIds(bookingId: string): Promise<string[]> {
  let result: { data: unknown; error: { message: string } | null }
  try {
    const admin = createAdminClient()
    result = await admin
      .from('private_booking_items')
      .select('space_id')
      .eq('booking_id', bookingId)
      .eq('item_type', 'space')
      .not('space_id', 'is', null)
  } catch (queryError) {
    throw diaryCheckFailed(queryError, { bookingId, step: 'load booked rooms' })
  }

  if (result.error) {
    throw diaryCheckFailed(new Error(result.error.message), { bookingId, step: 'load booked rooms' })
  }

  const ids = ((result.data ?? []) as Array<{ space_id: string | null }>)
    .map((row) => row.space_id)
    .filter((id): id is string => Boolean(id))
  return Array.from(new Set(ids))
}

/**
 * Conflicts for an existing booking, based on its stored dates, times and spaces. Throws when the
 * check cannot run, so the deposit path keeps the booking a draft rather than confirming it blind.
 */
export async function getBookingConflictSummary(bookingId: string): Promise<BookingConflict[]> {
  let result: { data: unknown; error: { message: string } | null }
  try {
    const admin = createAdminClient()
    result = await admin
      .from('private_bookings')
      .select('event_date, start_time, end_time, setup_date, setup_time, cleardown_time, date_tbd')
      .eq('id', bookingId)
      .single()
  } catch (loadError) {
    throw diaryCheckFailed(loadError, { bookingId, step: 'load booking' })
  }

  if (result.error) {
    throw diaryCheckFailed(new Error(result.error.message), { bookingId, step: 'load booking' })
  }

  const booking = result.data as {
    event_date: string | null
    start_time: string | null
    end_time: string | null
    setup_date: string | null
    setup_time: string | null
    cleardown_time: string | null
    date_tbd: boolean | null
  } | null
  // An undated hire holds no room, so nothing can clash with it.
  if (!booking?.event_date || booking.date_tbd) return []

  const spaceIds = await getBookingSpaceIds(bookingId)

  return findBookingConflicts({
    eventDate: booking.event_date,
    startTime: booking.start_time,
    endTime: booking.end_time,
    setupDate: booking.setup_date,
    setupTime: booking.setup_time,
    cleardownTime: booking.cleardown_time,
    spaceIds,
    excludeBookingId: bookingId,
  })
}
