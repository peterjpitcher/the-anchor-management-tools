import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'
import { updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'

const ActionSchema = z.object({
  action: z.enum(['update', 'cancel']),
  party_size: z
    .preprocess((value) => {
      if (value == null) return undefined
      if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed.length > 0 ? Number.parseInt(trimmed, 10) : undefined
      }
      return value
    }, z.number().int().min(1).max(20).optional()),
  notes: z.preprocess(
    (value) => (typeof value === 'string' ? value : undefined),
    z.string().max(500).optional()
  )
})

type ParsedAction = z.infer<typeof ActionSchema>

function redirectWithStatus(request: NextRequest, token: string, status: string) {
  return NextResponse.redirect(new URL(`/g/${token}/table-manage?status=${encodeURIComponent(status)}`, request.url), 303)
}

async function runGuestTableManageAction(request: NextRequest, token: string, payload: ParsedAction) {
  const supabase = createAdminClient()

  try {
    const result = await updateTableBookingByRawToken(supabase, {
      rawToken: token,
      action: payload.action,
      newPartySize: payload.party_size,
      notes: payload.notes,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    })

    if (result.state === 'blocked') {
      logger.warn('Guest table-manage action blocked', {
        metadata: {
          reason: result.reason || 'unknown',
          action: payload.action,
          tableBookingId: result.table_booking_id || null
        }
      })
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
        action: payload.action,
        error: error instanceof Error ? error.message : String(error)
      }
    })
    return redirectWithStatus(request, token, 'error')
  }
}

export async function GET(
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

  const action = request.nextUrl.searchParams.get('action')
  const confirm = request.nextUrl.searchParams.get('confirm')

  if (action !== 'cancel' || confirm !== '1') {
    logger.warn('Guest table-manage GET action rejected', {
      metadata: {
        action,
        hasConfirm: Boolean(confirm)
      }
    })
    return redirectWithStatus(request, token, 'error')
  }

  return runGuestTableManageAction(request, token, {
    action: 'cancel',
    party_size: undefined,
    notes: undefined
  })
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
    logger.warn('Guest table-manage action form validation failed', {
      metadata: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code
        })),
        action: formData.get('action'),
        hasPartySize: formData.has('party_size'),
        hasNotes: formData.has('notes')
      }
    })
    return redirectWithStatus(request, token, 'error')
  }

  return runGuestTableManageAction(request, token, parsed.data)
}
