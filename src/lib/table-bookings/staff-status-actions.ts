import { fromZonedTime } from 'date-fns-tz'

export type StaffStatusAction =
  | 'seated'
  | 'left'
  | 'no_show'
  | 'cancelled'
  | 'confirmed'
  | 'completed'

export type StaffStatusBooking = {
  status: string
  booking_date: string
  booking_time: string
  start_datetime: string | null
  /** The planned end. 'left' only ever brings it forward, never pushes it later (BK-093). */
  end_datetime?: string | null
}

/**
 * The end time to record when a party leaves: the click time, or the planned end if that is
 * earlier. Pressing 'left' late must not stretch the booking over the next party (BK-093).
 */
export function leftEndDatetime(plannedEndIso: string | null | undefined, nowIso: string): string {
  const plannedMs = plannedEndIso ? Date.parse(plannedEndIso) : Number.NaN
  const nowMs = Date.parse(nowIso)
  if (Number.isFinite(plannedMs) && plannedMs < nowMs) return new Date(plannedMs).toISOString()
  return nowIso
}

type AssignmentShortenClient = {
  from: (table: 'booking_table_assignments') => {
    update: (values: { end_datetime: string }) => {
      eq: (column: string, value: string) => {
        lt: (column: string, value: string) => {
          gt: (column: string, value: string) => PromiseLike<{ error: unknown }>
        }
      }
    }
  }
}

/**
 * Frees a leaving party's tables from now. Only assignments that started already and are planned
 * to end later are cut back to now; one that already ended earlier is left alone, so the update
 * can never overlap the next party or a private hire and be refused (BK-093).
 */
export async function shortenAssignmentsOnLeave(
  supabase: unknown,
  bookingId: string,
  nowIso: string,
): Promise<{ error: unknown }> {
  const client = supabase as AssignmentShortenClient
  return client.from('booking_table_assignments')
    .update({ end_datetime: nowIso })
    .eq('table_booking_id', bookingId)
    .lt('start_datetime', nowIso)
    .gt('end_datetime', nowIso)
}

type StaffStatusTransitionPlan = {
  update: Record<string, unknown>
  select: string
}

type StaffStatusTransitionResult =
  | { ok: true; plan: StaffStatusTransitionPlan }
  | { ok: false; status: 409; error: string }

const CLOSED_STATUSES = new Set(['cancelled', 'no_show', 'completed'])

function getBookingStartIso(booking: StaffStatusBooking): string | null {
  if (booking.start_datetime) {
    return booking.start_datetime
  }

  const local = `${booking.booking_date}T${booking.booking_time}`
  try {
    return fromZonedTime(local, 'Europe/London').toISOString()
  } catch {
    return null
  }
}

function blocks(action: string, booking: StaffStatusBooking): StaffStatusTransitionResult | null {
  /*
   * 'Mark Confirmed' never brings back a cancelled or completed booking (BK-048, customer bookings
   * review of 24 October 2026). One click used to turn a cancelled booking confirmed again with no
   * check that its table was still free, no new deposit after a refund, and nothing said to the
   * guest, who still believed it was cancelled. A no-show can still be put back, after the routes
   * check its table and deposit (reinstate-check.ts).
   */
  if (action === 'confirmed' && booking.status === 'cancelled') {
    return {
      ok: false,
      status: 409,
      error: 'A cancelled booking cannot be put back. Make a new booking, so the table and any deposit are checked again.',
    }
  }
  if (action === 'confirmed' && booking.status === 'completed') {
    return {
      ok: false,
      status: 409,
      error: 'A completed booking cannot be put back to confirmed.',
    }
  }

  if (action === 'completed') {
    if (booking.status === 'cancelled' || booking.status === 'no_show') {
      return {
        ok: false,
        status: 409,
        error: 'Cannot mark booking as completed from current status',
      }
    }
    return null
  }

  if (CLOSED_STATUSES.has(booking.status)) {
    // 'no_show' bookings can be re-seated — the seated handler resets status to 'confirmed'
    if (action === 'seated' && booking.status !== 'no_show') {
      return {
        ok: false,
        status: 409,
        error: 'Cannot mark booking as seated from current status',
      }
    }
    if (action === 'left') {
      return {
        ok: false,
        status: 409,
        error: 'Cannot mark booking as left from current status',
      }
    }
    if (action === 'cancelled') {
      return {
        ok: false,
        status: 409,
        error: 'Cannot cancel booking from current status',
      }
    }
    if (action === 'no_show') {
      return {
        ok: false,
        status: 409,
        error: 'Cannot mark booking as no-show from current status',
      }
    }
  }

  return null
}

/**
 * 'Arrived' for a booking from an earlier day that nobody marked on the night (BK-130). The
 * floor's 'seated' action stamps the time it is pressed, which the morning after would put the
 * party at its table hours after it left. This stamps the booking's own start and end instead,
 * and leaves the status alone, as 'seated' does.
 */
