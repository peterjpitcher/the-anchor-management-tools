import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { renderPrivateBookingMessage } from '@/lib/private-bookings/message-catalogue'
import { cancellationFromQueueMetadata, loadPrivateBookingMessageContext } from '@/lib/private-bookings/message-context'
import { attemptPrivateBookingEmail, isPrivateBookingEmailFirstOn } from '@/lib/private-bookings/email-first'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { isBalanceReminderTrigger } from '@/lib/private-bookings/balance-reminders'

export type ApprovedMessageEmailOutcome =
  | { status: 'sent'; deliveryId: string | null }
  | { status: 'not_attempted'; reason: string }
  | { status: 'failed'; deliveryId: string | null; error: string }

type ApprovedQueueRow = {
  id: string
  booking_id: string
  trigger_type: string | null
  template_key: string | null
  message_body: string
  metadata: Record<string, unknown> | null
}

/**
 * Send Now for a text that waited for approval (P6, decision A11): the approval step stays, and
 * the channel is chosen now, with the same rule as the automated messages.
 *
 * The email goes only when rebuilding the text from the booking as it is now gives exactly the
 * text staff approved. Then the email states the same facts. If anything moved since the text was
 * queued, or the message has no email version, or the booking has no usable address, the approved
 * text goes as it always has.
 */
export async function tryEmailForApprovedPrivateBookingText(input: {
  row: ApprovedQueueRow
  performedBy: string | null
  now?: Date
}): Promise<ApprovedMessageEmailOutcome> {
  if (!(await isPrivateBookingEmailFirstOn())) {
    return { status: 'not_attempted', reason: 'flag_off' }
  }

  const triggerType = input.row.trigger_type?.trim()
  const templateKey = input.row.template_key?.trim()
  if (!triggerType || !templateKey) {
    return { status: 'not_attempted', reason: 'no_trigger' }
  }

  try {
    const client = createAdminClient()
    // Balance reminder emails list the payments made while private_booking_balance_email_auto is
    // on; if those cannot be read the approved text goes instead (the context says so).
    const withPaymentStatement =
      isBalanceReminderTrigger(triggerType) && (await isMessagingFlagOn('private_booking_balance_email_auto'))
    const context = await loadPrivateBookingMessageContext({
      client,
      bookingId: input.row.booking_id,
      triggerType,
      now: input.now ?? new Date(),
      cancellation: cancellationFromQueueMetadata(input.row.metadata),
      withPaymentStatement,
    })
    if (!context) {
      return { status: 'not_attempted', reason: 'booking_unavailable' }
    }

    const message = renderPrivateBookingMessage(triggerType, context)
    if (!message?.email) {
      return { status: 'not_attempted', reason: 'no_email_version' }
    }
    if (message.smsBody !== input.row.message_body) {
      return { status: 'not_attempted', reason: 'queued_text_differs' }
    }

    const attempt = await attemptPrivateBookingEmail({
      booking: context.booking,
      templateKey,
      triggerType,
      content: message.email(),
      windowKey: `queue-${input.row.id}`,
      facts: message.facts,
      performedBy: input.performedBy,
      client,
    })

    if (attempt.status === 'no_usable_address') {
      return { status: 'not_attempted', reason: attempt.reason }
    }
    if (attempt.status === 'sent') {
      return { status: 'sent', deliveryId: attempt.deliveryId }
    }
    return { status: 'failed', deliveryId: attempt.deliveryId, error: attempt.error }
  } catch (error) {
    logger.error('Approved private booking text: email attempt failed unexpectedly; sending the text', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { queueId: input.row.id, bookingId: input.row.booking_id },
    })
    return { status: 'not_attempted', reason: 'email_attempt_error' }
  }
}
