import { sendEmail } from '@/lib/email/emailService'
import { getAppUrl } from '@/lib/env'
import { getErrorMessage } from '@/lib/errors'
import { STAFF } from '@/lib/brand/palette'

/**
 * Escapes HTML special characters to prevent injection in alert emails.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Redacts PII (phone numbers and email addresses) from a string
 * before including it in alert emails.
 *
 * - Phone numbers: replaces with [REDACTED_PHONE]
 * - Email addresses: replaces with [REDACTED_EMAIL]
 */
export function redactPii(input: string): string {
  // Redact phone numbers: international (+44...), UK (07...), or general digit sequences
  // that look like phone numbers (7+ consecutive digits, optionally separated by spaces/dashes)
  let result = input.replace(
    /\+?\d[\d\s\-().]{6,}\d/g,
    '[REDACTED_PHONE]'
  )

  // Redact email addresses
  result = result.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    '[REDACTED_EMAIL]'
  )

  return result
}

/**
 * Emails staff (CRON_ALERT_EMAIL, the same inbox that hears about failed crons) about a payment
 * event that needs a person: PayPal taking money back, or a refund the app could not record by
 * itself. Staff only, never a customer.
 *
 * Unlike a cron failure, the context here is ids and amounts, not free text, so it is escaped but
 * not run through `redactPii` (which reads a booking UUID as a phone number). Callers must not put
 * customer names, emails or phone numbers in it.
 *
 * Never throws: the webhook that raised the alert has already done its work. Returns whether the
 * email was accepted, so the caller can log a missed alert loudly.
 */
export async function reportPaymentAlert(input: {
  title: string
  summary: string
  context?: Record<string, unknown>
}): Promise<{ sent: boolean; reason?: string }> {
  const alertEmail = process.env.CRON_ALERT_EMAIL
  if (!alertEmail) {
    console.error(`[payment-alert] CRON_ALERT_EMAIL not configured; staff were NOT told: ${input.title}`)
    return { sent: false, reason: 'not_configured' }
  }

  const environment = process.env.NODE_ENV ?? 'unknown'
  const rows = Object.entries(input.context ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      const rawValue = typeof value === 'string' ? value : JSON.stringify(value)
      return `<tr><td style="padding:4px 8px;font-weight:bold;vertical-align:top;">${escapeHtml(key)}</td><td style="padding:4px 8px;">${escapeHtml(rawValue)}</td></tr>`
    })

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;">
      <h2 style="color:${STAFF.danger};">${escapeHtml(input.title)}</h2>
      <p style="font-size:14px;line-height:1.5;">${escapeHtml(input.summary)}</p>
      <table style="border-collapse:collapse;font-family:monospace;font-size:13px;">
        ${rows.join('\n        ')}
      </table>
    </div>`.trim()

  try {
    const result = await sendEmail({
      to: alertEmail,
      subject: `[PAYPAL ACTION NEEDED] ${input.title} - ${environment}`,
      html,
    })
    if (!result.success) {
      console.error(`[payment-alert] Failed to send alert "${input.title}":`, result.error)
      return { sent: false, reason: 'send_failed' }
    }
    return { sent: true }
  } catch (sendError) {
    console.error(`[payment-alert] Exception sending alert "${input.title}":`, sendError)
    return { sent: false, reason: 'send_threw' }
  }
}

/**
 * Reports a cron job failure by sending an alert email to the configured
 * CRON_ALERT_EMAIL address. Fails silently (logs to console) if the email
 * cannot be sent, to avoid masking the original error.
 *
 * Builds on the existing cron-run-results.ts utility by providing the
 * notification layer on top of persistence.
 *
 * @param cronName - The name of the cron job that failed (e.g. 'parking-notifications')
 * @param error - The error that caused the failure
 * @param context - Optional additional context to include in the alert (will be PII-redacted)
 */
export async function reportCronFailure(
  cronName: string,
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const alertEmail = process.env.CRON_ALERT_EMAIL
  if (!alertEmail) {
    console.warn(
      `[cron-alert] CRON_ALERT_EMAIL not configured; skipping failure alert for ${cronName}`
    )
    return
  }

  const errorMessage = getErrorMessage(error)
  const timestamp = new Date().toISOString()
  const environment = process.env.NODE_ENV ?? 'unknown'
  const appUrl = getAppUrl()

  const safeCronName = escapeHtml(cronName)
  const safeErrorMessage = escapeHtml(redactPii(errorMessage))
  const safeTimestamp = escapeHtml(timestamp)
  const safeEnvironment = escapeHtml(environment)
  const safeAppUrl = escapeHtml(appUrl)

  let contextHtml = ''
  if (context && Object.keys(context).length > 0) {
    const contextLines = Object.entries(context).map(([key, value]) => {
      const safeKey = escapeHtml(key)
      const rawValue = typeof value === 'string' ? value : JSON.stringify(value)
      const safeValue = escapeHtml(redactPii(rawValue))
      return `<tr><td style="padding:4px 8px;font-weight:bold;vertical-align:top;">${safeKey}</td><td style="padding:4px 8px;">${safeValue}</td></tr>`
    })
    contextHtml = `
      <h3 style="margin-top:16px;">Additional Context</h3>
      <table style="border-collapse:collapse;font-family:monospace;font-size:13px;">
        ${contextLines.join('\n        ')}
      </table>`
  }

  const subject = `[CRON FAILURE] ${cronName} - ${environment}`
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;">
      <h2 style="color:${STAFF.danger};">Cron Job Failure Alert</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">Job</td><td style="padding:4px 8px;">${safeCronName}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Time</td><td style="padding:4px 8px;">${safeTimestamp}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Environment</td><td style="padding:4px 8px;">${safeEnvironment}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">App URL</td><td style="padding:4px 8px;">${safeAppUrl}</td></tr>
      </table>
      <h3 style="margin-top:16px;">Error</h3>
      <pre style="background:${STAFF.dangerSoft};border:1px solid ${STAFF.dangerBorder};padding:12px;border-radius:4px;white-space:pre-wrap;font-size:13px;">${safeErrorMessage}</pre>
      ${contextHtml}
    </div>`.trim()

  try {
    const result = await sendEmail({
      to: alertEmail,
      subject,
      html,
    })

    if (!result.success) {
      console.error(
        `[cron-alert] Failed to send failure alert for ${cronName}:`,
        result.error
      )
    }
  } catch (sendError) {
    // Never let the alert mechanism itself throw — the original cron error
    // must propagate normally.
    console.error(
      `[cron-alert] Exception sending failure alert for ${cronName}:`,
      sendError
    )
  }
}
