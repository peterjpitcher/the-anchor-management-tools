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
          left_at: input.nowIso,
          end_datetime: input.nowIso,
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
