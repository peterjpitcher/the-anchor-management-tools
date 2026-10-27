import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { buildGuestListModel, type GuestListBookingInput } from '@/lib/events/guest-list-model'
import { generateEventGuestListPdf } from '@/lib/events/guest-list-pdf'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'
import { getAnchorLogoDataUri } from '@/lib/pdf/anchor-logo'
import { logAuditEvent } from '@/app/actions/audit'
import { DOOR_LIST_EXCLUDED_STATUS_FILTER, doorPaymentLabel, isOnDoorList, loadDoorPayments } from '@/lib/events/door-list'
import { hasGuestAnswers } from '@/lib/events/guest-answers'
import { resolveEventPaymentMode, resolveEventPriceAmount } from '@/lib/events/pricing'

type RouteContext = {
  params: Promise<{ id: string }>
}

type EventRow = {
  id: string
  name: string
  date: string
  time: string | null
  slug: string | null
  payment_mode: string | null
  is_free: boolean | null
  price: number | null
  price_per_seat: number | null
  online_discount_type: string | null
  online_discount_value: number | null
  online_discount_ends_at: string | null
}

type BookingRow = {
  id: string
  seats: number | null
  status: string | null
  attendee_names: string[] | null
  attendees: unknown
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
      .select('id, name, date, time, slug, payment_mode, is_free, price, price_per_seat, online_discount_type, online_discount_value, online_discount_ends_at')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) throw eventError
    if (!event) return new NextResponse('Event not found', { status: 404 })

    const eventRow = event as EventRow

    // The same people as the booking sheets and the event page (BK-030): everyone except
    // cancelled bookings and lapsed payment holds. It used to list confirmed bookings only.
    const { data: bookings, error: bookingsError } = await admin
      .from('bookings')
      .select('id, seats, status, attendee_names, attendees, is_reminder_only, customer:customers(first_name, last_name)')
      .eq('event_id', eventId)
      .not('status', 'in', DOOR_LIST_EXCLUDED_STATUS_FILTER)
      .eq('is_reminder_only', false)

    if (bookingsError) throw bookingsError

    const bookingRows = ((bookings ?? []) as unknown as BookingRow[]).filter(isOnDoorList)
    const payments = await loadDoorPayments(admin, bookingRows.map((b) => b.id))
    const paymentMode = resolveEventPaymentMode(eventRow)
    const pricePerSeat = resolveEventPriceAmount(eventRow)

    const groups = buildGuestListModel(bookingRows.map((b): GuestListBookingInput => {
      const label = doorPaymentLabel({
        paymentMode,
        isFree: pricePerSeat === 0 && paymentMode === 'free',
        payments: payments.get(b.id) ?? [],
        amountDue: pricePerSeat * Math.max(1, Number(b.seats ?? 1)),
      })
      return {
        seats: b.seats,
        attendeeNames: b.attendee_names,
        attendees: b.attendees,
        customerFirstName: b.customer?.first_name ?? null,
        customerLastName: b.customer?.last_name ?? null,
        isReminderOnly: b.is_reminder_only,
        // Only what the door has to act on: money still to take.
        paymentNote: label.startsWith('Not paid') ? label : null,
      }
    }))

    const dateLabel = formatDateInLondon(eventRow.date, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    const pdf = await generateEventGuestListPdf(
      { name: eventRow.name, dateLabel, timeLabel: formatTime12Hour(eventRow.time) },
      groups,
      { logoDataUri: getAnchorLogoDataUri() },
    )

    const filename = `guest-list-${safeFilename(eventRow.slug || eventRow.name)}.pdf`

    // The list carries guests' answers (health data on the tasting night), so each download is
    // recorded (BK-017). Counts only.
    if (bookingRows.some((b) => hasGuestAnswers(b.attendees))) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email ?? undefined,
        operation_type: 'export',
        resource_type: 'event',
        resource_id: eventRow.id,
        operation_status: 'success',
        additional_info: { document: 'guest_list', bookings: bookingRows.length },
      })
    }

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
