import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fromZonedTime } from 'date-fns-tz'
import { requireFohPermission, getLondonDateIso } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { isAssignmentConflictError } from '@/lib/table-bookings/move-table'

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

  try {
    // Step 1: Fetch booking_table_assignments (authoritative for the FOH-rendered duration)
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

    let startDt: string
    let endDt: string
    const assignmentRows = Array.isArray(assignments) ? assignments : []
    const assignmentWindows = assignmentRows
      .map((row) => ({
        start: new Date(row.start_datetime as string),
        end: new Date(row.end_datetime as string),
      }))
      .filter((window) => Number.isFinite(window.start.getTime()) && Number.isFinite(window.end.getTime()))

    if (assignmentWindows.length > 0) {
      const earliestStart = assignmentWindows.reduce((earliest, current) =>
        current.start.getTime() < earliest.getTime() ? current.start : earliest,
      assignmentWindows[0]!.start)
      const latestEnd = assignmentWindows.reduce((latest, current) =>
        current.end.getTime() > latest.getTime() ? current.end : latest,
      assignmentWindows[0]!.end)
      startDt = earliestStart.toISOString()
      endDt = latestEnd.toISOString()
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
    // Use getLondonDateIso to get the booking date in London local time, then combine
    // with the new London-local time using fromZonedTime to get the correct UTC value.
    // Using setUTCHours would treat the London clock time as UTC, causing a 1-hour
    // offset in British Summer Time (BST, UTC+1).
    const londonDateIso = getLondonDateIso(startDate)
    const newStart = fromZonedTime(`${londonDateIso}T${newTime}:00`, 'Europe/London')
    const newEnd = new Date(newStart.getTime() + durationMs)

    // Record original time for logging — derive from UTC using same getLondonDateIso approach
    const origLondonParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(startDate)
    const fromHour = origLondonParts.find(p => p.type === 'hour')?.value ?? '00'
    const fromMinute = origLondonParts.find(p => p.type === 'minute')?.value ?? '00'
    const fromTime = `${fromHour}:${fromMinute}`

    // Step 4: Move the booking row and all table assignments atomically.
    const { data: moveResultRaw, error: moveError } = await (auth.supabase as any).rpc(
      'move_table_booking_time_v05',
      {
        p_table_booking_id: bookingId,
        p_booking_time: `${newTime}:00`,
        p_start_datetime: newStart.toISOString(),
        p_end_datetime: newEnd.toISOString(),
      },
    )

    if (moveError) {
      if (isAssignmentConflictError(moveError)) {
        return NextResponse.json(
          { error: 'Selected time conflicts with another booking or private block.' },
          { status: 409 },
        )
      }

      logger.error('FOH time update: failed to move booking time atomically', {
        error: moveError instanceof Error ? moveError : new Error(String(moveError.message || moveError)),
        metadata: { bookingId, fromTime, newTime },
      })
      return NextResponse.json({ error: 'Failed to update booking time' }, { status: 500 })
    }

    const moveResult = (moveResultRaw || {}) as { state?: string; reason?: string; assignment_count?: number }
    if (moveResult.state === 'blocked' && moveResult.reason === 'booking_not_found') {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, assignment_count: moveResult.assignment_count ?? assignmentRows.length })
  } catch (error) {
    logger.error('FOH time update: unexpected error', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return NextResponse.json({ error: 'Failed to update booking time' }, { status: 500 })
  }
}
