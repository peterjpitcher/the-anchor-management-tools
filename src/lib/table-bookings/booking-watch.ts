import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/api/idempotency'
import { funnelKeyIds } from '@/lib/booking-funnel/daily-summary'
import { STAFF } from '@/lib/brand/palette'
import { escapeHtml } from '@/lib/cron/alerting'
import { describeMinutes } from '@/lib/cron/scheduled-jobs-check'
import { formatDateInLondon, formatTimeInLondon, toLocalIsoDate } from '@/lib/dateUtils'
import { sendEmail } from '@/lib/email/emailService'
import { logger } from '@/lib/logger'
import { MANAGER_ALERT_RECIPIENT } from '@/lib/money-alerts'
import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * The watch on website table bookings (owner decisions, 22 November 2026).
 *
 * The owner's main fear is that table bookings stop and nobody notices: a broken form, a website
 * that cannot reach this app, or a booking route that keeps failing all look exactly like a quiet
 * week. Once an hour this looks for three things and emails the manager inbox about each, once:
 *
 *   1. No table booking from the website for three days. The website made 87 bookings in the 60
 *      days before this was written and its longest natural gap was 66 hours.
 *   2. The website has stopped asking this app for opening times and free tables. It asked at
 *      least every 3 hours, day and night, across the 90 days before this was written (7,936
 *      calls), so six hours of silence is not a quiet evening.
 *   3. The booking routes the website calls answered with a server error three or more times in
 *      three hours. There was one such answer in the 60 days before this was written.
 *
 * Nothing is sent while all is well. Each alert is remembered in `idempotency_keys` under a key
 * built from the thing that would end it (the last website booking, the last call), so one quiet
 * spell is one email however many times the check runs, and the next email goes only after a
 * booking or a call has arrived and it has gone quiet again.
 *
 * What it cannot see: a request that never arrives leaves no row here, and neither does one this
 * app refuses for a wrong API key (401) or while its own key or rate limit check is down (503),
 * so those show up only as silence. The booking request itself is rare (about one or two a day),
 * so a booking route that is broken while the read routes still work is caught only by the
 * three-day alert. Codes, counts and times only: no guest details are read.
 */

type AdminClient = ReturnType<typeof createAdminClient>

/** `table_bookings.source` for a booking made on the website (set by POST /api/table-bookings). */
export const WEBSITE_BOOKING_SOURCE = 'brand_site'

export const QUIET_BOOKINGS_HOURS = 72
export const WEBSITE_SILENCE_HOURS = 6
export const BOOKING_API_ERROR_WINDOW_HOURS = 3
export const BOOKING_API_ERROR_THRESHOLD = 3

/** The read routes the website calls whenever someone opens the booking page. */
export const WEBSITE_READ_ENDPOINTS = ['/api/table-bookings/load', '/api/table-bookings/periods'] as const
/** Every table booking route the website calls with its key, as `api_usage.endpoint` records them. */
export const BOOKING_API_ENDPOINTS = ['/api/table-bookings', ...WEBSITE_READ_ENDPOINTS] as const

/** How far back the last call is looked for. Older than this reads as "none found". */
const WEBSITE_CALL_LOOKBACK_DAYS = 7
/** A quiet spell or a silence is remembered this long, far longer than either should ever last. */
const SPELL_CLAIM_TTL_HOURS = 24 * 90
/** The server error alert goes at most once a London day. */
const ERROR_CLAIM_TTL_HOURS = 36
const ERROR_ROW_LIMIT = 200

const HOUR_MS = 3_600_000

export type WatchKind = 'quiet_bookings' | 'website_silent' | 'booking_api_errors'

export type WatchAlert = {
  kind: WatchKind
  /** The once-only key: the same for every run that sees the same spell. */
  onceKey: string
  claimTtlHours: number
  subject: string
  /** What was noticed and since when. */
  intro: string
  /** Extra facts, as a list. */
  lines: string[]
  /** What to check. */
  action: string
}

/** "Thursday 19 November at 09:31", London time. */
function londonTime(iso: string): string {
  const date = new Date(iso)
  return `${formatDateInLondon(date, { weekday: 'long', day: 'numeric', month: 'long' })} at ${formatTimeInLondon(date)}`
}

