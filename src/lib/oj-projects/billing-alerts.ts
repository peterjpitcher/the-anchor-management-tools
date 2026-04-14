import { sendEmail } from '@/lib/email/emailService'
import { escapeHtml, redactPii } from '@/lib/cron/alerting'

/**
 * Failure tier for billing alert categorisation.
 */
export type BillingFailureTier =
  | 'hard_failure'      // Invoice creation or DB mutation failed
  | 'soft_failure'      // Invoice created but email send failed
  | 'skipped_vendor'    // Vendor skipped (already sent, no items, etc.)
  | 'zero_vendor_run'   // Billing run found zero eligible vendors
  | 'email_failure'     // Invoice sent but status/log update failed

/**
 * Per-vendor result from a billing run.
 */
export interface VendorBillingResult {
  vendor_id: string
  vendor_name?: string
  status: 'sent' | 'skipped' | 'failed'
  invoice_id?: string
  invoice_number?: string
  error?: string
  failure_tier?: BillingFailureTier
}

/**
 * Aggregated results from a full billing run.
 */
export interface BillingRunResults {
  period: string
  invoice_date: string
  processed: number
  sent: number
  skipped: number
  failed: number
  vendors: VendorBillingResult[]
}

/**
 * Classifies a vendor result into a failure tier.
 */
function classifyFailureTier(vendor: VendorBillingResult): BillingFailureTier {
  if (vendor.status === 'skipped') return 'skipped_vendor'
  if (!vendor.error) return 'hard_failure'

  const err = vendor.error.toLowerCase()
  if (err.includes('email') || err.includes('send')) return 'email_failure'
  if (err.includes('status update') || err.includes('reconcil')) return 'soft_failure'
  return 'hard_failure'
}

/**
 * Sends a billing run alert email summarising any issues from the
 * OJ Projects monthly billing cron. Only sends if there are issues.
 *
 * Follows the same HTML structure and PII-redaction pattern as
 * reportCronFailure in alerting.ts.
 */
export async function sendBillingRunAlert(results: BillingRunResults): Promise<void> {
  const alertEmail =
    process.env.OJ_PROJECTS_BILLING_ALERT_EMAIL ||
    process.env.PAYROLL_ACCOUNTANT_EMAIL

  if (!alertEmail) {
    console.warn(
      '[billing-alert] No alert email configured (OJ_PROJECTS_BILLING_ALERT_EMAIL / PAYROLL_ACCOUNTANT_EMAIL); skipping.'
    )
    return
  }

  // Only alert if there are issues
  const failedVendors = results.vendors.filter((v) => v.status === 'failed')
  if (failedVendors.length === 0) return

  const timestamp = new Date().toISOString()
  const environment = process.env.NODE_ENV ?? 'unknown'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'unknown'

  const safeTimestamp = escapeHtml(timestamp)
  const safeEnvironment = escapeHtml(environment)
  const safeAppUrl = escapeHtml(appUrl)
  const safePeriod = escapeHtml(results.period)

  // Build vendor issue rows — vendor name + failure tier only, no raw errors
  const vendorRows = failedVendors.map((v) => {
    const tier = v.failure_tier || classifyFailureTier(v)
    const safeName = escapeHtml(redactPii(v.vendor_name || v.vendor_id))
    const safeTier = escapeHtml(tier)
    const tierColor = tier === 'hard_failure' ? '#dc2626'
      : tier === 'email_failure' ? '#ea580c'
        : tier === 'soft_failure' ? '#d97706'
          : '#6b7280'

    return `<tr>
      <td style="padding:4px 8px;">${safeName}</td>
      <td style="padding:4px 8px;color:${tierColor};font-weight:bold;">${safeTier}</td>
    </tr>`
  })

  const subject = `OJ Projects Billing Alert — ${results.period} — ${failedVendors.length} issue${failedVendors.length !== 1 ? 's' : ''}`

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;">
      <h2 style="color:#dc2626;">OJ Projects Billing Alert</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">Period</td><td style="padding:4px 8px;">${safePeriod}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Time</td><td style="padding:4px 8px;">${safeTimestamp}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Environment</td><td style="padding:4px 8px;">${safeEnvironment}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">App URL</td><td style="padding:4px 8px;">${safeAppUrl}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Processed</td><td style="padding:4px 8px;">${results.processed}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Sent</td><td style="padding:4px 8px;">${results.sent}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Skipped</td><td style="padding:4px 8px;">${results.skipped}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Failed</td><td style="padding:4px 8px;color:#dc2626;font-weight:bold;">${results.failed}</td></tr>
      </table>
      <h3 style="margin-top:16px;">Failed Vendors</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr style="background:#f9fafb;">
          <th style="padding:4px 8px;text-align:left;font-weight:bold;">Vendor</th>
          <th style="padding:4px 8px;text-align:left;font-weight:bold;">Failure Type</th>
        </tr>
        ${vendorRows.join('\n        ')}
      </table>
      <p style="margin-top:16px;font-size:12px;color:#6b7280;">
        Check the billing runs table or Vercel logs for full details. No raw error messages are included in this alert for security.
      </p>
    </div>`.trim()

  try {
    const result = await sendEmail({
      to: alertEmail,
      subject,
      html,
    })

    if (!result.success) {
      console.error(
        `[billing-alert] Failed to send billing run alert:`,
        result.error
      )
    }
  } catch (sendError) {
    // Never let the alert mechanism itself throw
    console.error(
      `[billing-alert] Exception sending billing run alert:`,
      sendError
    )
  }
}
