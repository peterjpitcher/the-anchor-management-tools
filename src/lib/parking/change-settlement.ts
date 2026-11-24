import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { settleWrite } from '@/lib/supabase/settle-write'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import { customerMessagePayload, parkingChangeEmail, sendParkingCustomerMessage } from '@/lib/parking/customer-message'
import { buildBookingChangedSms, type ParkingChangeOutcome, type ParkingNotificationBooking } from '@/lib/parking/notifications'
import { allocateRefund, roundPence, type RefundablePayment } from '@/lib/parking/balance'
import { changeRefundKey, refundsThroughPayPal } from '@/lib/parking/change-dates'
import { processManualRefund, processPayPalRefund } from '@/app/actions/refundActions'

type GenericClient = SupabaseClient<any, 'public', any>

export type ParkingChangeTextStatus = 'sent' | 'held' | 'skipped' | 'failed'

export interface ParkingChangeTextResult {
  status: ParkingChangeTextStatus
  /** Plain words for staff when the customer was not told, or will be told later. */
  note: string | null
  body: string
  /** How the customer was told: email first, a text when there is no usable email. */
  channel?: 'email' | 'sms' | null
}

/**
 * Tells the customer about the change, by email when they have a usable address and by text
 * otherwise (owner, 24 November 2026), and records it on the change's marker row (a
 * `booking_changed` notification). Goes through notifyCustomer, so the suppression list, the
 * SMS opt-out, quiet hours, limits and kill switches all apply. Never throws.
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
  const email = parkingChangeEmail(booking, outcome)

  const record = async (status: string, extra: Record<string, unknown>, channel: 'email' | 'sms' | null) => {
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
            ...(channel ? { channel } : {}),
            ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
            ...(typeof extra.message_sid === 'string' ? { message_sid: extra.message_sid } : {}),
            payload: { ...((existing?.payload as Record<string, unknown> | null) ?? {}), ...extra },
          })
          .eq('id', markerId),
        { table: 'parking_booking_notifications', what: 'Recording the parking change message', ids: { bookingId: booking.id, changeId } }
      )
    } catch (error) {
      logger.error('Failed to record the parking change message', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId: booking.id, changeId },
      })
    }
  }

  const result = await sendParkingCustomerMessage({
    client,
    booking,
    eventType: 'booking_changed',
    templateKey: 'parking_booking_changed',
    email,
    smsBody: body,
    dedupe: { change_id: changeId },
  })
  const payload = customerMessagePayload(result, email, body)
  const by = result.channel === 'email' ? 'emailed' : 'texted'

  if (result.status === 'skipped') {
    await record('skipped', payload, null)
    return { status: 'skipped', note: 'The booking has no email address and no mobile number we can text, so the customer was not told.', body, channel: result.channel }
  }
  if (result.status === 'failed') {
    await record('failed', payload, result.channel)
    const suspended = result.code === 'sms_suspended' || result.code === 'email_suspended'
    return {
      status: 'failed',
      note: suspended
        ? 'Customer messages are switched off at the moment, so the customer was not told.'
        : 'The message to the customer did not send, so they have not been told.',
      body,
      channel: result.channel,
    }
  }
  if (result.status === 'held' && result.scheduledFor) {
    await record('sent', { ...payload, message_sid: result.messageId }, 'sms')
    return {
      status: 'held',
      note: `It is quiet hours, so the text to the customer will go at ${formatDateTimeInLondon(result.scheduledFor, {
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      })}.`,
      body,
      channel: result.channel,
    }
  }
  await record('sent', { ...payload, ...(result.channel === 'sms' ? { message_sid: result.messageId } : {}) }, result.channel)
  return { status: 'sent', note: result.fallbackUsed ? `The email did not send, so the customer was ${by} instead.` : null, body, channel: result.channel }
}

export interface ParkingRefundOutcome {
  /** What went back (completed or pending at PayPal), in pounds. */
  refunded: number
  /** True when at least part went back through PayPal (so "refunding to the way you paid" holds). */
  viaPayPal: boolean
  /**
   * The part that went back through PayPal. Only this may be named in the text as "refunding to the
   * way you paid": a part refunded by cash or bank transfer is handed over by staff, not sent back.
   */
  refundedViaPayPal: number
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
  let refundedViaPayPal = 0
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
        if (paypal) {
          viaPayPal = true
          refundedViaPayPal = roundPence(refundedViaPayPal + allocation.amount)
        }
      } else {
        failures.push(`The £${allocation.amount.toFixed(2)} refund did not go through: ${result.error ?? 'unknown error'}.`)
      }
    } catch (error) {
      failures.push(
        `The £${allocation.amount.toFixed(2)} refund did not go through: ${error instanceof Error ? error.message : String(error)}.`
      )
    }
  }

  return { refunded, viaPayPal, refundedViaPayPal, complete: failures.length === 0 && refunded >= roundPence(input.amount), failures }
}
