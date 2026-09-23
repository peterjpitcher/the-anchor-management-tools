import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { listPayPalWebhookRegistrations } from '@/lib/paypal'
import {
  PAYPAL_WEBHOOK_ENDPOINTS,
  PAYPAL_WEBHOOK_FAILURE_STATUSES,
} from '@/lib/paypal-webhook-endpoints'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { sendEmail } from '@/lib/email/emailService'
import { escapeHtml } from '@/lib/cron/alerting'
import { STAFF } from '@/lib/brand/palette'

export const dynamic = 'force-dynamic'

/**
 * Daily check that the PayPal webhooks are alive.
 *
 * The private-bookings endpoint rejected every delivery for six months and nothing said a
 * word, so this deliberately reports three states rather than two: healthy, unhealthy, and
 * unknown. A check that could not reach PayPal or the database must never come back quiet,
 * and a suppressed or failed alert email is never described as delivered.
 *
 * Read-only against both PayPal and the database. It registers nothing and deletes nothing:
 * an unexpected registration is reported for a human to look at.
 */

const WINDOW_HOURS = 24

type Health = 'healthy' | 'unhealthy' | 'unknown'

type RegistrationFinding = {
  endpoint: string
  label: string
  url: string
  registered: boolean
  webhookId: string | null
  missingRequiredEvents: string[]
  missingOptionalEvents: string[]
}

type FailureCount = {
  source: string
  status: string
  attempts: number
  uniqueEvents: number
}

function worst(a: Health, b: Health): Health {
  if (a === 'unhealthy' || b === 'unhealthy') return 'unhealthy'
  if (a === 'unknown' || b === 'unknown') return 'unknown'
  return 'healthy'
}

function normaliseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

async function checkRegistrations(): Promise<{
  health: Health
  findings: RegistrationFinding[]
  unknownUrls: string[]
  problem: string | null
}> {
  const registry = await listPayPalWebhookRegistrations()

  if (registry.state === 'unavailable') {
    return {
      health: 'unknown',
      findings: [],
      unknownUrls: [],
      problem: `Could not read the PayPal webhook registry: ${registry.message}`,
    }
  }

  const appUrl = getAppUrl()
  const findings: RegistrationFinding[] = []
  const knownUrls = new Set<string>()

  for (const endpoint of PAYPAL_WEBHOOK_ENDPOINTS) {
    const url = `${appUrl}${endpoint.path}`
    knownUrls.add(normaliseUrl(url))

    const match = registry.webhooks.find((webhook) => normaliseUrl(webhook.url) === normaliseUrl(url))
    // A wildcard subscription covers everything, so it is not a missing event.
    const subscribed = new Set(match?.eventTypes ?? [])
    const coversEverything = subscribed.has('*')

    findings.push({
      endpoint: endpoint.source,
      label: endpoint.label,
      url,
      registered: Boolean(match),
      webhookId: match?.id ?? null,
      missingRequiredEvents: match && !coversEverything
        ? endpoint.requiredEvents.filter((type) => !subscribed.has(type))
        : match ? [] : endpoint.requiredEvents,
      missingOptionalEvents: match && !coversEverything
        ? endpoint.optionalEvents.filter((type) => !subscribed.has(type))
        : [],
    })
  }

  const unknownUrls = registry.webhooks
    .map((webhook) => webhook.url)
    .filter((url) => !knownUrls.has(normaliseUrl(url)))

  const hasGap = findings.some(
    (finding) => !finding.registered || finding.missingRequiredEvents.length > 0,
  )

  return {
    health: hasGap ? 'unhealthy' : 'healthy',
    findings,
    unknownUrls,
    problem: null,
  }
}

async function countFailures(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ health: Health; counts: FailureCount[]; problem: string | null }> {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  // Supabase returns at most 1,000 rows per request and says nothing when it cuts a result
  // short, and a bad day here runs to thousands of retries. A truncated count would understate
  // the very problem this check exists to catch, so page through instead.
  let rows: Array<{ status: string | null; params: unknown }>
  try {
    rows = await fetchAllRows<{ status: string | null; params: unknown }>(
      (from, to) =>
        supabase
          .from('webhook_logs')
          .select('status, params')
          .eq('webhook_type', 'paypal')
          .in('status', [...PAYPAL_WEBHOOK_FAILURE_STATUSES])
          .gte('processed_at', since)
          .range(from, to) as never,
      { label: 'paypal webhook failure count', maxRows: 50_000 },
    )
  } catch (readError) {
    return {
      health: 'unknown',
      counts: [],
      problem: `Could not read webhook_logs: ${readError instanceof Error ? readError.message : String(readError)}`,
    }
  }

  const buckets = new Map<string, { source: string; status: string; attempts: number; events: Set<string> }>()

  for (const row of rows) {
    const status = row.status ?? 'unknown'
    const params = (row.params ?? {}) as { source?: unknown; event_id?: unknown }
    const source = typeof params.source === 'string' ? params.source : 'unknown'
    const key = `${source}:${status}`
    const bucket = buckets.get(key) ?? { source, status, attempts: 0, events: new Set<string>() }
    bucket.attempts += 1
    // Repeated retries of one event are not the same as many distinct failures, so both are
    // reported. An event id is only present once a payload has been parsed.
    if (typeof params.event_id === 'string' && params.event_id) {
      bucket.events.add(params.event_id)
    }
    buckets.set(key, bucket)
  }

  const counts: FailureCount[] = [...buckets.values()]
    .map((bucket) => ({
      source: bucket.source,
      status: bucket.status,
      attempts: bucket.attempts,
      uniqueEvents: bucket.events.size,
    }))
    .sort((a, b) => b.attempts - a.attempts)

  return {
    health: counts.length > 0 ? 'unhealthy' : 'healthy',
    counts,
    problem: null,
  }
}

