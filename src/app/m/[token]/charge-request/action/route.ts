import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import {
  attemptApprovedChargeFromDecision,
  decideChargeRequestByRawToken,
  getChargeApprovalPreviewByRawToken,
  type ChargeApprovalPreview
} from '@/lib/table-bookings/charge-approvals'

const ActionSchema = z.object({
  decision: z.enum(['approve', 'waive']),
  approved_amount: z
    .preprocess((value) => (typeof value === 'string' && value.length > 0 ? Number(value) : undefined), z.number().positive())
    .optional(),
  confirm_amount: z.string().optional(),
  threshold_confirmed: z.string().optional()
})

function normalizeAmount(value: number): number {
  return Number(value.toFixed(2))
}

function parseConfirmAmount(value?: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return normalizeAmount(parsed)
}

function redirectWithStatus(request: NextRequest, token: string, status: string) {
  return NextResponse.redirect(new URL(`/m/${token}/charge-request?status=${encodeURIComponent(status)}`, request.url), 303)
}

function amountFromPreview(preview: ChargeApprovalPreview): number {
  const amount = typeof preview.amount === 'number' ? preview.amount : Number(preview.amount || 0)
  return Number.isFinite(amount) && amount > 0 ? normalizeAmount(amount) : 0
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'manager_charge_approval_action',
    maxAttempts: 6
  })

  if (!throttle.allowed) {
    return redirectWithStatus(request, token, 'rate_limited')
  }

  const formData = await request.formData()
  const parseResult = ActionSchema.safeParse({
    decision: formData.get('decision'),
    approved_amount: formData.get('approved_amount'),
    confirm_amount: formData.get('confirm_amount'),
    threshold_confirmed: formData.get('threshold_confirmed')
  })

  if (!parseResult.success) {
    return redirectWithStatus(request, token, 'error')
  }

  const payload = parseResult.data
  const supabase = createAdminClient()

  let preview: ChargeApprovalPreview
  try {
    preview = await getChargeApprovalPreviewByRawToken(supabase, token)
  } catch {
    return redirectWithStatus(request, token, 'error')
  }

  if (preview.state !== 'ready' || !preview.charge_request_id || !preview.table_booking_id || !preview.customer_id) {
    return redirectWithStatus(request, token, 'error')
  }

  if (payload.decision === 'waive') {
    const decision = await decideChargeRequestByRawToken(supabase, {
      rawToken: token,
      decision: 'waived'
    })

    if (decision.state !== 'decision_applied') {
      return redirectWithStatus(request, token, 'error')
    }

    await recordAnalyticsEvent(supabase, {
      customerId: preview.customer_id,
      tableBookingId: preview.table_booking_id,
      eventType: 'charge_waived',
      metadata: {
        charge_request_id: preview.charge_request_id,
        amount: amountFromPreview(preview),
        currency: preview.currency || 'GBP',
        type: preview.type || null
      }
    })

    return redirectWithStatus(request, token, 'waived')
  }

  const approvedAmount = normalizeAmount(payload.approved_amount ?? amountFromPreview(preview))
  if (!Number.isFinite(approvedAmount) || approvedAmount <= 0) {
    return redirectWithStatus(request, token, 'error')
  }

  if (preview.requires_amount_reentry) {
    const confirmedAmount = parseConfirmAmount(payload.confirm_amount)
    if (confirmedAmount === null || confirmedAmount !== approvedAmount) {
      return redirectWithStatus(request, token, 'error')
    }
  }

  if (preview.warning_needs_extra_confirmation && payload.threshold_confirmed !== 'yes') {
    return redirectWithStatus(request, token, 'error')
  }

  const decision = await decideChargeRequestByRawToken(supabase, {
    rawToken: token,
    decision: 'approved',
    approvedAmount
  })

  if (decision.state !== 'decision_applied') {
    return redirectWithStatus(request, token, 'error')
  }

  await recordAnalyticsEvent(supabase, {
    customerId: preview.customer_id,
    tableBookingId: preview.table_booking_id,
    eventType: 'charge_approved',
    metadata: {
      charge_request_id: preview.charge_request_id,
      approved_amount: approvedAmount,
      currency: preview.currency || 'GBP',
      type: preview.type || null
    }
  })

  const attempt = await attemptApprovedChargeFromDecision(supabase, decision)

  if (attempt.status === 'succeeded') {
    return redirectWithStatus(request, token, 'approved_succeeded')
  }

  if (attempt.status === 'pending') {
    return redirectWithStatus(request, token, 'approved_pending')
  }

  return redirectWithStatus(request, token, 'approved_failed')
}
