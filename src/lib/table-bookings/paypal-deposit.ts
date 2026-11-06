import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { sendTableBookingDepositConfirmation } from '@/lib/table-bookings/bookings'

export type PayPalDepositCaptureBooking = {
  id: string
  status: string | null
  payment_status: string | null
  hold_expires_at?: string | null
  paypal_deposit_order_id?: string | null
  paypal_deposit_capture_id?: string | null
  customer_id?: string | null
}

export type PayPalDepositCaptureBlockReason =
  | 'already_completed'
  | 'booking_not_pending_payment'
  | 'booking_closed'
  | 'hold_missing'
  | 'hold_expired'

const CLOSED_CAPTURE_STATUSES = new Set(['cancelled', 'no_show', 'completed'])

export function parsePayPalAmountGbp(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Number(parsed.toFixed(2))
}

export function extractPayPalOrderAmountGbp(order: unknown): number | null {
  const amount = (order as any)?.purchase_units?.[0]?.amount
  const currencyCode = typeof amount?.currency_code === 'string'
    ? amount.currency_code.trim().toUpperCase()
    : null
  if (currencyCode !== 'GBP') return null
  const rawValue = amount?.value
  return parsePayPalAmountGbp(rawValue)
}

export function payPalAmountsMatch(a: number, b: number): boolean {
  return Math.abs(Number(a.toFixed(2)) - Number(b.toFixed(2))) < 0.01
}

export function getPayPalDepositCaptureBlockReason(
  booking: PayPalDepositCaptureBooking,
  now: Date = new Date(),
): PayPalDepositCaptureBlockReason | null {
  if (booking.payment_status === 'completed' || booking.paypal_deposit_capture_id) {
    return 'already_completed'
  }

  const status = booking.status || ''
  if (CLOSED_CAPTURE_STATUSES.has(status)) {
    return 'booking_closed'
  }

  const awaitingPayment = status === 'pending_payment' || booking.payment_status === 'pending'
  if (!awaitingPayment) {
    return 'booking_not_pending_payment'
  }

  if (!booking.hold_expires_at) {
    return 'hold_missing'
  }

  const holdExpiry = new Date(booking.hold_expires_at)
  if (!Number.isFinite(holdExpiry.getTime()) || holdExpiry.getTime() <= now.getTime()) {
    return 'hold_expired'
  }

  return null
}

export function payPalDepositCaptureBlockMessage(reason: PayPalDepositCaptureBlockReason): string {
  switch (reason) {
    case 'already_completed':
      return 'Deposit has already been paid for this booking.'
    case 'booking_closed':
      return 'This booking is no longer payable.'
    case 'hold_expired':
      return 'This payment link has expired.'
    case 'hold_missing':
      return 'This booking is missing a valid payment hold.'
    case 'booking_not_pending_payment':
    default:
      return 'This booking is not awaiting deposit payment.'
  }
}

/**
 * A stable code for each reason a deposit cannot be paid, to go beside the
 * sentence. The website matches on the code; the sentence can then be reworded
 * without breaking it.
 */
export function payPalDepositCaptureBlockCode(reason: PayPalDepositCaptureBlockReason): string {
  switch (reason) {
    case 'already_completed':
      return 'DEPOSIT_ALREADY_PAID'
    case 'booking_closed':
      return 'BOOKING_NOT_PAYABLE'
    case 'hold_expired':
      return 'PAYMENT_HOLD_EXPIRED'
    case 'hold_missing':
      return 'PAYMENT_HOLD_MISSING'
    case 'booking_not_pending_payment':
    default:
      return 'BOOKING_NOT_PENDING_PAYMENT'
  }
}

export function buildPayPalDepositCompletedUpdate(
  input: {
    captureId: string
    lockedAmountGbp: number
    capturedAtIso?: string
  }
): Record<string, unknown> {
  const capturedAtIso = input.capturedAtIso || new Date().toISOString()
  return {
    payment_status: 'completed',
    status: 'confirmed',
    payment_method: 'paypal',
    paypal_deposit_capture_id: input.captureId,
    deposit_amount_locked: input.lockedAmountGbp,
    card_capture_completed_at: capturedAtIso,
    // `status` and `confirmed_at` are a pair, and nothing in the database keeps
    // them together. This writer set the status and not the timestamp, so every
    // PayPal-paid booking read as confirmed with a blank Confirmed time on the
    // detail screen, permanently: the only other writer of confirmed_at is a
    // cron that never looks at these rows.
    confirmed_at: capturedAtIso,
    hold_expires_at: null,
  }
}

/**
 * Tells the guest their deposit is in. Answers with the channel that reached them, or null when
 * none is known to have, so the payment page can name the real channel (R11). Never throws: a
 * failed send is logged and audited by the sender, and the payment page then promises nothing.
 */
export async function sendTableBookingDepositCapturedNotifications(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    tableBookingId: string
    customerId?: string | null
    createdVia: string
  },
): Promise<{ confirmationChannel: 'email' | 'sms' | null }> {
  if (!input.customerId) return { confirmationChannel: null }

  try {
    const result = await sendTableBookingDepositConfirmation(supabase, input.tableBookingId)
    return { confirmationChannel: result.channel }
  } catch (error) {
    // An error, not a warning: warnings are silent in production, and this guest has paid and may
    // have heard nothing.
    logger.error('Table booking post-deposit notification task failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: input.tableBookingId, createdVia: input.createdVia },
    })
    return { confirmationChannel: null }
  }
}