function minutesBetween(fromIso: string, now: Date): number {
  return Math.round((now.getTime() - Date.parse(fromIso)) / 60_000)
}

const ONCE_NOTE =
  'This is the only email about this. The next one goes only if it starts working again and then stops.'

/**
 * No website table booking for three days. `latest` is the newest website booking, or null when
 * there has never been one. Keyed on that booking, so the spell is reported once; a new booking
 * ends it and makes a new key for the next one.
 */
export function quietBookingsAlert(latest: { id: string; createdAt: string } | null, now: Date): WatchAlert | null {
  if (latest && now.getTime() - Date.parse(latest.createdAt) < QUIET_BOOKINGS_HOURS * HOUR_MS) return null

  const days = QUIET_BOOKINGS_HOURS / 24
  const intro = latest
    ? `Nobody has booked a table on the website for ${days} days. The last website booking came in on ${londonTime(latest.createdAt)}, ${describeMinutes(minutesBetween(latest.createdAt, now))} ago. The website normally takes one most days, so a gap this long is unusual.`
    : 'No table booking made on the website could be found at all.'

  return {
    kind: 'quiet_bookings',
    onceKey: `table-booking-watch:quiet-bookings:${latest?.id ?? 'none'}`,
    claimTtlHours: SPELL_CLAIM_TTL_HOURS,
    subject: `[TABLE BOOKINGS] No website table bookings for ${days} days`,
    intro,
    lines: ['Bookings taken by staff or at the bar are not counted: this is about the website only.'],
    action:
      'What to check: make a test booking on the website\'s book a table page. If it does not go through, the website needs fixing today. If it does go through, cancel it; the website is working and it has simply been quiet.',
  }
}

/**
 * The website has not asked for opening times or free tables for six hours. `latestCallAt` is its
 * newest successful call to the read routes, or null when none was found in the last week. Keyed
 * on that call, so one silence is one email.
 */
export function websiteSilentAlert(latestCallAt: string | null, now: Date): WatchAlert | null {
  if (latestCallAt && now.getTime() - Date.parse(latestCallAt) < WEBSITE_SILENCE_HOURS * HOUR_MS) return null

  const intro = latestCallAt
    ? `The website has not asked the booking system for opening times or free tables since ${londonTime(latestCallAt)}, ${describeMinutes(minutesBetween(latestCallAt, now))} ago. It normally asks every few hours at the very least, day and night, so this most likely means the website cannot reach the booking system and guests cannot book a table online.`
    : `The website has not asked the booking system for opening times or free tables in the last ${WEBSITE_CALL_LOOKBACK_DAYS} days. This most likely means the website cannot reach the booking system and guests cannot book a table online.`

  return {
    kind: 'website_silent',
    onceKey: `table-booking-watch:website-silent:${latestCallAt ?? 'none'}`,
    claimTtlHours: SPELL_CLAIM_TTL_HOURS,
    subject: `[TABLE BOOKINGS] The website has not reached the booking system for ${WEBSITE_SILENCE_HOURS} hours or more`,
    intro,
    lines: [],
    action:
      'What to check: open the website\'s book a table page and pick a date. If no times appear, or it shows an error, check that the website is up, and that the API key and the management app address in the website\'s settings are right. If times do appear, the website is working again.',
  }
}

export type BookingApiError = { endpoint: string; statusCode: number; at: string }

const ENDPOINT_LABELS: Record<string, string> = {
  '/api/table-bookings': 'Making a booking',
  '/api/table-bookings/load': 'Checking for free tables',
  '/api/table-bookings/periods': 'Reading opening times',
}

/**
 * Three or more server errors from the booking routes in three hours. `errors` are the rows found
 * in that window. At most one email a London day.
 */
