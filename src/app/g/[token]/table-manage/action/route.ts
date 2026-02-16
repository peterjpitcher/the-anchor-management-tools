import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'
import { updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'

const ActionSchema = z.object({
  action: z.enum(['update', 'cancel']),
  party_size: z
    .preprocess((value) => (typeof value === 'string' && value.length > 0 ? Number.parseInt(value, 10) : undefined), z.number().int().min(1).max(20))
    .optional(),
  notes: z.string().max(500).optional()
})

function redirectWithStatus(request: NextRequest, token: string, status: string) {
  return NextResponse.redirect(new URL(`/g/${token}/table-manage?status=${encodeURIComponent(status)}`, request.url), 303)
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_table_manage_action',
    maxAttempts: 12
  })

  if (!throttle.allowed) {
    return redirectWithStatus(request, token, 'rate_limited')
  }

  const formData = await request.formData()

  const parsed = ActionSchema.safeParse({
    action: formData.get('action'),
    party_size: formData.get('party_size'),
    notes: formData.get('notes')
  })

  if (!parsed.success) {
    return redirectWithStatus(request, token, 'error')
  }

  const supabase = createAdminClient()

  try {
    const result = await updateTableBookingByRawToken(supabase, {
      rawToken: token,
      action: parsed.data.action,
      newPartySize: parsed.data.party_size,
      notes: parsed.data.notes,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    })

    if (result.state === 'blocked') {
      return redirectWithStatus(request, token, 'error')
    }

    if (result.state === 'cancelled') {
      if (result.charge_request_id) {
        return redirectWithStatus(request, token, 'late_cancel_charge_requested')
      }
      return redirectWithStatus(request, token, 'cancelled')
    }

    if (result.charge_request_id) {
      return redirectWithStatus(request, token, 'charge_requested')
    }

    return redirectWithStatus(request, token, 'updated')
  } catch (error) {
    logger.warn('Guest table-manage action failed unexpectedly', {
      metadata: {
        token,
        error: error instanceof Error ? error.message : String(error)
      }
    })
    return redirectWithStatus(request, token, 'error')
  }
}
