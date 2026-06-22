import { createAdminClient } from '@/lib/supabase/admin'
import { escapeHtml, redactPii } from '@/lib/cron/alerting'
import { sendEmail } from '@/lib/email/emailService'
import { logger } from '@/lib/logger'

type CommunicationHealthIssue = {
  key: string
  label: string
  count?: number
  rate?: number
  threshold: number
}

export type CommunicationHealthReport = {
  checkedAt: string
  issues: CommunicationHealthIssue[]
  metrics: Record<string, number>
  alerted: boolean
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number.parseFloat(process.env[name] || '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function since(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

async function countRows(
  table: string,
  applyFilters: (query: any) => any
): Promise<number> {
  const client = createAdminClient()
  const { count, error } = await applyFilters(
    (client.from(table) as any).select('id', { count: 'exact', head: true })
  )

  if (error) {
    throw new Error(`Failed to count ${table}: ${error.message}`)
  }

  return count ?? 0
}

async function sendHealthAlert(report: CommunicationHealthReport): Promise<boolean> {
  const alertEmail = process.env.COMMS_ALERT_EMAIL || process.env.CRON_ALERT_EMAIL
  if (!alertEmail) {
    logger.warn('Communications health alert skipped because no alert email is configured')
    return false
  }

  const rows = report.issues.map((issue) => {
    const value = issue.rate != null ? `${issue.rate.toFixed(1)}%` : String(issue.count ?? 0)
    return `<tr><td style="padding:6px 8px;font-weight:bold;">${escapeHtml(issue.label)}</td><td style="padding:6px 8px;">${escapeHtml(value)}</td><td style="padding:6px 8px;">${escapeHtml(String(issue.threshold))}</td></tr>`
  })

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:#b45309;">Communications health alert</h2>
      <p>One or more communications monitoring thresholds were breached.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead><tr><th align="left">Metric</th><th align="left">Value</th><th align="left">Threshold</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <pre style="background:#f9fafb;border:1px solid #e5e7eb;padding:12px;border-radius:4px;white-space:pre-wrap;font-size:12px;">${escapeHtml(redactPii(JSON.stringify(report.metrics, null, 2)))}</pre>
    </div>
  `.trim()

  const result = await sendEmail({
    to: alertEmail,
    subject: '[COMMS HEALTH] Communications threshold breached',
    html,
  })

  if (!result.success) {
    logger.warn('Communications health alert email failed', {
      metadata: { error: result.error || null },
    })
    return false
  }

  return true
}

export async function runCommunicationsHealthCheck(): Promise<CommunicationHealthReport> {
  const checkedAt = new Date().toISOString()
  const last24h = since(24)
  const last48h = since(48)

  const [
    inboundEmail24h,
    unmatchedInboundEmail24h,
    bouncedOrComplained24h,
    whatsappFailures24h,
    holdingQueueDepth,
    fallbackSent24h,
    deliveries24h,
  ] = await Promise.all([
    countRows('email_messages', (query) =>
      query.eq('direction', 'inbound').gte('received_at', last24h)
    ),
    countRows('unmatched_communications', (query) =>
      query.eq('channel', 'email').gte('received_at', last24h)
    ),
    countRows('email_messages', (query) =>
      query.in('status', ['bounced', 'complained']).gte('updated_at', last24h)
    ),
    countRows('messages', (query) =>
      query.eq('message_type', 'whatsapp').in('status', ['failed', 'undelivered']).gte('created_at', last24h)
    ),
    countRows('unmatched_communications', (query) =>
      query.eq('status', 'pending')
    ),
    countRows('notification_deliveries', (query) =>
      query.eq('final_status', 'fallback_sent').gte('created_at', last24h)
    ),
    countRows('notification_deliveries', (query) =>
      query.gte('created_at', last24h)
    ),
  ])

  const inboundEmail48h = await countRows('email_messages', (query) =>
    query.eq('direction', 'inbound').gte('received_at', last48h)
  )
  const unmatchedInboundEmail48h = await countRows('unmatched_communications', (query) =>
    query.eq('channel', 'email').gte('received_at', last48h)
  )

  const fallbackRate = deliveries24h > 0 ? (fallbackSent24h / deliveries24h) * 100 : 0
  const metrics = {
    inboundEmail24h,
    unmatchedInboundEmail24h,
    inboundEmail48h,
    unmatchedInboundEmail48h,
    bouncedOrComplained24h,
    whatsappFailures24h,
    holdingQueueDepth,
    fallbackSent24h,
    deliveries24h,
    fallbackRate,
  }

  const issues: CommunicationHealthIssue[] = []

  if (
    process.env.COMMS_EXPECT_RESEND_INBOUND === 'true' &&
    inboundEmail48h + unmatchedInboundEmail48h === 0
  ) {
    issues.push({
      key: 'resend_inbound_silence',
      label: 'Resend inbound silence',
      count: 0,
      threshold: 1,
    })
  }

  const bounceThreshold = envNumber('COMMS_BOUNCE_ALERT_THRESHOLD', 5)
  if (bouncedOrComplained24h >= bounceThreshold) {
    issues.push({
      key: 'bounce_complaint_spike',
      label: 'Bounce or complaint spike',
      count: bouncedOrComplained24h,
      threshold: bounceThreshold,
    })
  }

  const whatsappFailureThreshold = envNumber('COMMS_WHATSAPP_FAILURE_THRESHOLD', 5)
  if (whatsappFailures24h >= whatsappFailureThreshold) {
    issues.push({
      key: 'whatsapp_failure_spike',
      label: 'WhatsApp failure spike',
      count: whatsappFailures24h,
      threshold: whatsappFailureThreshold,
    })
  }

  const holdingThreshold = envNumber('COMMS_HOLDING_QUEUE_THRESHOLD', 20)
  if (holdingQueueDepth >= holdingThreshold) {
    issues.push({
      key: 'holding_queue_depth',
      label: 'Holding queue depth',
      count: holdingQueueDepth,
      threshold: holdingThreshold,
    })
  }

  const fallbackThreshold = envNumber('COMMS_FALLBACK_RATE_THRESHOLD_PERCENT', 25)
  const fallbackMinimum = envNumber('COMMS_FALLBACK_MINIMUM_DELIVERIES', 5)
  if (deliveries24h >= fallbackMinimum && fallbackRate >= fallbackThreshold) {
    issues.push({
      key: 'fallback_rate',
      label: 'Fallback rate',
      rate: fallbackRate,
      threshold: fallbackThreshold,
    })
  }

  const report: CommunicationHealthReport = {
    checkedAt,
    issues,
    metrics,
    alerted: false,
  }

  if (issues.length > 0) {
    report.alerted = await sendHealthAlert(report)
  }

  return report
}
