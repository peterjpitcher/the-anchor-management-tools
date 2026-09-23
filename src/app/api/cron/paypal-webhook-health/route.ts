import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { listPayPalWebhookRegistrations } from '@/lib/paypal'
import {
  PAYPAL_CANONICAL_WEBHOOK_PATH,
  PAYPAL_LEGACY_WEBHOOK_PATHS,
  PAYPAL_OPTIONAL_EVENTS,
  PAYPAL_REQUIRED_EVENTS,
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
  url: string
  webhookId: string
  /** canonical = the one we want; legacy = a per-domain URL that no longer needs its own
   *  registration; unknown = not a URL of ours at all. */
  kind: 'canonical' | 'legacy' | 'unknown'
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
  covered: boolean
  redundant: number
  problem: string | null
}> {
  const registry = await listPayPalWebhookRegistrations()

  if (registry.state === 'unavailable') {
    return {
      health: 'unknown',
      findings: [],
      covered: false,
      redundant: 0,
      problem: `Could not read the PayPal webhook registry: ${registry.message}`,
    }
  }

  const appUrl = getAppUrl()
  const canonicalUrl = `${appUrl}${PAYPAL_CANONICAL_WEBHOOK_PATH}`
  const legacyUrls = new Set(PAYPAL_LEGACY_WEBHOOK_PATHS.map((path) => normaliseUrl(`${appUrl}${path}`)))

  const findings: RegistrationFinding[] = registry.webhooks.map((webhook) => {
    const url = normaliseUrl(webhook.url)
    const subscribed = new Set(webhook.eventTypes)
    const coversEverything = subscribed.has('*')

    const kind: RegistrationFinding['kind'] = url === normaliseUrl(canonicalUrl)
      ? 'canonical'
      : legacyUrls.has(url)
        ? 'legacy'
        : 'unknown'

    return {
      url: webhook.url,
      webhookId: webhook.id,
      kind,
      missingRequiredEvents: coversEverything
        ? []
        : PAYPAL_REQUIRED_EVENTS.filter((type) => !subscribed.has(type)),
      missingOptionalEvents: coversEverything
        ? []
        : PAYPAL_OPTIONAL_EVENTS.filter((type) => !subscribed.has(type)),
    }
  })

  // Every registered URL of ours runs the same dispatcher, so ANY one of them receiving the
  // required events means no payment event is being missed. Which URL it is only decides how
  // much duplicate delivery we are paying for.
  const usable = findings.filter(
    (finding) => finding.kind !== 'unknown' && finding.missingRequiredEvents.length === 0,
  )
  const covered = usable.length > 0
  const redundant = Math.max(usable.length - 1, 0)

  return {
    health: covered ? 'healthy' : 'unhealthy',
    findings,
    covered,
    redundant,
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
  failures: FailureCount[]
}): string {
  const rows = report.registrations
    .map((finding) => {
      const state = finding.kind === 'unknown'
        ? 'NOT ONE OF OURS, review by hand'
        : finding.missingRequiredEvents.length > 0
          ? `missing: ${finding.missingRequiredEvents.join(', ')}`
          : finding.kind === 'canonical' ? 'ok (canonical)' : 'ok (legacy, can be deleted)'
      return `<tr><td style="padding:4px 8px;font-family:monospace;">${escapeHtml(finding.url)}</td><td style="padding:4px 8px;">${escapeHtml(state)}</td><td style="padding:4px 8px;font-family:monospace;">${escapeHtml(finding.webhookId)}</td></tr>`
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
        <tr><th style="text-align:left;padding:4px 8px;">Registered URL</th><th style="text-align:left;padding:4px 8px;">State</th><th style="text-align:left;padding:4px 8px;">Webhook id</th></tr>
        ${rows || '<tr><td style="padding:4px 8px;" colspan="3">NOTHING IS REGISTERED. No PayPal event can reach this app.</td></tr>'}
      </table>
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
              subject: `[PAYPAL WEBHOOKS] ${health}`,
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
        covered: registrations.covered,
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
    covered: registrations.covered,
    redundant_registrations: registrations.redundant,
    failures: failures.counts,
  })
}
