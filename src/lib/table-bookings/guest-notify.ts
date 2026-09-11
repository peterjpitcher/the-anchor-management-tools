/**
 * Email first, text as the fallback, for the table booking messages the owner moved on
 * 11 September 2026. Every path behind a `table_*_email_first` messaging flag sends through here,
 * so they all get the same channel rules, the same audit row and the same answer for staff.
 *
 * - Email goes first when the guest has a usable address (well formed, not invalid, bounced,
 *   complained, deactivated or suppressed).
 * - A text goes when there is no usable address, or when the email fails in the same attempt.
 *   The text carries `table_booking_id` and the template key, so SMS duplicate protection is per
 *   booking and SUSPEND_EVENT_SMS still applies to it.
 * - `delayedFallbackAllowed` marks the delivery so a later bounce can fall back to a text (P4). The
 *   delivery row is written with the booking id, the message, the facts it states and how its link
 *   was made (fallback-details.ts), so the fallback can rebuild the same text from the booking.
 * - The email carries a stable idempotency key, so a retried call cannot deliver it twice.
 * - Every outcome writes `table_booking.notification_sent` or `table_booking.notification_failed`
 *   to the audit log, and the caller gets an outcome it can show to staff.
 *
 * Never throws: a messaging failure must not undo the booking change that triggered it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyCustomer, type NotifyCustomerResult } from '@/lib/notifications/notify'
import { AuditService } from '@/services/audit'
import { logger } from '@/lib/logger'
import type { TableBookingEmail } from '@/lib/table-bookings/guest-emails'
import type { GuestNotificationOutcome } from '@/lib/table-bookings/guest-notification-outcome'
import {
  buildTableBookingDeliveryMetadata,
  type TableBookingFallbackDetails,
} from '@/lib/table-bookings/fallback-details'

/** The customer columns the channel rules read. */
export const GUEST_CHANNEL_COLUMNS =
  'id, first_name, last_name, mobile_e164, mobile_number, email, sms_status, sms_opt_in, marketing_sms_opt_in, email_status, email_deactivated_at, marketing_email_opt_in'

export type GuestChannelCustomer = {
  id: string
  first_name: string | null
  last_name?: string | null
  mobile_e164: string | null
  mobile_number: string | null
  email: string | null
  sms_status?: string | null
  sms_opt_in?: boolean | null
  marketing_sms_opt_in?: boolean | null
  email_status?: string | null
  email_deactivated_at?: string | null
  marketing_email_opt_in?: boolean | null
}

export type TableBookingGuestNotifyInput = {
  supabase: SupabaseClient<any, 'public', any>
  /** Also the email's comm_type and the text's template_key. */
  templateKey: string
  tableBookingId: string
  customer: GuestChannelCustomer
  email: TableBookingEmail
  sms: {
    /** Defaults to the customer's mobile. */
    to?: string | null
    body: string
    /** Extra metadata for the text; table_booking_id and template_key are always added. */
    metadata?: Record<string, unknown>
  }
  /** Stable for this booking and message, e.g. `table_booking_cancelled:{bookingId}`. */
  idempotencyKey: string
  /** Extra facts for the audit row. */
  auditContext?: Record<string, unknown>
  /**
   * What the bounce fallback needs to rebuild this text later: which message it is, the facts it
   * states and how its link was made. Required, because every message sent here allows a later
   * text and the fallback can only rebuild what was recorded.
   */
  fallback: TableBookingFallbackDetails
}

/**
 * The number a table booking text goes to: the one the caller named, else the customer's mobile.
 * Settled exactly as notifyTableBookingGuestEmailFirst hands it over and notifyCustomer then
 * resolves it, so the bounce fallback texts the number the original text would have gone to.
 */
export function resolveTableBookingGuestSmsTo(
  customer: Pick<GuestChannelCustomer, 'mobile_e164' | 'mobile_number'>,
  requested: string | null | undefined
): string | null {
  const handedOver = requested ?? customer.mobile_number ?? customer.mobile_e164 ?? null
  return handedOver || customer.mobile_e164 || customer.mobile_number || null
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unknown error'
}

async function writeAudit(
  input: TableBookingGuestNotifyInput,
  outcome: GuestNotificationOutcome,
  details: Record<string, unknown>
): Promise<void> {
  const delivered = outcome.status === 'sent' || outcome.status === 'already_sent'
  await AuditService.logAuditEvent({
    operation_type: delivered ? 'table_booking.notification_sent' : 'table_booking.notification_failed',
    resource_type: 'table_booking',
    resource_id: input.tableBookingId,
    operation_status: delivered ? 'success' : 'failure',
    error_message: delivered ? undefined : outcome.error ?? undefined,
    additional_info: {
      comm_type: input.templateKey,
      customer_id: input.customer.id,
      channel_policy: 'email_first',
      outcome: outcome.status,
      sent_channel: outcome.channel,
      fallback_used: outcome.fallbackUsed,
      ...details,
      ...(input.auditContext ?? {}),
    },
  })
}