export function buildPastArrivalPlan(input: {
  booking: StaffStatusBooking & {
    seated_at: string | null
    left_at: string | null
    no_show_at: string | null
    end_datetime: string | null
  }
  tradingDayIso: string
  nowIso: string
}): StaffStatusTransitionResult {
  const { booking } = input
  if (booking.status !== 'confirmed') {
    return { ok: false, status: 409, error: 'Only a confirmed booking can be marked as arrived.' }
  }
  if (booking.seated_at || booking.left_at || booking.no_show_at) {
    return { ok: false, status: 409, error: 'This booking already has an outcome.' }
  }
  if (!(booking.booking_date < input.tradingDayIso)) {
    return { ok: false, status: 409, error: 'Mark today\'s bookings from the floor.' }
  }
  const startIso = getBookingStartIso(booking)
  if (!startIso) {
    return { ok: false, status: 409, error: 'This booking has no start time.' }
  }
  return {
    ok: true,
    plan: {
      update: {
        seated_at: startIso,
        left_at: booking.end_datetime ?? startIso,
        updated_at: input.nowIso,
      },
      select: 'id, status, seated_at, left_at, no_show_at',
    },
  }
}

export function buildStaffStatusTransitionPlan(input: {
  action: StaffStatusAction
  booking: StaffStatusBooking
  nowIso: string
  noShowMarkedBy?: string | null
  cancelledBy?: string
}): StaffStatusTransitionResult {
  const blocked = blocks(input.action, input.booking)
  if (blocked) {
    return blocked
  }

  if (input.action === 'seated') {
    // When re-seating a no-show booking, reset status to 'confirmed' so the
    // booking is no longer in CLOSED_STATUSES and further transitions are allowed.
    const statusAfterSeating =
      input.booking.status === 'no_show' ? 'confirmed' : input.booking.status
    return {
      ok: true,
      plan: {
        update: {
          seated_at: input.nowIso,
          left_at: null,
          no_show_at: null,
          no_show_marked_at: null,
          no_show_marked_by: null,
          updated_at: input.nowIso,
          status: statusAfterSeating,
        },
        select: 'id, status, seated_at, left_at, no_show_at, no_show_marked_at, no_show_marked_by',
      },
    }
  }

  if (input.action === 'left') {
    return {
      ok: true,
      plan: {
        update: {
          // left_at is the real click time; the end only ever moves earlier (BK-093).
          left_at: input.nowIso,
          end_datetime: leftEndDatetime(input.booking.end_datetime, input.nowIso),
          updated_at: input.nowIso,
        },
        select: 'id, status, left_at, end_datetime',
      },
    }
  }

  if (input.action === 'cancelled') {
    return {
      ok: true,
      plan: {
        update: {
          status: 'cancelled',
          cancelled_at: input.nowIso,
          cancelled_by: input.cancelledBy || 'staff',
          updated_at: input.nowIso,
        },
        select: 'id, status, cancelled_at, cancelled_by',
      },
    }
  }

  if (input.action === 'confirmed') {
    return {
      ok: true,
      plan: {
        update: {
          status: 'confirmed',
          seated_at: null,
          left_at: null,
          no_show_at: null,
          no_show_marked_at: null,
          no_show_marked_by: null,
          cancelled_at: null,
          cancelled_by: null,
          updated_at: input.nowIso,
        },
        select: 'id, status, seated_at, left_at, no_show_at, cancelled_at, cancelled_by',
      },
    }
  }

  if (input.action === 'completed') {
    return {
      ok: true,
      plan: {
        update: {
          status: 'completed',
          left_at: input.nowIso,
          updated_at: input.nowIso,
        },
        select: 'id, status, left_at',
      },
    }
  }

  const bookingStartIso = getBookingStartIso(input.booking)
  const bookingStartMs = bookingStartIso ? Date.parse(bookingStartIso) : Number.NaN

  if (!Number.isFinite(bookingStartMs) || bookingStartMs > Date.now()) {
    return {
      ok: false,
      status: 409,
      error: 'Booking cannot be marked no-show before start time',
    }
  }

  return {
    ok: true,
    plan: {
      update: {
        status: 'no_show',
        no_show_at: input.nowIso,
        no_show_marked_at: input.nowIso,
        no_show_marked_by: input.noShowMarkedBy || null,
        updated_at: input.nowIso,
      },
      select: 'id, status, no_show_at, no_show_marked_at, no_show_marked_by',
    },
  }
}

/**
 * The status buttons that apply to a booking as it stands (BK-048), so the booking page offers only
 * what the routes will take. Seating is a timestamp, not a status, so the seated and left times
 * decide Mark Left. The routes still check everything; this only decides what is shown.
 */
export function staffStatusActionsFor(booking: {
  status: string
  seated_at?: string | null
  left_at?: string | null
}): StaffStatusAction[] {
  const status = booking.status
  if (status === 'cancelled' || status === 'completed') return []
  if (status === 'no_show') return ['seated', 'confirmed']

  const actions: StaffStatusAction[] = []
  if (!booking.seated_at) actions.push('seated')
  if (booking.seated_at && !booking.left_at) actions.push('left')
  if (status === 'pending_payment') actions.push('confirmed')
  actions.push('completed')
  return actions
}
