import { logger } from '@/lib/logger'
import { resolveOpsAlertSmsNumber } from '@/lib/ops-alerts/payment-failure-alert'

/**
 * A text to the operations mobile (OPS_ALERT_SMS_NUMBER) when email itself is broken.
 *
 * Every alert this app raises goes by email, so a fault in the email provider used to be
 * silent: from 13 to 14 November 2026 Resend rejected our API key for 33 hours, a campaign
 * and several guest emails failed, and the alert emails about it failed the same way.
 *
 * Two reasons, each texted at most once an hour:
 * - 'provider_rejected_key': the provider refused our credentials (Resend's key, or the Graph
 *   sign-in), so email through it is not going out.
 * - 'alert_email_failed': an email to the alert inbox could not be sent, so a problem the
 *   app wanted a person to see has not been seen.
 *
 * The wording is fixed per reason, and the hour is the dedupe slot, so the SMS idempotency
 * claim is what limits it to one an hour across every server instance. Never throws: the
 * caller is already handling a failure.
 */
export type EmailFaultReason = 'provider_rejected_key' | 'alert_email_failed'

export const EMAIL_FAULT_ALERT_TEMPLATE_KEY = 'ops_email_fault_alert'

const WORDING: Record<EmailFaultReason, string> = {
  provider_rejected_key:
    'The Anchor app: our email provider is refusing our sign-in, so emails are not being sent. Check the email key or secret in Vercel.',
  alert_email_failed:
    'The Anchor app: an alert email could not be sent, so a problem has gone unreported. Check the scheduled jobs page and the email log.',
}

const HOUR_MS = 60 * 60 * 1000

export function emailFaultAlertSlot(reason: EmailFaultReason, now: Date = new Date()): string {
  return `${reason}:${Math.floor(now.getTime() / HOUR_MS)}`
}

export async function textOpsAboutEmailFault(reason: EmailFaultReason): Promise<boolean> {
  try {
    const destination = resolveOpsAlertSmsNumber()
    if (!destination.configured) {
      // console.error so it reaches the production logs: nobody is being told.
      console.error(`[email-fault-alert] no operations mobile is set, the email fault (${reason}) was not texted`)
      return false
    }

    // Imported here so the email service does not load Twilio for every send.
    const { sendSMS } = await import('@/lib/twilio')
    const result = await sendSMS(destination.number, WORDING[reason], {
      createCustomerIfMissing: false,
      skipMessageLogging: true,
      skipQuietHours: true,
      metadata: {
        template_key: EMAIL_FAULT_ALERT_TEMPLATE_KEY,
        trigger_type: EMAIL_FAULT_ALERT_TEMPLATE_KEY,
        stage: emailFaultAlertSlot(reason),
        source: 'email_service',
      },
    })
    if (!result.success) {
      console.error(`[email-fault-alert] the text about an email fault (${reason}) was not sent: ${result.error ?? 'unknown error'}`)
      return false
    }
    return true
  } catch (error) {
    logger.error('The text about an email fault could not be sent', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { reason },
    })
    return false
  }
}
