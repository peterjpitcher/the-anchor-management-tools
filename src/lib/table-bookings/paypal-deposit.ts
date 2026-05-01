import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import {
  sendManagerTableBookingCreatedEmailIfAllowed,
  sendTableBookingConfirmedAfterDepositSmsIfAllowed,
} from '@/lib/table-bookings/bookings'

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
  const rawValue = (order as any)?.purchase_units?.[0]?.amount?.value
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
    hold_expires_at: null,
  }
}

export async function sendTableBookingDepositCapturedNotifications(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    tableBookingId: string
    customerId?: string | null
    createdVia: string
  },
): Promise<void> {
  const tasks: Promise<unknown>[] = []

  if (input.customerId) {
    tasks.push(sendTableBookingConfirmedAfterDepositSmsIfAllowed(supabase, input.tableBookingId))
    tasks.push(
      sendManagerTableBookingCreatedEmailIfAllowed(supabase, {
        tableBookingId: input.tableBookingId,
        fallbackCustomerId: input.customerId,
        createdVia: input.createdVia,
      }),
    )
  }

  const outcomes = await Promise.allSettled(tasks)
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      logger.warn('Table booking post-deposit notification task failed', {
        metadata: {
          tableBookingId: input.tableBookingId,
          taskIndex: index,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        },
      })
    }
  })
}
