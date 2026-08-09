import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh, recordWalkoutForBooking } from '@/lib/foh/bookings'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const WalkoutSchema = z.object({
  amount: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.number().positive()
  ),
  notes: z.string().trim().max(500).optional()
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }
  const booking = await getTableBookingForFoh(auth.supabase, id)

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = WalkoutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid walkout payload',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const amount = Number(parsed.data.amount.toFixed(2))

  // Records the incident only. This used to raise a charge request and email a
  // manager for approval, which could never lead to a charge: no card is held
  // for a table booking, so every approval failed on "No card on file". Charge
  // requests were withdrawn entirely, so the walkout is now just a logged fact
  // about the booking.
  await recordWalkoutForBooking(auth.supabase, {
    bookingId: booking.id,
    customerId: booking.customer_id,
    amount,
    recordedByUserId: auth.userId,
    notes: parsed.data.notes || null
  })

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      amount,
      booking: {
        id: booking.id,
        status: booking.status
      }
    }
  })
}
