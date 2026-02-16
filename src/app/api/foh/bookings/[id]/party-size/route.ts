import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import {
  mapSeatUpdateBlockedReason,
  updateTableBookingPartySizeWithLinkedEventSeats
} from '@/lib/events/staff-seat-updates'

const UpdatePartySizeSchema = z.object({
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  send_sms: z.boolean().optional().default(true)
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdatePartySizeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid party size',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  try {
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(auth.supabase, {
      tableBookingId: id,
      partySize: parsed.data.party_size,
      actor: 'foh',
      sendSms: parsed.data.send_sms,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    })

    if (result.state === 'blocked') {
      return NextResponse.json(
        {
          error: mapSeatUpdateBlockedReason(result.reason),
          reason: result.reason || null
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      data: result
    })
  } catch (error) {
    logger.error('FOH table-booking party-size update failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: id },
    })
    return NextResponse.json(
      {
        error: 'Failed to update booking party size'
      },
      { status: 500 }
    )
  }
}
