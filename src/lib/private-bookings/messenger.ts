import { logger } from '@/lib/logger'
import { SmsQueueService, shouldAutoSendPrivateBookingSms, type QueueSmsInput } from '@/services/sms-queue'
import {
  attemptPrivateBookingEmail,
  finishPrivateBookingEmailFirstDelivery,
  isPrivateBookingEmailFirstOn,
} from '@/lib/private-bookings/email-first'
import type { PrivateBookingEmailContent } from '@/lib/email/private-booking-emails'
import type { FallbackBookingFacts } from '@/lib/notifications/delayed-fallback/types'

type QueueAndSendResult = Awaited<ReturnType<typeof SmsQueueService.queueAndSend>>

/**
 * What a private booking message send returns: the text queue's result, as callers have always
 * read it, plus which channel reached the guest. An email that went reports `sent: true`.
 */
export type PrivateBookingMessageResult = QueueAndSendResult & {
  channel?: 'email' | 'sms' | null
  emailError?: string | null
}

export type SendPrivateBookingMessageInput = {
  /** Exactly what the caller passed to SmsQueueService.queueAndSend before email first. */
  sms: QueueSmsInput
  booking: { id: string; customer_id?: string | null; contact_email?: string | null }
  /**
   * Builds the email version, from the same values as `sms.message_body`. Null when this message
   * has no email version, in which case it goes by text as before.
   */
  email: (() => PrivateBookingEmailContent) | null
  /** One email per booking, trigger and window (for example the hold expiry date of a reminder). */
  windowKey: string
  /** The facts the message states, kept so a later bounce can tell whether the booking changed. */
  facts?: FallbackBookingFacts
  /**
   * For a path that has always sent its email straight away alongside a text that waits for
   * approval (cancelBooking): the email still goes now, and the text is queued for approval only
   * if the email does not go.
   */
  emailEvenWhenTextNeedsApproval?: boolean
}

/**
 * The one way an automated private booking message leaves the system (P6).
 *
 * With the flag private_booking_email_first off, this is SmsQueueService.queueAndSend and nothing
 * else: same arguments, same result.
 *
 * With it on:
 * - A trigger that waits for staff approval still queues its text for approval; the channel is
 *   chosen when staff press Send Now (sms-queue.ts sendApprovedSms).
 * - Otherwise, if the booking has a usable address (its contact email, then the customer's), the
 *   email goes and no text is queued.
 * - If the email fails, the text goes through the queue in the same call, and both attempts are
 *   recorded. If that fails too, the message is listed as undelivered and staff are alerted.
 * - With no usable address, the text goes exactly as before.
 */
export async function sendPrivateBookingMessage(input: SendPrivateBookingMessageInput): Promise<PrivateBookingMessageResult> {
  if (!(await isPrivateBookingEmailFirstOn())) {
    return SmsQueueService.queueAndSend(input.sms)
  }

  const textNeedsApproval = !shouldAutoSendPrivateBookingSms(input.sms.trigger_type)
  if ((textNeedsApproval && !input.emailEvenWhenTextNeedsApproval) || !input.email) {
    return SmsQueueService.queueAndSend(input.sms)
  }

  let content: PrivateBookingEmailContent
  try {
    content = input.email()
  } catch (error) {
    logger.error('Private booking email could not be built; sending the text instead', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.booking.id, templateKey: input.sms.template_key },
    })
    return SmsQueueService.queueAndSend(input.sms)
  }

  const attempt = await attemptPrivateBookingEmail({
    booking: input.booking,
    templateKey: input.sms.template_key,
    triggerType: input.sms.trigger_type,
    content,
    windowKey: input.windowKey,
    facts: input.facts,
    performedBy: input.sms.created_by ?? null,
  })

  if (attempt.status === 'no_usable_address') {
    return SmsQueueService.queueAndSend(input.sms)
  }

  if (attempt.status === 'sent') {
    return { success: true, sent: true, channel: 'email' } as PrivateBookingMessageResult
  }

  let smsResult: QueueAndSendResult
  try {
    smsResult = await SmsQueueService.queueAndSend(input.sms)
  } catch (error) {
    smsResult = { error: error instanceof Error ? error.message : String(error) } as QueueAndSendResult
  }

  const record = smsResult as Record<string, unknown>
  if (record.requiresApproval === true) {
    // The text now waits for staff, as it always has, and Send Now chooses the channel again.
    // Nothing has failed for good, so the delivery is left open rather than marked undelivered.
    return { ...smsResult, channel: null, emailError: attempt.error } as PrivateBookingMessageResult
  }

  const smsReached = record.sent === true || record.suppressed === true
  await finishPrivateBookingEmailFirstDelivery({
    deliveryId: attempt.deliveryId,
    bookingId: input.booking.id,
    templateKey: input.sms.template_key,
    sms: {
      sent: smsReached,
      error: typeof record.error === 'string' ? record.error : null,
      sid: typeof record.sid === 'string' ? record.sid : null,
      queueId: typeof record.queueId === 'string' ? record.queueId : null,
    },
  })

  return { ...smsResult, channel: smsReached ? 'sms' : null, emailError: attempt.error } as PrivateBookingMessageResult
}
