import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { listGuestsNotTold, markGuestToldByPhone } from '@/lib/table-bookings/guest-not-told'

/**
 * Cancelled table bookings whose guest was not told and has not been rung yet (BK-177). The FOH
 * screen lists them all; the booking page asks for its own. "I've rung them" clears one.
 */

const BookingIdSchema = z.string().uuid()

export async function GET(request: NextRequest) {
  const auth = await requireFohPermission('view')
  if (!auth.ok) return auth.response

  const rawBookingId = request.nextUrl.searchParams.get('booking_id')
  const parsedBookingId = rawBookingId ? BookingIdSchema.safeParse(rawBookingId) : null
  if (parsedBookingId && !parsedBookingId.success) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  try {
    const items = await listGuestsNotTold(auth.supabase, { bookingId: parsedBookingId?.data ?? null })
    return NextResponse.json({ success: true, data: items })
  } catch (error) {
    logger.error('Could not list guests not told about a cancellation', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Could not load the guests still to ring' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = BookingIdSchema.safeParse(body && typeof body === 'object' ? (body as Record<string, unknown>).booking_id : null)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  try {
    await markGuestToldByPhone(auth.supabase, { bookingId: parsed.data, userId: auth.userId })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Could not record that a guest was rung about a cancellation', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: parsed.data },
    })
    return NextResponse.json({ error: 'That was not saved. Try again.' }, { status: 500 })
  }
}