export function bookingApiErrorsAlert(errors: BookingApiError[], now: Date): WatchAlert | null {
  if (errors.length < BOOKING_API_ERROR_THRESHOLD) return null

  const sorted = [...errors].sort((a, b) => a.at.localeCompare(b.at))
  const first = sorted[0].at
  const last = sorted[sorted.length - 1].at
  const byEndpoint = new Map<string, number>()
  for (const error of sorted) byEndpoint.set(error.endpoint, (byEndpoint.get(error.endpoint) ?? 0) + 1)
  const lines = [...byEndpoint.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([endpoint, count]) => `${ENDPOINT_LABELS[endpoint] ?? endpoint}: failed ${count} time${count === 1 ? '' : 's'}.`)

  return {
    kind: 'booking_api_errors',
    onceKey: `table-booking-watch:booking-api-errors:${toLocalIsoDate(now)}`,
    claimTtlHours: ERROR_CLAIM_TTL_HOURS,
    subject: `[TABLE BOOKINGS] The booking system failed ${sorted.length} website requests in the last ${BOOKING_API_ERROR_WINDOW_HOURS} hours`,
    intro: `The booking system answered ${sorted.length} of the website's table booking requests with an error of its own, the first on ${londonTime(first)} and the latest on ${londonTime(last)}. Each one is a guest who saw an error or no times. These are faults on our side, not a guest being told a night is full.`,
    lines,
    action:
      'What to check: try a booking on the website\'s book a table page now. Then look in the management app\'s Vercel logs for "API route crashed" at the times above, which name the cause. Only one email a day is sent about this, however long it goes on.',
  }
}

export type WatchEmail = { subject: string; html: string; text: string }

export function buildWatchEmail(alert: WatchAlert): WatchEmail {
  const footer = `${alert.kind === 'booking_api_errors' ? '' : `${ONCE_NOTE} `}Sent by the hourly table booking watch. No guest details are read or sent.`
  const text = [alert.intro, '', ...alert.lines.map((line) => `- ${line}`), ...(alert.lines.length > 0 ? [''] : []), alert.action, '', footer].join('\n')
  const list =
    alert.lines.length > 0
      ? `
      <ul style="font-size:14px;line-height:1.5;margin:0;padding-left:20px;">
        ${alert.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('\n        ')}
      </ul>`
      : ''
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:${STAFF.danger};">${escapeHtml(alert.subject.replace(/^\[[^\]]+\]\s*/, ''))}</h2>
      <p style="font-size:14px;line-height:1.5;">${escapeHtml(alert.intro)}</p>${list}
      <p style="font-size:14px;line-height:1.5;">${escapeHtml(alert.action)}</p>
      <p style="font-size:13px;line-height:1.5;color:${STAFF.textMuted};">${escapeHtml(footer)}</p>
    </div>`.trim()
  return { subject: alert.subject, html, text }
}

/** The newest website booking. Throws when it cannot be read: a failed read is never "no bookings". */
export async function loadLatestWebsiteBooking(supabase: AdminClient): Promise<{ id: string; createdAt: string } | null> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select('id, created_at')
    .eq('source', WEBSITE_BOOKING_SOURCE)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`Could not read the latest website booking: ${error.message}`)
  const row = ((data ?? []) as Array<{ id: string; created_at: string | null }>)[0]
  return row?.created_at ? { id: row.id, createdAt: row.created_at } : null
}

/**
 * When the website last got an answer from the read routes, from `api_usage`. Only keys that can
 * make bookings count, so a test or preview key cannot hide a silence. Throws when it cannot be read.
 */
export async function loadLatestWebsiteCall(supabase: AdminClient, keys: string[], now: Date): Promise<string | null> {
  const { data, error } = await supabase
    .from('api_usage')
    .select('created_at')
    .in('api_key_id', keys)
    .in('endpoint', [...WEBSITE_READ_ENDPOINTS])
    .lt('status_code', 400)
    .gte('created_at', new Date(now.getTime() - WEBSITE_CALL_LOOKBACK_DAYS * 24 * HOUR_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`Could not read the website's latest call: ${error.message}`)
  return ((data ?? []) as Array<{ created_at: string | null }>)[0]?.created_at ?? null
}

