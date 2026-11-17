import { createHash } from 'crypto'
import { logger } from '@/lib/logger'
import { maskPhone } from '@/lib/phone/mask'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'

/**
 * A text to a member of staff, not to a customer.
 *
 * It goes through sendSMS, so every kill switch (SUSPEND_ALL_COMMS, SUSPEND_ALL_SMS) and the
 * hourly safety limits apply, and the SMS idempotency claim (template key, booking and number)
 * stops a second copy. Two options keep it off the customer side: createCustomerIfMissing: false,
 * so no customer record is made for a staff number, and skipMessageLogging: true, so it never
 * lands in a customer's message history (the messages table needs a customer).
 *
 * Quiet hours (21:00 to 09:00 London) apply too, but sendSMS cannot hold a text that has no
 * customer: its own queue refuses one, and Twilio's scheduler needs a messaging service and at
 * least 15 minutes' notice, so an alert at 08:50 would simply be lost. So inside quiet hours this
 * puts the alert on the job queue as a send_staff_alert_sms job for 09:00, and the job calls
 * back in here when it runs. Kill switches are read when the text is actually sent.
 */
export const STAFF_ALERT_SMS_JOB_TYPE = 'send_staff_alert_sms' as const

export type StaffAlertSms = {
  to: string
  body: string
  /** Must carry template_key, plus the record id it is about, for the idempotency claim. */
  metadata: Record<string, unknown>
}

export type StaffAlertSmsOutcome =
  | { outcome: 'sent' }
  | { outcome: 'queued'; runAt: string }
  | { outcome: 'deferred'; runAt: string }
  | { outcome: 'suspended' }
  | { outcome: 'failed'; error: string }

function uniqueJobKey(alert: StaffAlertSms): string {
  // The number is hashed so it is not copied into the queue's lock keys.
  const templateKey = typeof alert.metadata.template_key === 'string' ? alert.metadata.template_key : 'staff_alert'
  const subject = createHash('sha256')
    .update(JSON.stringify([alert.to, alert.metadata.private_booking_id ?? null, alert.body]))
    .digest('hex')
    .slice(0, 24)
  return `${STAFF_ALERT_SMS_JOB_TYPE}:${templateKey}:${subject}`
}

/**
 * Sends now, or holds the alert until quiet hours end. `fromJob` is true when the job queue is
 * running a held alert: it then asks to be rescheduled rather than queueing a second job.
 * Never throws.
 */
export async function sendStaffAlertSms(
  alert: StaffAlertSms,
  options: { fromJob?: boolean; now?: Date } = {}
): Promise<StaffAlertSmsOutcome> {
  try {
    const quietHours = evaluateSmsQuietHours(options.now ?? new Date())
    if (quietHours.inQuietHours) {
      const runAt = quietHours.nextAllowedSendAt.toISOString()
      if (options.fromJob) {
        return { outcome: 'deferred', runAt }
      }
      const { jobQueue } = await import('@/lib/unified-job-queue')
      const delay = Math.max(1000, quietHours.nextAllowedSendAt.getTime() - Date.now())
      const enqueued = await jobQueue.enqueue(
        STAFF_ALERT_SMS_JOB_TYPE,
        { to: alert.to, message: alert.body, metadata: alert.metadata },
        { delay, unique: uniqueJobKey(alert) }
      )
      if (!enqueued.success) {
        return { outcome: 'failed', error: enqueued.error ?? 'Could not hold the alert until morning' }
      }
      return { outcome: 'queued', runAt }
    }

    const { sendSMS } = await import('@/lib/twilio')
    const result = await sendSMS(alert.to, alert.body, {
      createCustomerIfMissing: false,
      skipMessageLogging: true,
      metadata: alert.metadata,
    })
    if (result.success) {
      return { outcome: 'sent' }
    }
    if ((result as { code?: string }).code === 'sms_suspended') {
      return { outcome: 'suspended' }
    }
    return { outcome: 'failed', error: result.error ?? 'Failed to send message' }
  } catch (error) {
    logger.error('A staff alert text could not be sent', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { to: maskPhone(alert.to), templateKey: alert.metadata.template_key ?? null },
    })
    return { outcome: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The send_staff_alert_sms job. A failed send throws so the queue retries it; the idempotency
 * claim in sendSMS means a retry after a send that did go out is suppressed, not sent twice.
 */
export async function runStaffAlertSmsJob(payload: Record<string, unknown>): Promise<StaffAlertSmsOutcome> {
  const to = typeof payload.to === 'string' ? payload.to : ''
  const body = typeof payload.message === 'string' ? payload.message : ''
  const metadata =
    payload.metadata && typeof payload.metadata === 'object'
      ? (payload.metadata as Record<string, unknown>)
      : {}
  if (!to || !body) {
    throw new Error('send_staff_alert_sms job blocked: missing number or message')
  }

  const outcome = await sendStaffAlertSms({ to, body, metadata }, { fromJob: true })
  if (outcome.outcome === 'failed') {
    throw new Error(`Staff alert text failed: ${outcome.error}`)
  }
  return outcome
}