function buildAlertHtml(report: {
  health: Health
  problems: string[]
  registrations: RegistrationFinding[]
  unknownUrls: string[]
  failures: FailureCount[]
}): string {
  const rows = report.registrations
    .map((finding) => {
      const state = !finding.registered
        ? 'NOT REGISTERED'
        : finding.missingRequiredEvents.length > 0
          ? `missing: ${finding.missingRequiredEvents.join(', ')}`
          : 'ok'
      return `<tr><td style="padding:4px 8px;">${escapeHtml(finding.label)}</td><td style="padding:4px 8px;">${escapeHtml(state)}</td><td style="padding:4px 8px;font-family:monospace;">${escapeHtml(finding.webhookId ?? '-')}</td></tr>`
    })
    .join('\n')

  const failureRows = report.failures
    .map(
      (failure) =>
        `<tr><td style="padding:4px 8px;">${escapeHtml(failure.source)}</td><td style="padding:4px 8px;">${escapeHtml(failure.status)}</td><td style="padding:4px 8px;">${failure.attempts}</td><td style="padding:4px 8px;">${failure.uniqueEvents}</td></tr>`,
    )
    .join('\n')

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:${STAFF.danger};">PayPal webhook health: ${escapeHtml(report.health)}</h2>
      ${report.problems.length > 0
        ? `<p><strong>The check could not complete fully:</strong></p><ul>${report.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join('')}</ul>`
        : ''}
      <h3>Registrations</h3>
      <table style="border-collapse:collapse;font-size:13px;">
        <tr><th style="text-align:left;padding:4px 8px;">Endpoint</th><th style="text-align:left;padding:4px 8px;">State</th><th style="text-align:left;padding:4px 8px;">Webhook id</th></tr>
        ${rows || '<tr><td style="padding:4px 8px;" colspan="3">Not checked</td></tr>'}
      </table>
      ${report.unknownUrls.length > 0
        ? `<h3>Registered URLs this app does not recognise</h3><p>Review these by hand; nothing is deleted automatically.</p><ul>${report.unknownUrls.map((url) => `<li style="font-family:monospace;">${escapeHtml(url)}</li>`).join('')}</ul>`
        : ''}
      <h3>Failures in the last ${WINDOW_HOURS} hours</h3>
      <table style="border-collapse:collapse;font-size:13px;">
        <tr><th style="text-align:left;padding:4px 8px;">Source</th><th style="text-align:left;padding:4px 8px;">Status</th><th style="text-align:left;padding:4px 8px;">Attempts</th><th style="text-align:left;padding:4px 8px;">Distinct events</th></tr>
        ${failureRows || '<tr><td style="padding:4px 8px;" colspan="4">None</td></tr>'}
      </table>
      <p style="font-size:12px;color:${STAFF.textMuted};">A quiet day sends nothing. A successful check does not prove PayPal delivered anything; it proves nothing failed.</p>
    </div>`.trim()
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason ?? 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const problems: string[] = []

  const registrations = await checkRegistrations()
  if (registrations.problem) problems.push(registrations.problem)

  const failures = await countFailures(supabase)
  if (failures.problem) problems.push(failures.problem)

  const health = worst(registrations.health, failures.health)

  const report = {
    health,
    problems,
    registrations: registrations.findings,
    unknownUrls: registrations.unknownUrls,
    failures: failures.counts,
  }

  let alertDelivery: 'not_needed' | 'sent' | 'no_recipient' | 'suppressed' | 'failed' = 'not_needed'
  let alertError: string | null = null

  if (health !== 'healthy') {
    const recipient = process.env.CRON_ALERT_EMAIL
    if (!recipient) {
      alertDelivery = 'no_recipient'
      logger.error('PayPal webhook health is not healthy but CRON_ALERT_EMAIL is unset', {
        metadata: { health, problems },
      })
    } else {
      try {
        const result = await sendEmail({
          to: recipient,
          subject: `[PAYPAL WEBHOOKS] ${health} - ${PAYPAL_WEBHOOK_ENDPOINTS.length} endpoints checked`,
          html: buildAlertHtml(report),
        })

        if (result.success) {
          alertDelivery = 'sent'
        } else {
          // A kill switch is a deliberate silence, not a delivery, and not a fault.
          alertDelivery = result.code === 'email_suspended' ? 'suppressed' : 'failed'
          alertError = result.error ?? null
          logger.error('PayPal webhook health alert was not delivered', {
            metadata: { health, delivery: alertDelivery, error: alertError },
          })
        }
      } catch (sendError) {
        alertDelivery = 'failed'
        alertError = sendError instanceof Error ? sendError.message : String(sendError)
        logger.error('PayPal webhook health alert threw while sending', {
          error: sendError instanceof Error ? sendError : new Error(String(sendError)),
        })
      }
    }
  }

  if (health !== 'healthy') {
    logger.error('PayPal webhook health check found a problem', {
      metadata: {
        health,
        problems,
        unregistered: registrations.findings.filter((finding) => !finding.registered).map((finding) => finding.endpoint),
        failures: failures.counts,
      },
    })
  }

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    window_hours: WINDOW_HOURS,
    health,
    problems,
    alert_delivery: alertDelivery,
    alert_error: alertError,
    registrations: registrations.findings,
    unknown_urls: registrations.unknownUrls,
    failures: failures.counts,
  })
}
