import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fromZonedTime } from 'date-fns-tz'
import { requireFohPermission, getLondonDateIso } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'
import { isAssignmentConflictError } from '@/lib/table-bookings/move-table'
import { sendTableBookingRescheduledNotificationIfAllowed } from '@/lib/table-bookings/bookings'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TimeSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM format'),
})

/**
 * Statuses a staff member may re-time from the floor.
 *
 * A blacklist was the first instinct, but it fails open: a status added later would silently
 * become editable. Anything not named here is refused.
 */
const EDITABLE_STATUSES = new Set([
  'confirmed',
  'pending_payment',
  'pending_card_capture',
  'visited_waiting_for_review',
  'review_clicked',
])

type BookingRow = {
  id: string
  status: string | null
  booking_time: string | null
  booking_date: string | null
  start_datetime: string | null
  end_datetime: string | null
  duration_minutes: number | null
  seated_at: string | null
  left_at: string | null
  event_id: string | null
  high_chair_count: number | null
}

function londonClock(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00'
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  return `${hour}:${minute}`
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) return auth.response

  const { id: bookingId } = await context.params
  if (!UUID_REGEX.test(bookingId)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = TimeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid time',
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const { time: newTime } = parsed.data

  try {
    // Step 1: the booking row is the authority on the GUEST window and on whether this booking
    // may be re-timed at all. The UI hides the action for ineligible bookings, but a disabled
    // button is not a business rule, so every check is repeated here.
    const { data: bookingRaw, error: bookingError } = await auth.supabase
      .from('table_bookings')
      .select(
        'id, status, booking_time, booking_date, start_datetime, end_datetime, duration_minutes, seated_at, left_at, event_id, high_chair_count',
      )
      .eq('id', bookingId)
      .maybeSingle()

    if (bookingError) {
      logger.error('FOH time update: failed to fetch booking', {
        error: bookingError instanceof Error ? bookingError : new Error(String(bookingError)),
        metadata: { bookingId },
      })
      return NextResponse.json({ error: 'Failed to fetch booking' }, { status: 500 })
    }

    if (!bookingRaw) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const booking = bookingRaw as BookingRow
    const status = (booking.status || '').toLowerCase()

    if (!EDITABLE_STATUSES.has(status)) {
      return NextResponse.json(
        { error: 'This booking can no longer be re-timed.', code: 'ineligible_status' },
        { status: 409 },
      )
    }

    // A party that has left is finished, whatever the raw status still says. left_at is set
    // without moving the status, so checking status alone would let a departed booking through.
    if (booking.left_at) {
      return NextResponse.json(
        { error: 'This party has already left, so the time cannot be changed.', code: 'already_left' },
        { status: 409 },
      )
    }

    // An event diner's table reservation is tied to a ticketed event booking and the event's own
    // start. Moving the table half of that pair on its own would split them, and nothing here
    // updates the event side. Refused until an event-aware reschedule exists.
    if (booking.event_id) {
      return NextResponse.json(
        {
          error: 'This booking is tied to an event. Change it from the event instead.',
          code: 'event_linked',
        },
        { status: 409 },
      )
    }

    // Step 2: work out the two windows this booking carries.
    //
    // The guest window comes from the booking row. The table is held longer than that whenever a
    // turnaround gap is configured, and that longer window lives on the assignment rows. Reading
    // the duration from the assignments (as the previous version did) folded the gap into the
    // guest's booking on every move.
    const { data: assignments, error: assignmentError } = await auth.supabase
      .from('booking_table_assignments')
      .select('start_datetime, end_datetime')
      .eq('table_booking_id', bookingId)

    if (assignmentError) {
      logger.error('FOH time update: failed to fetch booking_table_assignments', {
        error: assignmentError instanceof Error ? assignmentError : new Error(String(assignmentError)),
        metadata: { bookingId },
      })
      return NextResponse.json({ error: 'Failed to fetch booking assignment' }, { status: 500 })
    }

    const bookingStart = booking.start_datetime
      ? new Date(booking.start_datetime)
      : booking.booking_date && booking.booking_time
        ? fromZonedTime(`${booking.booking_date}T${booking.booking_time}`, 'Europe/London')
        : null

    if (!bookingStart || !Number.isFinite(bookingStart.getTime())) {
      return NextResponse.json(
        { error: 'This booking has no usable start time and must be fixed in the back office.', code: 'corrupt_window' },
        { status: 422 },
      )
    }

    const guestDurationMs = (() => {
      if (booking.end_datetime) {
        const end = new Date(booking.end_datetime)
        const ms = end.getTime() - bookingStart.getTime()
        if (Number.isFinite(ms) && ms > 0) return ms
      }
      const minutes = Number(booking.duration_minutes)
      if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000
      return null
    })()

    if (guestDurationMs == null) {
      return NextResponse.json(
        { error: 'This booking has no usable duration and must be fixed in the back office.', code: 'corrupt_window' },
        { status: 422 },
      )
    }

    // The gap is whatever this specific booking already carries, not the current setting. Re-reading
    // the setting would silently re-length bookings taken before it changed.
    const assignmentRows = Array.isArray(assignments) ? assignments : []
    const assignmentEnds = assignmentRows
      .map((row) => new Date(row.end_datetime as string))
      .filter((value) => Number.isFinite(value.getTime()))
    const latestAssignmentEnd = assignmentEnds.length > 0
      ? assignmentEnds.reduce((latest, current) => (current.getTime() > latest.getTime() ? current : latest))
      : null
    const bookingEndMs = bookingStart.getTime() + guestDurationMs
    const turnaroundMs = latestAssignmentEnd
      ? Math.max(0, latestAssignmentEnd.getTime() - bookingEndMs)
      : 0

    // Step 3: build the new windows. fromZonedTime is what keeps this correct through BST; using
    // setUTCHours would land an hour out for seven months of the year.
    const londonDateIso = getLondonDateIso(bookingStart)
    const fromTime = londonClock(bookingStart)

    if (fromTime === newTime) {
      // Nothing to write, and nothing to tell the guest about.
      return NextResponse.json({
        success: true,
        data: { state: 'unchanged', booking_time: fromTime },
      })
    }

    const newStart = fromZonedTime(`${londonDateIso}T${newTime}:00`, 'Europe/London')
    const newBookingEnd = new Date(newStart.getTime() + guestDurationMs)
    const newAssignmentEnd = new Date(newBookingEnd.getTime() + turnaroundMs)

    // Step 4: move the booking row and every assignment atomically.
    const { data: moveResultRaw, error: moveError } = await (auth.supabase as any).rpc(
      'move_table_booking_time_v06',
      {
        p_table_booking_id: bookingId,
        p_booking_time: `${newTime}:00`,
        p_start_datetime: newStart.toISOString(),
        p_booking_end_datetime: newBookingEnd.toISOString(),
        p_assignment_end_datetime: newAssignmentEnd.toISOString(),
      },
    )

    if (moveError) {
      if (isAssignmentConflictError(moveError)) {
        return NextResponse.json(
          { error: 'Selected time conflicts with another booking or private block.', code: 'conflict' },
          { status: 409 },
        )
      }

      logger.error('FOH time update: failed to move booking time atomically', {
        error: moveError instanceof Error ? moveError : new Error(String(moveError.message || moveError)),
        metadata: { bookingId, fromTime, newTime },
      })
      return NextResponse.json({ error: 'Failed to update booking time' }, { status: 500 })
    }

    const moveResult = (moveResultRaw || {}) as {
      state?: string
      reason?: string
      assignment_count?: number
      high_chairs_requested?: number
      high_chairs_granted?: number
    }
    if (moveResult.state === 'blocked' && moveResult.reason === 'booking_not_found') {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const highChairsRequested = Number(moveResult.high_chairs_requested ?? 0)
    const highChairsGranted = Number(moveResult.high_chairs_granted ?? 0)
    const highChairsLost = Math.max(0, highChairsRequested - highChairsGranted)

    // Audited before the notification, because the move has already committed and the notification
    // can take seconds. An audit written only on the happy path is an audit you cannot trust.
    await logAuditEvent({
      user_id: auth.userId,
      operation_type: 'change_time',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      old_values: {
        booking_time: fromTime,
        start_datetime: bookingStart.toISOString(),
        end_datetime: new Date(bookingEndMs).toISOString(),
        high_chair_count: highChairsRequested,
      },
      new_values: {
        booking_time: newTime,
        start_datetime: newStart.toISOString(),
        end_datetime: newBookingEnd.toISOString(),
        assignment_end_datetime: newAssignmentEnd.toISOString(),
        high_chair_count: highChairsGranted,
      },
      additional_info: {
        surface: 'foh',
        assignment_count: moveResult.assignment_count ?? assignmentRows.length,
        turnaround_minutes: Math.round(turnaroundMs / 60000),
        was_seated: Boolean(booking.seated_at),
      },
    })

    // Every time change is confirmed to the guest. Awaited rather than fire-and-forget so the send
    // completes before this serverless function is frozen; the helper swallows its own errors and
    // never fails the move.
    await sendTableBookingRescheduledNotificationIfAllowed(auth.supabase, { tableBookingId: bookingId })

    return NextResponse.json({
      success: true,
      assignment_count: moveResult.assignment_count ?? assignmentRows.length,
      data: {
        state: 'updated',
        booking_time: newTime,
        start_datetime: newStart.toISOString(),
        end_datetime: newBookingEnd.toISOString(),
        high_chairs_granted: highChairsGranted,
        high_chairs_lost: highChairsLost,
      },
      booking: {
        id: bookingId,
        booking_time: newTime,
        start_datetime: newStart.toISOString(),
        end_datetime: newBookingEnd.toISOString(),
        high_chair_count: highChairsGranted,
      },
    })
  } catch (error) {
    logger.error('FOH time update: unexpected error', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return NextResponse.json({ error: 'Failed to update booking time' }, { status: 500 })
  }
}
