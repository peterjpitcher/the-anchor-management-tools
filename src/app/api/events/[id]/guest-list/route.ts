import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { buildGuestListModel, type GuestListBookingInput } from '@/lib/events/guest-list-model'
import { generateEventGuestListPdf } from '@/lib/events/guest-list-pdf'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'

type RouteContext = {
  params: Promise<{ id: string }>
}

type EventRow = {
  id: string
  name: string
  date: string
  time: string | null
  slug: string | null
}

type BookingRow = {
  seats: number | null
  attendee_names: string[] | null
  is_reminder_only: boolean | null
  customer: {
    first_name: string | null
    last_name: string | null
  } | null
}

function safeFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'event'
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id: eventId } = await context.params
  if (!eventId) return new NextResponse('Event ID required', { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const canView = await checkUserPermission('events', 'view')
  if (!canView) return new NextResponse('Permission denied', { status: 403 })

  try {
    const admin = createAdminClient()

    const { data: event, error: eventError } = await admin
      .from('events')
      .select('id, name, date, time, slug')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) throw eventError
    if (!event) return new NextResponse('Event not found', { status: 404 })

    const eventRow = event as EventRow

    const { data: bookings, error: bookingsError } = await admin
      .from('bookings')
      .select('seats, attendee_names, is_reminder_only, customer:customers(first_name, last_name)')
      .eq('event_id', eventId)
      .neq('status', 'cancelled')
      .eq('is_reminder_only', false)

    if (bookingsError) throw bookingsError

    const bookingRows = (bookings ?? []) as unknown as BookingRow[]

    const groups = buildGuestListModel(bookingRows.map((b): GuestListBookingInput => ({
      seats: b.seats,
      attendeeNames: b.attendee_names,
      customerFirstName: b.customer?.first_name ?? null,
      customerLastName: b.customer?.last_name ?? null,
      isReminderOnly: b.is_reminder_only,
    })))

    const dateLabel = formatDateInLondon(eventRow.date, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    const pdf = await generateEventGuestListPdf(
      { name: eventRow.name, dateLabel, timeLabel: formatTime12Hour(eventRow.time) },
      groups,
    )

    const filename = `guest-list-${safeFilename(eventRow.slug || eventRow.name)}.pdf`

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Failed to generate event guest list:', error)
    return new NextResponse('Failed to generate guest list', { status: 500 })
  }
}