/** Turns notifyCustomer's attempts into the outcome staff see. */
export function summariseGuestNotification(result: NotifyCustomerResult): {
  outcome: GuestNotificationOutcome
  details: Record<string, unknown>
} {
  const emailAttempt = result.attempts.find((attempt) => attempt.channel === 'email') ?? null
  const smsAttempt = result.attempts.find((attempt) => attempt.channel === 'sms') ?? null

  // A text that went out but whose log row failed still reached the guest, as the booking
  // creation path already treats it.
  const smsDelivered = Boolean(
    smsAttempt && (smsAttempt.success || smsAttempt.logFailure === true || smsAttempt.code === 'logging_failed')
  )
  const emailDelivered = emailAttempt?.success === true

  let outcome: GuestNotificationOutcome
  if (result.finalStatus === 'no_channel') {
    outcome = {
      status: 'no_channel',
      channel: null,
      fallbackUsed: false,
      error: result.noChannelReason ?? 'no_channel_available',
    }
  } else if (emailDelivered || smsDelivered || result.finalStatus === 'sent') {
    const channel = result.sentChannel ?? (emailDelivered ? 'email' : smsDelivered ? 'sms' : null)
    outcome = {
      status: 'sent',
      channel,
      fallbackUsed: result.fallbackUsed || (channel === 'sms' && Boolean(emailAttempt)),
      error: null,
    }
  } else {
    const lastAttempt = result.attempts[result.attempts.length - 1]
    outcome = {
      status: 'failed',
      channel: null,
      fallbackUsed: false,
      error: lastAttempt?.error ?? lastAttempt?.code ?? 'Every channel failed',
    }
  }

  return {
    outcome,
    details: {
      selected_channels: result.selectedChannels,
      email_sent: emailDelivered,
      email_error: emailAttempt && !emailAttempt.success ? emailAttempt.error ?? emailAttempt.code ?? null : null,
      sms_sent: smsDelivered,
      sms_code: smsAttempt?.code ?? null,
      sms_error: smsAttempt && !smsDelivered ? smsAttempt.error ?? null : null,
    },
  }
}

export async function notifyTableBookingGuestEmailFirst(
  input: TableBookingGuestNotifyInput
): Promise<GuestNotificationOutcome> {
  let result: NotifyCustomerResult
  try {
    result = await notifyCustomer({
      supabase: input.supabase,
      customerId: input.customer.id,
      customer: input.customer,
      policy: 'email_first',
      urgency: 'standard',
      category: 'transactional',
      delayedFallbackAllowed: true,
      deliveryMetadata: buildTableBookingDeliveryMetadata({
        tableBookingId: input.tableBookingId,
        templateKey: input.templateKey,
        fallback: input.fallback,
      }),
      email: {
        to: input.customer.email,
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
        commType: input.templateKey,
        customerId: input.customer.id,
        tableBookingId: input.tableBookingId,
        idempotencyKey: input.idempotencyKey,
        metadata: {
          table_booking_id: input.tableBookingId,
          template_key: input.templateKey,
          channel_policy: 'email_first',
        },
      },
      sms: {
        to: resolveTableBookingGuestSmsTo(input.customer, input.sms.to),
        body: input.sms.body,
        options: {
          customerId: input.customer.id,
          metadata: {
            ...(input.sms.metadata ?? {}),
            table_booking_id: input.tableBookingId,
            template_key: input.templateKey,
          },
        },
      },
    })
  } catch (error) {
    const message = describeError(error)
    logger.error('Table booking guest notification threw', {
      error: error instanceof Error ? error : new Error(message),
      metadata: { tableBookingId: input.tableBookingId, templateKey: input.templateKey },
    })
    const outcome: GuestNotificationOutcome = { status: 'failed', channel: null, fallbackUsed: false, error: message }
    await writeAudit(input, outcome, { threw: true })
    return outcome
  }

  const { outcome, details } = summariseGuestNotification(result)

  if (outcome.status === 'failed' || outcome.status === 'no_channel') {
    // logger.error so it reaches the production logs; the audit row is what staff can find.
    logger.error('Table booking guest notification did not reach the guest', {
      metadata: {
        tableBookingId: input.tableBookingId,
        templateKey: input.templateKey,
        outcome: outcome.status,
        error: outcome.error,
        emailError: details.email_error,
        smsCode: details.sms_code,
      },
    })
  }

  await writeAudit(input, outcome, details)
  return outcome
}
