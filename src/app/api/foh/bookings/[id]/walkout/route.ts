import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { createChargeRequestForBooking, getTableBookingForFoh } from '@/lib/foh/bookings'

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

  const { chargeRequestId, amount: chargeAmount } = await createChargeRequestForBooking(auth.supabase, {
    bookingId: booking.id,
    customerId: booking.customer_id,
    type: 'walkout',
    amount,
    requestedByUserId: auth.userId,
    metadata: {
      source: 'foh_walkout',
      notes: parsed.data.notes || null
    }
  })

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      charge_request_id: chargeRequestId,
      amount: chargeAmount
    }
  })
}
