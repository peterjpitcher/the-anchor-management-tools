import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TimeSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM format'),
})

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
  const [newHoursStr, newMinutesStr] = newTime.split(':')
  const newHours = parseInt(newHoursStr, 10)
  const newMinutes = parseInt(newMinutesStr, 10)

  try {
    // Step 1: Try to fetch from booking_table_assignments (authoritative for duration)
    const { data: assignment, error: assignmentError } = await auth.supabase
      .from('booking_table_assignments')
      .select('start_datetime, end_datetime')
      .eq('table_booking_id', bookingId)
      .maybeSingle()

    if (assignmentError) {
      logger.error('FOH time update: failed to fetch booking_table_assignments', {
        error: assignmentError instanceof Error ? assignmentError : new Error(String(assignmentError)),
        metadata: { bookingId },
      })
      return NextResponse.json({ error: 'Failed to fetch booking assignment' }, { status: 500 })
    }

    let startDt: string
    let endDt: string
    const hasAssignment = assignment !== null

    if (hasAssignment) {
      startDt = assignment.start_datetime as string
      endDt = assignment.end_datetime as string
    } else {
      // Fallback to table_bookings
      const { data: booking, error: bookingError } = await auth.supabase
        .from('table_bookings')
        .select('start_datetime, end_datetime, booking_date')
        .eq('id', bookingId)
        .maybeSingle()

      if (bookingError) {
        logger.error('FOH time update: failed to fetch table_bookings', {
          error: bookingError instanceof Error ? bookingError : new Error(String(bookingError)),
          metadata: { bookingId },
        })
        return NextResponse.json({ error: 'Failed to fetch booking' }, { status: 500 })
      }

      if (!booking) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
      }

      startDt = booking.start_datetime as string
      endDt = booking.end_datetime as string
    }

    // Step 2: Calculate duration
    const startDate = new Date(startDt)
    const endDate = new Date(endDt)
    const durationMs = endDate.getTime() - startDate.getTime()

    // Step 3: Build new start/end datetimes
    const newStart = new Date(startDate)
    newStart.setUTCHours(newHours, newMinutes, 0, 0)
    const newEnd = new Date(newStart.getTime() + durationMs)

    // Record original time for logging
    const fromTime =
      String(startDate.getUTCHours()).padStart(2, '0') +
      ':' +
      String(startDate.getUTCMinutes()).padStart(2, '0')

    // Step 4: Update table_bookings
    const { error: tbUpdateError } = await auth.supabase
      .from('table_bookings')
      .update({
        booking_time: `${newTime}:00`,
        start_datetime: newStart.toISOString(),
        end_datetime: newEnd.toISOString(),
      })
      .eq('id', bookingId)

    if (tbUpdateError) {
      logger.error('FOH time update: failed to update table_bookings', {
        error: tbUpdateError instanceof Error ? tbUpdateError : new Error(String(tbUpdateError)),
        metadata: { bookingId, fromTime, newTime },
      })
      return NextResponse.json({ error: 'Failed to update booking time' }, { status: 500 })
    }

    // Step 5: Update booking_table_assignments (only if assignment exists)
    if (hasAssignment) {
      const { error: assignmentUpdateError } = await auth.supabase
        .from('booking_table_assignments')
        .update({
          start_datetime: newStart.toISOString(),
          end_datetime: newEnd.toISOString(),
        })
        .eq('table_booking_id', bookingId)

      if (assignmentUpdateError) {
        logger.error('FOH time update: failed to update booking_table_assignments', {
          error:
            assignmentUpdateError instanceof Error
              ? assignmentUpdateError
              : new Error(String(assignmentUpdateError)),
          metadata: { bookingId, fromTime, newTime },
        })
        return NextResponse.json({ error: 'Failed to update assignment time' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('FOH time update: unexpected error', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return NextResponse.json({ error: 'Failed to update booking time' }, { status: 500 })
  }
}
