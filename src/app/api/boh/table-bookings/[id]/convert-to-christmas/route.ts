import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppUrl } from '@/lib/env'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { convertTableBookingToChristmas } from '@/lib/table-bookings/christmas-conversion'
import { PARTY_SIZE_INPUT_CEILING } from '@/lib/table-bookings/party-limit'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ConvertSchema = z.object({
  // How many of the seats are having Christmas dinner. The database checks the Christmas minimum
  // and that it is no more than the seats; this is a typo guard only.
  christmas_diners: z.number().int().min(1).max(PARTY_SIZE_INPUT_CEILING),
  internal_note: z.string().trim().max(500).optional(),
})

/**
 * Turns a confirmed regular booking into a Christmas booking with some or all of its seats having
 * Christmas dinner, and sends the guest ONE deposit request for the diners (owner requirement,
 * 26 November 2026). The booking stays confirmed with the deposit owed. See christmas-conversion.ts.
 *
 * Body: { "christmas_diners": 9, "internal_note": "3 children on the kids menu" }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireBohTableBookingPermission('edit')
  if (!auth.ok) return auth.response

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = ConvertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Enter how many people are having Christmas dinner.' },
      { status: 400 }
    )
  }

  const result = await convertTableBookingToChristmas(auth.supabase, {
    bookingId: id,
    christmasDiners: parsed.data.christmas_diners,
    internalNote: parsed.data.internal_note ?? null,
    userId: auth.userId,
    appBaseUrl: getAppUrl(),
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    success: true,
    data: {
      state: 'deposit_required',
      stillConfirmed: true,
      bookingReference: result.bookingReference,
      partySize: result.partySize,
      christmasDiners: result.christmasDiners,
      depositAmount: result.depositAmount,
      depositUrl: result.depositUrl,
      notification: result.notification,
      warning: result.warning,
    },
  })
}