/** Server errors the booking routes answered the website with in the last three hours. */
export async function loadBookingApiErrors(supabase: AdminClient, keys: string[], now: Date): Promise<BookingApiError[]> {
  const { data, error } = await supabase
    .from('api_usage')
    .select('endpoint, status_code, created_at')
    .in('api_key_id', keys)
    .in('endpoint', [...BOOKING_API_ENDPOINTS])
    .gte('status_code', 500)
    .gte('created_at', new Date(now.getTime() - BOOKING_API_ERROR_WINDOW_HOURS * HOUR_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(ERROR_ROW_LIMIT)
  if (error) throw new Error(`Could not read the booking routes' errors: ${error.message}`)
  return ((data ?? []) as Array<{ endpoint: string; status_code: number | null; created_at: string | null }>)
    .filter((row) => row.created_at !== null && row.status_code !== null)
    .map((row) => ({ endpoint: row.endpoint, statusCode: row.status_code as number, at: row.created_at as string }))
}

export type WatchOutcome = {
  kind: WatchKind
  alert: 'not_needed' | 'sent' | 'already_sent' | 'failed'
  error?: string
}

/**
 * Sends one alert unless it has gone already. A failed send frees the claim, so the next hourly
 * run tries again. Throws only when the claim itself cannot be made or freed.
 */
async function sendOnce(supabase: AdminClient, alert: WatchAlert): Promise<WatchOutcome> {
  const requestHash = computeIdempotencyRequestHash({ onceKey: alert.onceKey })
  const claim = await claimIdempotencyKey(supabase, alert.onceKey, requestHash, alert.claimTtlHours)
  if (claim.state !== 'claimed') return { kind: alert.kind, alert: 'already_sent' }

  const email = buildWatchEmail(alert)
  const sent = await sendEmail({ to: MANAGER_ALERT_RECIPIENT, subject: email.subject, html: email.html, text: email.text })
  if (!sent.success) {
    await releaseIdempotencyClaim(supabase, alert.onceKey, requestHash)
    return { kind: alert.kind, alert: 'failed', error: `The alert email was not sent: ${sent.error ?? 'unknown'}` }
  }
  try {
    await persistIdempotencyResponse(supabase, alert.onceKey, requestHash, { state: 'emailed' }, alert.claimTtlHours)
  } catch (settleError) {
    // The email has gone. Left unsettled, the claim can be taken again later and the alert sent
    // twice, which is a smaller problem than calling a delivered alert failed.
    logger.error('Table booking watch: could not settle the claim for a sent alert', {
      error: settleError instanceof Error ? settleError : new Error(String(settleError)),
      metadata: { kind: alert.kind },
    })
  }
  return { kind: alert.kind, alert: 'sent' }
}

/**
 * Runs the three checks, each on its own so one that cannot be made does not stop the others.
 * Never throws: a check that failed comes back as `failed`, and the cron answers with an error so
 * the run is recorded as failed and the failure is emailed like any other scheduled job's.
 */
export async function runTableBookingWatch(supabase: AdminClient, now: Date = new Date()): Promise<WatchOutcome[]> {
  let keys: string[] | null = null
  const bookingKeys = async (): Promise<string[]> => {
    if (keys === null) {
      const found = await funnelKeyIds(supabase)
      if (found.length === 0) throw new Error('No API key that can make bookings was found, so the website\'s calls could not be read.')
      keys = found
    }
    return keys
  }

  const checks: Array<{ kind: WatchKind; decide: () => Promise<WatchAlert | null> }> = [
    { kind: 'quiet_bookings', decide: async () => quietBookingsAlert(await loadLatestWebsiteBooking(supabase), now) },
    { kind: 'website_silent', decide: async () => websiteSilentAlert(await loadLatestWebsiteCall(supabase, await bookingKeys(), now), now) },
    { kind: 'booking_api_errors', decide: async () => bookingApiErrorsAlert(await loadBookingApiErrors(supabase, await bookingKeys(), now), now) },
  ]

  const outcomes: WatchOutcome[] = []
  for (const check of checks) {
    try {
      const alert = await check.decide()
      outcomes.push(alert ? await sendOnce(supabase, alert) : { kind: check.kind, alert: 'not_needed' })
    } catch (error) {
      logger.error('Table booking watch: a check failed', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { kind: check.kind },
      })
      outcomes.push({ kind: check.kind, alert: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
  return outcomes
}
