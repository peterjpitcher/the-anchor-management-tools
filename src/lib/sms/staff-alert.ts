import { createHash } from 'crypto'
import { logger } from '@/lib/logger'
import { maskPhone } from '@/lib/phone/mask'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'
import { resolveConfig } from '@/lib/sms/safety'
import { createAdminClient } from '@/lib/supabase/admin'

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
 *
 * The hourly safety limits in sendSMS count rows in `messages`, which a staff alert never writes,
 * so they cannot see these texts, and each enquiry has its own idempotency claim. Without a cap
 * of its own, a flood of public enquiries could text the staff phones without limit. So each
 * alert that goes is recorded as a private_booking_audit row (action sms_sent, new_value the
 * template key, a hash of the number, never the number), and before every send, now or from the
 * held job, those rows are counted against the same limits sendSMS uses (SMS_SAFETY_*: global
 * hourly, recipient hourly, recipient daily). Over a limit, or if the count cannot be read, the
 * alert does not go (fail closed) and the caller logs it at error. The enquiry and the manager
 * email are unaffected.
 */
export const STAFF_ALERT_AUDIT_TRIGGER = 'web_enquiry_staff_alert'
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
  | { outcome: 'capped'; reason: string }
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

function recipientHash(to: string): string {
  return createHash('sha256').update(to.replace(/\s+/g, '')).digest('hex').slice(0, 24)
}

type CapCheck = { allowed: true } | { allowed: false; reason: string; error?: true }

/** Counts the staff alerts already sent, against the SMS safety limits. Fails closed. */
async function checkStaffAlertCap(alert: StaffAlertSms): Promise<CapCheck> {
  const config = resolveConfig()
  if (!config.enabled) return { allowed: true }

  const templateKey = typeof alert.metadata.template_key === 'string' ? alert.metadata.template_key : ''
  if (!templateKey) return { allowed: false, reason: 'missing_template_key', error: true }

  const supabase = createAdminClient()
  const hourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const hash = recipientHash(alert.to)
  const base = () =>
    supabase
      .from('private_booking_audit')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'sms_sent')
      .eq('new_value', templateKey)
      .eq('metadata->>trigger', STAFF_ALERT_AUDIT_TRIGGER)

  const [globalHour, recipientHour, recipientDay] = await Promise.all([
    base().gte('performed_at', hourAgoIso),
    base().eq('metadata->>recipient_hash', hash).gte('performed_at', hourAgoIso),
    base().eq('metadata->>recipient_hash', hash).gte('performed_at', dayAgoIso),
  ])
  const failed = globalHour.error || recipientHour.error || recipientDay.error
  if (failed) {
    return { allowed: false, reason: `count_failed: ${failed.message ?? 'unknown error'}`, error: true }
  }

  if ((globalHour.count ?? 0) >= config.globalHourlyLimit) return { allowed: false, reason: 'global_hourly_limit' }
  if ((recipientHour.count ?? 0) >= config.recipientHourlyLimit) return { allowed: false, reason: 'recipient_hourly_limit' }
  if ((recipientDay.count ?? 0) >= config.recipientDailyLimit) return { allowed: false, reason: 'recipient_daily_limit' }
  return { allowed: true }
}

/** The counter row for a sent alert. Logged, never thrown: the text has already gone. */
async function recordStaffAlertSent(alert: StaffAlertSms): Promise<void> {
  try {
    const bookingId = typeof alert.metadata.private_booking_id === 'string' ? alert.metadata.private_booking_id : null
    if (!bookingId) throw new Error('No private booking id to record the staff alert against')
    const { error: insertError } = await createAdminClient().from('private_booking_audit').insert({
      booking_id: bookingId,
      action: 'sms_sent',
      field_name: 'sms',
      new_value: String(alert.metadata.template_key ?? ''),
      metadata: {
        trigger: STAFF_ALERT_AUDIT_TRIGGER,
        message: 'Staff alert text sent to a staff mobile',
        recipient_hash: recipientHash(alert.to),
      },
      performed_by: null,
    })
    if (insertError) throw new Error(insertError.message)
  } catch (error) {
    logger.error('A staff alert text went but could not be counted towards the staff alert limits', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { to: maskPhone(alert.to), templateKey: alert.metadata.template_key ?? null },
    })
  }
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

    // Applies to the immediate send and to the held job alike, since both arrive here.
    const cap = await checkStaffAlertCap(alert)
    if (!cap.allowed) {
      logger.error('A staff alert text was not sent: staff alert limit reached or could not be checked', {
        error: new Error(cap.reason),
        metadata: { to: maskPhone(alert.to), templateKey: alert.metadata.template_key ?? null, reason: cap.reason },
      })
      return cap.error ? { outcome: 'failed', error: cap.reason } : { outcome: 'capped', reason: cap.reason }
    }

    const { sendSMS } = await import('@/lib/twilio')
    const result = await sendSMS(alert.to, alert.body, {
      createCustomerIfMissing: false,
      skipMessageLogging: true,
      metadata: alert.metadata,
    })
    if (result.success) {
      // A duplicate suppressed by the idempotency claim did not go, so it is not counted.
      if (!(result as { suppressed?: boolean }).suppressed) await recordStaffAlertSent(alert)
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
