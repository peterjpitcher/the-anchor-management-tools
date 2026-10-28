import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { listAwaitingConfirmation, markConfirmationCallMade } from '@/lib/table-bookings/awaiting-confirmation'

/**
 * Guests asked the day before to confirm their table who have not answered, for today and
 * tomorrow (BK-094). GET needs table_bookings view; recording a call needs edit.
 */

const BookingIdSchema = z.string().uuid()

export async function GET() {
  const auth = await requireFohPermission('view')
  if (!auth.ok) return auth.response

  try {
    const items = await listAwaitingConfirmation(auth.supabase)
    return NextResponse.json({ success: true, data: items })
  } catch (error) {
    logger.error('Could not list guests who have not confirmed their table', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json({ error: 'Could not load the guests to call' }, { status: 500 })
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
    await markConfirmationCallMade(auth.supabase, { bookingId: parsed.data, userId: auth.userId })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Could not record a call to a guest who had not confirmed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: parsed.data },
    })
    return NextResponse.json({ error: 'That was not saved. Try again.' }, { status: 500 })
  }
}
