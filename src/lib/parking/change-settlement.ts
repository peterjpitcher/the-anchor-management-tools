import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'
import { settleWrite } from '@/lib/supabase/settle-write'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import { resolveParkingSmsEligibility } from '@/lib/parking/sms-safety'
import { buildBookingChangedSms, type ParkingChangeOutcome, type ParkingNotificationBooking } from '@/lib/parking/notifications'
import { allocateRefund, roundPence, type RefundablePayment } from '@/lib/parking/balance'
import { changeRefundKey, refundsThroughPayPal } from '@/lib/parking/change-dates'
import { processManualRefund, processPayPalRefund } from '@/app/actions/refundActions'

type GenericClient = SupabaseClient<any, 'public', any>

export type ParkingChangeTextStatus = 'sent' | 'held' | 'skipped' | 'failed'

export interface ParkingChangeTextResult {
  status: ParkingChangeTextStatus
  /** Plain words for staff when the customer was not texted, or was texted later. */
  note: string | null
  body: string
}

/**
 * Sends the one change text and records it on the change's marker row (a `booking_changed`
 * notification). Goes through sendSMS, so the opt-out, quiet hours, limits and kill switches all
 * apply exactly as for every other parking text. Never throws.
 */
export async function sendParkingChangeText(input: {
  client: GenericClient
  booking: ParkingNotificationBooking
  outcome: ParkingChangeOutcome
  changeId: string
  markerId: string | null
}): Promise<ParkingChangeTextResult> {
  const { client, booking, outcome, changeId, markerId } = input
  const body = buildBookingChangedSms(booking, outcome)

  const record = async (status: string, extra: Record<string, unknown>) => {
    if (!markerId) return
    try {
      const { data: existing } = await client
        .from('parking_booking_notifications')
        .select('payload')
        .eq('id', markerId)
        .maybeSingle()
      await settleWrite(
        client
          .from('parking_booking_notifications')
          .update({
            status,
            ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
            ...(typeof extra.message_sid === 'string' ? { message_sid: extra.message_sid } : {}),
            payload: { ...((existing?.payload as Record<string, unknown> | null) ?? {}), sms: body, ...extra },
          })
          .eq('id', markerId),
        { table: 'parking_booking_notifications', what: 'Recording the parking change text', ids: { bookingId: booking.id, changeId } }
      )
    } catch (error) {
      logger.error('Failed to record the parking change text', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId: booking.id, changeId },
      })
    }
  }

  if (!booking.customer_mobile) {
    await record('skipped', { reason: 'No customer mobile number on booking' })
    return { status: 'skipped', note: 'The booking has no mobile number, so the customer was not texted.', body }
  }

  if (booking.customer_id) {
    const eligibility = await resolveParkingSmsEligibility(client, booking.customer_id)
    if (!eligibility.allowed) {
      const reason = eligibility.reason === 'customer_opted_out' ? 'Customer has opted out of SMS' : 'Customer SMS eligibility lookup failed'
      await record('skipped', { reason })
      return {
        status: 'skipped',
        note:
          eligibility.reason === 'customer_opted_out'
            ? 'The customer has opted out of texts, so they were not told.'
            : 'The customer could not be texted (their text preference could not be read).',
        body,
      }
    }
  }

  try {
    const result = await sendSMS(booking.customer_mobile, body, {
      customerId: booking.customer_id ?? undefined,
      metadata: {
        parking_booking_id: booking.id,
        event_type: 'booking_changed',
        template_key: 'parking_booking_changed',
        change_id: changeId,
      },
      customerFallback: { email: booking.customer_email ?? undefined },
    })
    const sid = typeof (result as { sid?: unknown }).sid === 'string' ? (result as { sid: string }).sid : null
    if (!result.success) {
      const code = typeof (result as { code?: unknown }).code === 'string' ? (result as { code: string }).code : null
      await record('failed', { sms_code: code, error: (result as { error?: unknown }).error ?? null })
      const suspended = code === 'sms_suspended'
      return {
        status: 'failed',
        note: suspended
          ? 'Texts are switched off at the moment, so the customer was not told.'
          : 'The text to the customer did not send, so they have not been told.',
        body,
      }
    }
    const scheduledFor = (result as { scheduledFor?: unknown }).scheduledFor
    if ((result as { deferred?: unknown }).deferred === true && typeof scheduledFor === 'string') {
      await record('sent', { message_sid: sid, deferred: true, scheduled_for: scheduledFor })
      return {
        status: 'held',
        note: `It is quiet hours, so the text to the customer will go at ${formatDateTimeInLondon(scheduledFor, {
          hour: '2-digit',
          minute: '2-digit',
          day: 'numeric',
          month: 'short',
        })}.`,
        body,
      }
    }
    await record('sent', { message_sid: sid })
    return { status: 'sent', note: null, body }
  } catch (error) {
    logger.error('Unexpected error sending the parking change text', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: booking.id, changeId },
    })
    await record('failed', { error: error instanceof Error ? error.message : String(error) })
    return { status: 'failed', note: 'The text to the customer did not send, so they have not been told.', body }
  }
}

export interface ParkingRefundOutcome {
  /** What went back (completed or pending at PayPal), in pounds. */
  refunded: number
  /** True when at least part went back through PayPal (so "refunding to the way you paid" holds). */
  viaPayPal: boolean
  /** True when every penny asked for was refunded. */
  complete: boolean
  /** Plain words for staff about anything that did not go through. */
  failures: string[]
}

/**
 * Sends a refund for a parking booking across its paid payments, newest first, through the shared
 * refund code (processPayPalRefund or processManualRefund: never PayPal directly). Each refund is
 * keyed on the operation id plus the payment id, so a retry replays rather than repeats, and the
 * shared code's own customer message is suppressed when the caller sends its own.
 */
export async function refundParkingBooking(input: {
  payments: RefundablePayment[]
  amount: number
  reason: string
  operationId: string
  manualMethod: 'cash' | 'bank_transfer'
  skipCustomerNotification: boolean
  now?: Date
}): Promise<ParkingRefundOutcome> {
  const now = input.now ?? new Date()
  const { allocations, unallocated } = allocateRefund(input.amount, input.payments)
  const failures: string[] = []
  let refunded = 0
  let viaPayPal = false

  if (unallocated > 0) {
    failures.push(`£${unallocated.toFixed(2)} is more than is left to refund on this booking.`)
  }

  for (const allocation of allocations) {
    const options = {
      requestKey: changeRefundKey(input.operationId, allocation.payment.id),
      skipCustomerNotification: input.skipCustomerNotification,
    }
    try {
      const paypal = refundsThroughPayPal(allocation.payment, now)
      const result = paypal
        ? await processPayPalRefund('parking', allocation.payment.id, allocation.amount, input.reason, options)
        : await processManualRefund('parking', allocation.payment.id, allocation.amount, input.reason, input.manualMethod, options)
      if (result.success) {
        refunded = roundPence(refunded + allocation.amount)
        if (paypal) viaPayPal = true
      } else {
        failures.push(`The £${allocation.amount.toFixed(2)} refund did not go through: ${result.error ?? 'unknown error'}.`)
      }
    } catch (error) {
      failures.push(
        `The £${allocation.amount.toFixed(2)} refund did not go through: ${error instanceof Error ? error.message : String(error)}.`
      )
    }
  }

  return { refunded, viaPayPal, complete: failures.length === 0 && refunded >= roundPence(input.amount), failures }
}
