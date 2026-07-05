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
 * the window maths lives in one place (the database). On infrastructure
 * errors we fail OPEN (return no conflicts) — we must never invent a
 * conflict and wrongly block a booking; the RPC failure is logged instead.
 */

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
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('get_private_booking_conflicts', {
      p_event_date: input.eventDate,
      p_start_time: input.startTime ?? null,
      p_end_time: input.endTime ?? null,
      p_setup_date: input.setupDate ?? null,
      p_setup_time: input.setupTime ?? null,
      p_cleardown_time: input.cleardownTime ?? null,
      p_space_ids: input.spaceIds,
      p_exclude_booking_id: input.excludeBookingId ?? null,
    })

    if (error) {
      logger.error('Private booking conflict check failed', {
        error: new Error(error.message),
        metadata: { eventDate: input.eventDate, spaceIds: input.spaceIds },
      })
      return []
    }

    return (data ?? []) as BookingConflict[]
  } catch (rpcError) {
    logger.error('Private booking conflict check threw', {
      error: rpcError instanceof Error ? rpcError : new Error(String(rpcError)),
      metadata: { eventDate: input.eventDate, spaceIds: input.spaceIds },
    })
    return []
  }
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

/** Space item ids currently attached to a booking (item_type 'space'). */
export async function getBookingSpaceIds(bookingId: string): Promise<string[]> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('private_booking_items')
      .select('space_id')
      .eq('booking_id', bookingId)
      .eq('item_type', 'space')
      .not('space_id', 'is', null)

    if (error) {
      logger.error('Failed to load booking space ids', {
        error: new Error(error.message),
        metadata: { bookingId },
      })
      return []
    }

    const ids = (data ?? [])
      .map((row: { space_id: string | null }) => row.space_id)
      .filter((id): id is string => Boolean(id))
    return Array.from(new Set(ids))
  } catch (queryError) {
    logger.error('Failed to load booking space ids', {
      error: queryError instanceof Error ? queryError : new Error(String(queryError)),
      metadata: { bookingId },
    })
    return []
  }
}

/** Conflicts for an existing booking, based on its stored dates, times and spaces. */
export async function getBookingConflictSummary(bookingId: string): Promise<BookingConflict[]> {
  try {
    const admin = createAdminClient()
    const { data: booking, error } = await admin
      .from('private_bookings')
      .select('event_date, start_time, end_time, setup_date, setup_time, cleardown_time')
      .eq('id', bookingId)
      .single()

    if (error || !booking?.event_date) {
      if (error) {
        logger.error('Failed to load booking for conflict summary', {
          error: new Error(error.message),
          metadata: { bookingId },
        })
      }
      return []
    }

    const spaceIds = await getBookingSpaceIds(bookingId)

    return findBookingConflicts({
      eventDate: booking.event_date as string,
      startTime: booking.start_time as string | null,
      endTime: booking.end_time as string | null,
      setupDate: booking.setup_date as string | null,
      setupTime: booking.setup_time as string | null,
      cleardownTime: booking.cleardown_time as string | null,
      spaceIds,
      excludeBookingId: bookingId,
    })
  } catch (summaryError) {
    logger.error('Booking conflict summary failed', {
      error: summaryError instanceof Error ? summaryError : new Error(String(summaryError)),
      metadata: { bookingId },
    })
    return []
  }
}
