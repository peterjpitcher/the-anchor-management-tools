import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { sendEmail } from '@/lib/email/emailService'
import { logger } from '@/lib/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { createStripeOffSessionCharge, isStripeConfigured } from '@/lib/payments/stripe'

export const MANAGER_APPROVAL_EMAIL = 'manager@the-anchor.pub'

type ChargeRequestType = 'late_cancel' | 'no_show' | 'reduction_fee' | 'walkout'

export type ChargeApprovalPreview = {
  state: 'ready' | 'already_decided' | 'blocked'
  reason?: string
  charge_request_id?: string
  table_booking_id?: string
  customer_id?: string
  type?: ChargeRequestType
  amount?: number
  currency?: string
  manager_decision?: 'approved' | 'waived' | null
  charge_status?: 'pending' | 'succeeded' | 'failed' | 'waived' | null
  booking_reference?: string | null
  booking_date?: string | null
  booking_time?: string | null
  start_datetime?: string | null
  end_datetime?: string | null
  party_size?: number | null
  committed_party_size?: number | null
  table_name?: string | null
  customer_first_name?: string | null
  customer_last_name?: string | null
  customer_mobile?: string | null
  stripe_customer_id?: string | null
  stripe_payment_method_id?: string | null
  payment_method_available?: boolean
  requires_amount_reentry?: boolean
  warning_over_200?: boolean
  warning_over_50_per_head?: boolean
  warning_needs_extra_confirmation?: boolean
}

export type ChargeApprovalDecisionResult = {
  state: 'decision_applied' | 'already_decided' | 'blocked'
  reason?: string
  decision?: 'approved' | 'waived'
  charge_request_id?: string
  table_booking_id?: string
  customer_id?: string
  type?: ChargeRequestType
  amount?: number
  currency?: string
  manager_decision?: 'approved' | 'waived' | null
  charge_status?: 'pending' | 'succeeded' | 'failed' | 'waived' | null
  stripe_payment_intent_id?: string | null
  stripe_customer_id?: string | null
  stripe_payment_method_id?: string | null
}

export type ApprovedChargeAttemptResult = {
  status: 'succeeded' | 'pending' | 'failed'
  stripePaymentIntentId: string | null
  amount: number
  currency: string
  errorMessage?: string
}

function resolveAppBaseUrl(appBaseUrl?: string): string {
  return (appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function formatChargeRequestType(type?: string | null): string {
  switch (type) {
    case 'late_cancel':
      return 'Late cancellation'
    case 'no_show':
      return 'No-show'
    case 'reduction_fee':
      return 'Reduction fee'
    case 'walkout':
      return 'Walkout / unpaid bill'
    default:
      return 'Charge request'
  }
}

function formatDateTime(dateIso?: string | null): string {
  if (!dateIso) return 'Unknown time'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(dateIso))
  } catch {
    return 'Unknown time'
  }
}

function formatMoney(amount: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2
  }).format(amount)
}

function mapPaymentIntentStatus(status?: string | null): 'succeeded' | 'pending' | 'failed' {
  switch (status) {
    case 'succeeded':
      return 'succeeded'
    case 'processing':
    case 'requires_capture':
      return 'pending'
    default:
      return 'failed'
  }
}

function toSafeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(2))
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Number(parsed.toFixed(2))
    }
  }

  return fallback
}

function computeChargeApprovalTokenExpiry(bookingStartIso?: string | null): string {
  const now = Date.now()
  const oneHourMs = 60 * 60 * 1000
  const capMs = now + 30 * 24 * 60 * 60 * 1000
  const defaultMs = now + 7 * 24 * 60 * 60 * 1000
  const bookingPlus48Ms = bookingStartIso ? Date.parse(bookingStartIso) + 48 * 60 * 60 * 1000 : Number.NaN

  const candidateMs = Number.isFinite(bookingPlus48Ms)
    ? Math.max(now + oneHourMs, Math.min(bookingPlus48Ms, capMs))
    : Math.min(defaultMs, capMs)

  return new Date(candidateMs).toISOString()
}

export async function getChargeApprovalPreviewByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<ChargeApprovalPreview> {
  const tokenHash = hashGuestToken(rawToken)
  const { data, error } = await supabase.rpc('get_charge_request_approval_preview_v05', {
    p_hashed_token: tokenHash
  })

  if (error) {
    throw error
  }

  return (data ?? { state: 'blocked', reason: 'invalid_token' }) as ChargeApprovalPreview
}

export async function decideChargeRequestByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    rawToken: string
    decision: 'approved' | 'waived'
    approvedAmount?: number | null
  }
): Promise<ChargeApprovalDecisionResult> {
  const tokenHash = hashGuestToken(input.rawToken)
  const { data, error } = await supabase.rpc('decide_charge_request_v05', {
    p_hashed_token: tokenHash,
    p_decision: input.decision,
    p_approved_amount: input.approvedAmount ?? null
  })

  if (error) {
    throw error
  }

  return (data ?? { state: 'blocked', reason: 'decision_failed' }) as ChargeApprovalDecisionResult
}

export async function sendManagerChargeApprovalEmail(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    chargeRequestId: string
    appBaseUrl?: string
  }
): Promise<{ sent: boolean; approvalUrl?: string | null; error?: string }> {
  const { data: chargeRequest, error: chargeError } = await (supabase.from('charge_requests') as any)
    .select('id, type, amount, currency, table_booking_id, manager_decision, charge_status')
    .eq('id', input.chargeRequestId)
    .maybeSingle()

  if (chargeError || !chargeRequest) {
    return {
      sent: false,
      error: chargeError?.message || 'Charge request not found'
    }
  }

  if (chargeRequest.manager_decision || chargeRequest.charge_status !== 'pending') {
    return {
      sent: false,
      error: 'Charge request already decided'
    }
  }

  const { data: booking, error: bookingError } = await (supabase.from('table_bookings') as any)
    .select('id, customer_id, booking_reference, start_datetime, party_size, committed_party_size')
    .eq('id', chargeRequest.table_booking_id)
    .maybeSingle()

  if (bookingError || !booking || !booking.customer_id) {
    return {
      sent: false,
      error: bookingError?.message || 'Table booking not found for charge request'
    }
  }

  const { data: customer } = await (supabase.from('customers') as any)
    .select('id, first_name, last_name, mobile_number, mobile_e164')
    .eq('id', booking.customer_id)
    .maybeSingle()

  const expiresAt = computeChargeApprovalTokenExpiry(booking.start_datetime)
  const { rawToken } = await createGuestToken(supabase, {
    customerId: booking.customer_id,
    actionType: 'charge_approval',
    chargeRequestId: chargeRequest.id,
    tableBookingId: booking.id,
    expiresAt
  })

  const appBaseUrl = resolveAppBaseUrl(input.appBaseUrl)
  const approvalUrl = `${appBaseUrl}/m/${rawToken}/charge-request`

  const customerName = `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim() || 'Guest'
  const customerMobile = customer?.mobile_e164 || customer?.mobile_number || 'Unknown'
  const typeLabel = formatChargeRequestType(chargeRequest.type)
  const amount = toSafeNumber(chargeRequest.amount)
  const currency = typeof chargeRequest.currency === 'string' ? chargeRequest.currency.toUpperCase() : 'GBP'
  const bookingMoment = formatDateTime(booking.start_datetime)
  const partySize = Number(booking.party_size || booking.committed_party_size || 1)

  const subject = `Charge approval needed: ${typeLabel} ${formatMoney(amount, currency)}`
  const html = [
    '<p>A manager approval is required before any charge attempt.</p>',
    '<ul>',
    `<li><strong>Type:</strong> ${escapeHtml(typeLabel)}</li>`,
    `<li><strong>Amount:</strong> ${escapeHtml(formatMoney(amount, currency))}</li>`,
    `<li><strong>Booking reference:</strong> ${escapeHtml(booking.booking_reference || booking.id)}</li>`,
    `<li><strong>Booking time:</strong> ${escapeHtml(bookingMoment)}</li>`,
    `<li><strong>Party size:</strong> ${escapeHtml(String(Math.max(1, partySize)))}</li>`,
    `<li><strong>Guest:</strong> ${escapeHtml(customerName)} (${escapeHtml(customerMobile)})</li>`,
    '</ul>',
    `<p><a href="${escapeHtml(approvalUrl)}">Open charge approval page</a></p>`,
    `<p>Link expiry: ${escapeHtml(formatDateTime(expiresAt))}</p>`
  ].join('')

  const emailResult = await sendEmail({
    to: MANAGER_APPROVAL_EMAIL,
    subject,
    html
  })

  if (!emailResult.success) {
    return {
      sent: false,
      approvalUrl,
      error: emailResult.error || 'Failed to send approval email'
    }
  }

  return {
    sent: true,
    approvalUrl
  }
}

export async function attemptApprovedChargeFromDecision(
  supabase: SupabaseClient<any, 'public', any>,
  decisionResult: ChargeApprovalDecisionResult
): Promise<ApprovedChargeAttemptResult> {
  const chargeRequestId = decisionResult.charge_request_id
  const tableBookingId = decisionResult.table_booking_id
  const customerId = decisionResult.customer_id
  const type = decisionResult.type || 'late_cancel'
  const amount = toSafeNumber(decisionResult.amount)
  const currency = (decisionResult.currency || 'GBP').toUpperCase()

  if (!chargeRequestId || !tableBookingId || !customerId || amount <= 0) {
    return {
      status: 'failed',
      stripePaymentIntentId: null,
      amount,
      currency,
      errorMessage: 'Charge decision result missing required fields'
    }
  }

  const paymentChargeType = type === 'walkout' ? 'walkout' : 'approved_fee'
  const nowIso = new Date().toISOString()

  if (!isStripeConfigured()) {
    const errorMessage = 'Stripe is not configured'
    await (supabase.from('charge_requests') as any)
      .update({
        charge_status: 'failed',
        updated_at: nowIso,
        metadata: {
          ...(decisionResult as any).metadata,
          charge_attempt_error: errorMessage
        }
      })
      .eq('id', chargeRequestId)

    await (supabase.from('payments') as any).insert({
      table_booking_id: tableBookingId,
      charge_type: paymentChargeType,
      amount,
      currency,
      status: 'failed',
      metadata: {
        charge_request_id: chargeRequestId,
        reason: errorMessage
      }
    })

    await recordAnalyticsEvent(supabase, {
      customerId,
      tableBookingId,
      eventType: 'charge_failed',
      metadata: {
        charge_request_id: chargeRequestId,
        reason: 'stripe_not_configured',
        amount,
        currency
      }
    })

    return {
      status: 'failed',
      stripePaymentIntentId: null,
      amount,
      currency,
      errorMessage
    }
  }

  const stripeCustomerId = decisionResult.stripe_customer_id || null
  const stripePaymentMethodId = decisionResult.stripe_payment_method_id || null

  if (!stripeCustomerId || !stripePaymentMethodId) {
    const errorMessage = 'No card on file for this booking'

    await (supabase.from('charge_requests') as any)
      .update({
        charge_status: 'failed',
        updated_at: nowIso,
        metadata: {
          ...(decisionResult as any).metadata,
          charge_attempt_error: errorMessage,
          missing_stripe_customer: !stripeCustomerId,
          missing_stripe_payment_method: !stripePaymentMethodId
        }
      })
      .eq('id', chargeRequestId)

    await (supabase.from('payments') as any).insert({
      table_booking_id: tableBookingId,
      charge_type: paymentChargeType,
      amount,
      currency,
      status: 'failed',
      metadata: {
        charge_request_id: chargeRequestId,
        reason: errorMessage
      }
    })

    await recordAnalyticsEvent(supabase, {
      customerId,
      tableBookingId,
      eventType: 'charge_failed',
      metadata: {
        charge_request_id: chargeRequestId,
        reason: 'card_not_available',
        amount,
        currency
      }
    })

    return {
      status: 'failed',
      stripePaymentIntentId: null,
      amount,
      currency,
      errorMessage
    }
  }

  try {
    const stripeResult = await createStripeOffSessionCharge({
      idempotencyKey: `charge_request_${chargeRequestId}`,
      amountMinor: Math.round(amount * 100),
      currency,
      customerId: stripeCustomerId,
      paymentMethodId: stripePaymentMethodId,
      metadata: {
        payment_kind: 'approved_charge',
        charge_request_id: chargeRequestId,
        table_booking_id: tableBookingId,
        charge_type: type
      }
    })

    const mappedStatus = mapPaymentIntentStatus(stripeResult.status)

    await (supabase.from('charge_requests') as any)
      .update({
        charge_status: mappedStatus,
        stripe_payment_intent_id: stripeResult.id,
        updated_at: new Date().toISOString(),
        metadata: {
          ...(decisionResult as any).metadata,
          stripe_payment_intent_status: stripeResult.status,
          charge_attempt_error: stripeResult.errorMessage || null
        }
      })
      .eq('id', chargeRequestId)

    await (supabase.from('payments') as any).insert({
      table_booking_id: tableBookingId,
      charge_type: paymentChargeType,
      stripe_payment_intent_id: stripeResult.id,
      amount,
      currency,
      status: mappedStatus,
      metadata: {
        charge_request_id: chargeRequestId,
        charge_type: type,
        payment_kind: 'approved_charge',
        stripe_payment_intent_status: stripeResult.status,
        charge_attempt_error: stripeResult.errorMessage || null
      }
    })

    if (mappedStatus === 'succeeded') {
      await recordAnalyticsEvent(supabase, {
        customerId,
        tableBookingId,
        eventType: 'charge_succeeded',
        metadata: {
          charge_request_id: chargeRequestId,
          stripe_payment_intent_id: stripeResult.id,
          amount,
          currency,
          charge_type: type
        }
      })
    } else if (mappedStatus === 'failed') {
      await recordAnalyticsEvent(supabase, {
        customerId,
        tableBookingId,
        eventType: 'charge_failed',
        metadata: {
          charge_request_id: chargeRequestId,
          stripe_payment_intent_id: stripeResult.id,
          amount,
          currency,
          charge_type: type,
          reason: stripeResult.errorMessage || 'payment_intent_failed'
        }
      })
    }

    return {
      status: mappedStatus,
      stripePaymentIntentId: stripeResult.id,
      amount,
      currency,
      errorMessage: stripeResult.errorMessage || undefined
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Charge attempt failed'

    logger.error('Failed to execute approved charge request', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        chargeRequestId,
        tableBookingId
      }
    })

    await (supabase.from('charge_requests') as any)
      .update({
        charge_status: 'failed',
        updated_at: new Date().toISOString(),
        metadata: {
          ...(decisionResult as any).metadata,
          charge_attempt_error: message
        }
      })
      .eq('id', chargeRequestId)

    await (supabase.from('payments') as any).insert({
      table_booking_id: tableBookingId,
      charge_type: paymentChargeType,
      amount,
      currency,
      status: 'failed',
      metadata: {
        charge_request_id: chargeRequestId,
        charge_type: type,
        payment_kind: 'approved_charge',
        reason: message
      }
    })

    await recordAnalyticsEvent(supabase, {
      customerId,
      tableBookingId,
      eventType: 'charge_failed',
      metadata: {
        charge_request_id: chargeRequestId,
        amount,
        currency,
        charge_type: type,
        reason: message
      }
    })

    return {
      status: 'failed',
      stripePaymentIntentId: null,
      amount,
      currency,
      errorMessage: message
    }
  }
}
