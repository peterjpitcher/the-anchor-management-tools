import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { createGuestToken } from '@/lib/guest/tokens'
import { getGoogleReviewLink } from '@/lib/events/review-link'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { buildEventBaseUrl } from '@/lib/event-marketing-links'
import { persistCronRunResult, recoverCronRunLock } from '@/lib/cron-run-results'

export const maxDuration = 300

const LONDON_TIMEZONE = 'Europe/London'
const TEMPLATE_REMINDER_7D = 'event_reminder_7d'
const TEMPLATE_REMINDER_1D = 'event_reminder_1d'
const TEMPLATE_REVIEW_FOLLOWUP = 'event_review_followup'
const TEMPLATE_TABLE_REVIEW_FOLLOWUP = 'table_review_followup'
const TEMPLATE_INTEREST_MARKETING_14D = 'event_interest_marketing_14d'
const TEMPLATE_INTEREST_REMINDER_14D = 'event_interest_reminder_14d'
const TEMPLATE_INTEREST_REMINDER_7D = 'event_interest_reminder_7d'
const TEMPLATE_INTEREST_REMINDER_1D = 'event_interest_reminder_1d'
const JOB_NAME = 'event-guest-engagement'
const STALE_RUN_WINDOW_MINUTES = 20
const RUN_KEY_INTERVAL_MINUTES = 15
const EVENT_ENGAGEMENT_LOOKBACK_DAYS = 14
const EVENT_ENGAGEMENT_LOOKAHEAD_DAYS = 8
const TABLE_ENGAGEMENT_LOOKBACK_DAYS = 7
const TABLE_ENGAGEMENT_LOOKAHEAD_DAYS = 1
const MAX_EVENT_REVIEW_FOLLOWUPS_PER_RUN = 50
const MAX_TABLE_REVIEW_FOLLOWUPS_PER_RUN = 50
const MAX_INTEREST_MARKETING_SMS_PER_RUN = 50
const EVENT_ENGAGEMENT_SEND_GUARD_WINDOW_MINUTES = parsePositiveIntEnv(
  'EVENT_ENGAGEMENT_SEND_GUARD_WINDOW_MINUTES',
  60
)
const EVENT_ENGAGEMENT_HOURLY_SEND_GUARD_LIMIT = parsePositiveIntEnv(
  'EVENT_ENGAGEMENT_HOURLY_SEND_GUARD_LIMIT',
  120
)
const EVENT_ENGAGEMENT_TEMPLATE_KEYS = [
  TEMPLATE_REMINDER_7D,
  TEMPLATE_REMINDER_1D,
  TEMPLATE_REVIEW_FOLLOWUP,
  TEMPLATE_TABLE_REVIEW_FOLLOWUP,
  TEMPLATE_INTEREST_MARKETING_14D,
  TEMPLATE_INTEREST_REMINDER_14D,
  TEMPLATE_INTEREST_REMINDER_7D,
  TEMPLATE_INTEREST_REMINDER_1D
]

type BookingWithRelations = {
  id: string
  customer_id: string
  event_id: string
  seats: number | null
  is_reminder_only: boolean | null
  status: string
  review_sms_sent_at?: string | null
  review_window_closes_at?: string | null
  event: {
    id: string
    name: string
    start_datetime: string | null
    date: string | null
    time: string | null
    event_status?: string | null
  } | null
  customer: {
    id: string
    first_name: string | null
    mobile_number: string | null
    sms_status: string | null
  } | null
}

type MarketingEventRow = {
  id: string
  name: string
  slug: string | null
  start_datetime: string | null
  event_type: string | null
  category_id: string | null
  booking_open: boolean | null
  event_status: string | null
}

type ManualInterestRecipientRow = {
  id: string | null
  customer_id: string | null
  reminder_14d_sent_at: string | null
  reminder_7d_sent_at: string | null
  reminder_1d_sent_at: string | null
}

type TableBookingWithCustomer = {
  id: string
  customer_id: string
  status: string
  booking_type: string | null
  start_datetime: string | null
  review_sms_sent_at?: string | null
  customer: {
    id: string
    first_name: string | null
    mobile_number: string | null
    sms_status: string | null
  } | null
}

type CronRunAcquireResult = {
  supabase: ReturnType<typeof createAdminClient>
  runId: string
  runKey: string
  shouldResolve: boolean
  skip: boolean
  skipReason?: 'already_running' | 'already_completed'
}

type EventEngagementCronSafetyAbort = {
  runKey: string
  stage: string
  bookingId: string | null
  tableBookingId: string | null
  customerId: string | null
  eventId: string | null
  templateKey: string | null
  code: string
  logFailure: boolean
}

class EventEngagementCronSafetyAbortError extends Error {
  abort: EventEngagementCronSafetyAbort

  constructor(abort: EventEngagementCronSafetyAbort) {
    super(abort.code)
    this.name = 'EventEngagementCronSafetyAbortError'
    this.abort = abort
  }
}

type EventEngagementCronSafetyState = {
  runKey: string
  safetyAborts: EventEngagementCronSafetyAbort[]
  primaryAbort: EventEngagementCronSafetyAbort | null
  recordSafetyAbort: (abort: Omit<EventEngagementCronSafetyAbort, 'runKey'>) => void
  throwSafetyAbort: () => never
}

function extractSmsSafetySignal(smsResult: Awaited<ReturnType<typeof sendSMS>>): {
  code: string | null
  logFailure: boolean
} {
  const code = typeof (smsResult as any)?.code === 'string' ? ((smsResult as any).code as string) : null
  const logFailure = (smsResult as any)?.logFailure === true
  return { code, logFailure }
}

function isFatalSmsSafetySignal(signal: { code: string | null; logFailure: boolean }): boolean {
  return (
    signal.logFailure ||
    signal.code === 'logging_failed' ||
    signal.code === 'safety_unavailable' ||
    signal.code === 'idempotency_conflict'
  )
}

function maybeRecordFatalSmsSafetyAbort(
  safety: EventEngagementCronSafetyState,
  smsResult: Awaited<ReturnType<typeof sendSMS>>,
  context: Omit<EventEngagementCronSafetyAbort, 'runKey' | 'code' | 'logFailure'>
) {
  const signal = extractSmsSafetySignal(smsResult)
  if (!isFatalSmsSafetySignal(signal)) return

  safety.recordSafetyAbort({
    ...context,
    code: signal.code ?? 'logging_failed',
    logFailure: signal.logFailure,
  })
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function allowEventEngagementSendGuardSchemaGaps(): boolean {
  return parseBooleanEnv('EVENT_ENGAGEMENT_SEND_GUARD_ALLOW_SCHEMA_GAPS', process.env.NODE_ENV !== 'production')
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function getLondonRunKey(now: Date = new Date()): string {
  const londonNow = toZonedTime(now, LONDON_TIMEZONE)
  const bucketMinute =
    Math.floor(londonNow.getMinutes() / RUN_KEY_INTERVAL_MINUTES) *
    RUN_KEY_INTERVAL_MINUTES

  return [
    `${londonNow.getFullYear()}-${pad2(londonNow.getMonth() + 1)}-${pad2(londonNow.getDate())}`,
    `${pad2(londonNow.getHours())}:${pad2(bucketMinute)}`
  ].join('T')
}

function isRunStale(startedAt: string | null | undefined): boolean {
  const startedAtMs = Date.parse(startedAt || '')
  if (!Number.isFinite(startedAtMs)) {
    return true
  }
  return Date.now() - startedAtMs > STALE_RUN_WINDOW_MINUTES * 60 * 1000
}

async function acquireCronRun(runKey: string): Promise<CronRunAcquireResult> {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: existingRunning, error: existingRunningError } = await supabase
    .from('cron_job_runs')
    .select('id, run_key, started_at')
    .eq('job_name', JOB_NAME)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingRunningError) {
    throw existingRunningError
  }

  if (existingRunning && !isRunStale(existingRunning.started_at)) {
    logger.info('Event guest engagement already running, skipping duplicate trigger', {
      metadata: {
        runKey,
        activeRunKey: existingRunning.run_key,
        jobId: existingRunning.id
      }
    })
    return {
      supabase,
      runId: existingRunning.id,
      runKey,
      shouldResolve: false,
      skip: true,
      skipReason: 'already_running'
    }
  }

  if (existingRunning && isRunStale(existingRunning.started_at)) {
    await supabase
      .from('cron_job_runs')
      .update({
        status: 'failed',
        finished_at: nowIso,
        error_message: 'Marked stale by newer invocation'
      })
      .eq('id', existingRunning.id)
      .eq('status', 'running')
  }

  const { data, error } = await supabase
    .from('cron_job_runs')
    .insert({
      job_name: JOB_NAME,
      run_key: runKey,
      status: 'running',
      started_at: nowIso
    })
    .select('id')
    .single()

  if (data?.id) {
    return { supabase, runId: data.id, runKey, shouldResolve: true, skip: false }
  }

  const pgError = error as { code?: string; message?: string } | null
  if (pgError?.code !== '23505') {
    throw error
  }

  const { data: existing, error: fetchError } = await supabase
    .from('cron_job_runs')
    .select('id, status, started_at')
    .eq('job_name', JOB_NAME)
    .eq('run_key', runKey)
    .maybeSingle()

  if (fetchError) {
    throw fetchError
  }
  if (!existing) {
    throw error
  }

  const stale = isRunStale(existing.started_at)
  if (existing.status === 'completed') {
    logger.info('Event guest engagement already completed for this run key', {
      metadata: { runKey, jobId: existing.id }
    })
    return {
      supabase,
      runId: existing.id,
      runKey,
      shouldResolve: false,
      skip: true,
      skipReason: 'already_completed'
    }
  }

  if (existing.status === 'running' && !stale) {
    logger.info('Event guest engagement already running for this run key', {
      metadata: { runKey, jobId: existing.id }
    })
    return {
      supabase,
      runId: existing.id,
      runKey,
      shouldResolve: false,
      skip: true,
      skipReason: 'already_running'
    }
  }

  const { data: restarted, error: restartError } = await supabase
    .from('cron_job_runs')
    .update({
      status: 'running',
      started_at: nowIso,
      finished_at: null,
      error_message: null
    })
    .eq('id', existing.id)
    .select('id')
    .maybeSingle()

  if (restartError) {
    throw restartError
  }

  if (!restarted) {
    logger.warn('Event guest engagement restart update affected no rows; recovering lock', {
      metadata: { runKey, jobId: existing.id }
    })

    const recovered = await recoverCronRunLock(supabase, {
      jobName: JOB_NAME,
      runKey,
      nowIso,
      context: JOB_NAME,
      isRunStale
    })

    if (recovered.result === 'already_completed') {
      return {
        supabase,
        runId: recovered.runId ?? existing.id,
        runKey,
        shouldResolve: false,
        skip: true,
        skipReason: 'already_completed'
      }
    }

    if (recovered.result === 'already_running' || recovered.result === 'missing') {
      return {
        supabase,
        runId: recovered.runId ?? existing.id,
        runKey,
        shouldResolve: false,
        skip: true,
        skipReason: 'already_running'
      }
    }

    return {
      supabase,
      runId: recovered.runId ?? existing.id,
      runKey,
      shouldResolve: true,
      skip: false
    }
  }

  return {
    supabase,
    runId: restarted?.id ?? existing.id,
    runKey,
    shouldResolve: true,
    skip: false
  }
}

async function resolveCronRunResult(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
  status: 'completed' | 'failed',
  errorMessage?: string
) {
  await persistCronRunResult(supabase, {
    runId,
    status,
    errorMessage,
    context: JOB_NAME
  })
}

function chunkArray<T>(input: T[], size = 200): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size))
  }
  return chunks
}

async function sendSmsSafe(
  to: string,
  body: string,
  options: {
    customerId: string
    metadata?: Record<string, unknown>
  },
  context: {
    customerId?: string
    bookingId?: string
    tableBookingId?: string
    eventId?: string
    templateKey?: string
  }
): Promise<Awaited<ReturnType<typeof sendSMS>>> {
  try {
    return await sendSMS(to, body, options)
  } catch (smsError) {
    logger.warn('Failed sending SMS in event guest engagement cron', {
      metadata: {
        ...context,
        error: smsError instanceof Error ? smsError.message : String(smsError)
      }
    })
    return {
      success: false,
      error: smsError instanceof Error ? smsError.message : 'Failed to send SMS'
    } as Awaited<ReturnType<typeof sendSMS>>
  }
}

async function recordAnalyticsEventSafe(
  supabase: ReturnType<typeof createAdminClient>,
  payload: Parameters<typeof recordAnalyticsEvent>[1],
  context: Record<string, unknown>
) {
  try {
    await recordAnalyticsEvent(supabase, payload)
  } catch (analyticsError) {
    logger.warn('Failed recording event guest engagement analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

function isUndefinedTableError(error: any): boolean {
  return error?.code === '42P01'
}

function resolveEventStartIso(event: BookingWithRelations['event']): string | null {
  if (!event) return null
  if (event.start_datetime) return event.start_datetime

  if (event.date && event.time) {
    const local = `${event.date}T${event.time}`
    const asDate = fromZonedTime(local, LONDON_TIMEZONE)
    if (Number.isFinite(asDate.getTime())) {
      return asDate.toISOString()
    }
  }

  return null
}

function formatEventDateTime(isoDateTime: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(isoDateTime))
}

function computeNextMorningNineLondon(eventStartIso: string): Date {
  const londonEventStart = toZonedTime(new Date(eventStartIso), LONDON_TIMEZONE)
  const londonNextMorning = new Date(londonEventStart.getTime())
  londonNextMorning.setDate(londonNextMorning.getDate() + 1)
  londonNextMorning.setHours(9, 0, 0, 0)
  return fromZonedTime(londonNextMorning, LONDON_TIMEZONE)
}

async function loadSentTemplateSet(
  supabase: ReturnType<typeof createAdminClient>,
  bookingIds: string[],
  templateKeys: string[]
): Promise<Set<string>> {
  const sent = new Set<string>()
  if (bookingIds.length === 0 || templateKeys.length === 0) {
    return sent
  }

  for (const idChunk of chunkArray(bookingIds)) {
    const { data, error } = await supabase
      .from('messages')
      .select('event_booking_id, template_key')
      .in('event_booking_id', idChunk)
      .in('template_key', templateKeys)

    if (error) {
      throw error
    }

    for (const row of data || []) {
      const bookingId = (row as any).event_booking_id
      const templateKey = (row as any).template_key
      if (typeof bookingId === 'string' && typeof templateKey === 'string') {
        sent.add(`${bookingId}:${templateKey}`)
      }
    }
  }

  return sent
}

async function loadSentTableTemplateSet(
  supabase: ReturnType<typeof createAdminClient>,
  bookingIds: string[],
  templateKeys: string[]
): Promise<Set<string>> {
  const sent = new Set<string>()
  if (bookingIds.length === 0 || templateKeys.length === 0) {
    return sent
  }

  for (const idChunk of chunkArray(bookingIds)) {
    const { data, error } = await supabase
      .from('messages')
      .select('table_booking_id, template_key')
      .in('table_booking_id', idChunk)
      .in('template_key', templateKeys)

    if (error) {
      throw error
    }

    for (const row of data || []) {
      const bookingId = (row as any).table_booking_id
      const templateKey = (row as any).template_key
      if (typeof bookingId === 'string' && typeof templateKey === 'string') {
        sent.add(`${bookingId}:${templateKey}`)
      }
    }
  }

  return sent
}

async function loadSentEventInterestCustomerSet(
  supabase: ReturnType<typeof createAdminClient>,
  customerIds: string[],
  templateKeys: string[],
  eventId: string
): Promise<Set<string>> {
  const sent = new Set<string>()
  if (customerIds.length === 0 || templateKeys.length === 0) {
    return sent
  }

  for (const customerChunk of chunkArray(customerIds)) {
    const { data, error } = await (supabase.from('messages') as any)
      .select('customer_id')
      .in('customer_id', customerChunk)
      .in('template_key', templateKeys)
      .contains('metadata', { event_id: eventId })
      .not('customer_id', 'is', null)
      .limit(10000)

    if (!error) {
      for (const row of (data || []) as Array<{ customer_id: string | null }>) {
        if (typeof row.customer_id === 'string') {
          sent.add(row.customer_id)
        }
      }
      continue
    }

    logger.warn('Failed loading event-interest dedupe rows via metadata; attempting body fallback', {
      metadata: {
        eventId,
        templateKeys,
        error: error.message
      }
    })

    const { data: fallbackRows, error: fallbackError } = await (supabase.from('messages') as any)
      .select('customer_id')
      .in('customer_id', customerChunk)
      .in('template_key', templateKeys)
      .like('body', `%event_id=${eventId}%`)
      .not('customer_id', 'is', null)
      .limit(10000)

    if (fallbackError) {
      throw fallbackError
    }

    for (const row of (fallbackRows || []) as Array<{ customer_id: string | null }>) {
      if (typeof row.customer_id === 'string') {
        sent.add(row.customer_id)
      }
    }
  }

  return sent
}

async function evaluateEventEngagementSendGuard(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ blocked: boolean; recentCount: number; windowMinutes: number; limit: number }> {
  const windowMinutes = EVENT_ENGAGEMENT_SEND_GUARD_WINDOW_MINUTES
  const limit = EVENT_ENGAGEMENT_HOURLY_SEND_GUARD_LIMIT
  const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString()

  const { count, error } = await (supabase.from('messages') as any)
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .in('template_key', EVENT_ENGAGEMENT_TEMPLATE_KEYS)
    .gte('created_at', sinceIso)

  if (error) {
    const pgError = error as { code?: string; message?: string }
    if (pgError?.code === '42703' || pgError?.code === '42P01') {
      if (allowEventEngagementSendGuardSchemaGaps()) {
        logger.warn('Event engagement send guard skipped because schema is missing expected columns', {
          metadata: { error: pgError.message }
        })
        return { blocked: false, recentCount: 0, windowMinutes, limit }
      }

      logger.error('Event engagement send guard blocked run because schema is unavailable', {
        metadata: { error: pgError.message, windowMinutes, limit }
      })
      return { blocked: true, recentCount: limit, windowMinutes, limit }
    }
    throw error
  }

  const recentCount = count ?? 0
  return {
    blocked: recentCount >= limit,
    recentCount,
    windowMinutes,
    limit
  }
}

async function loadEventBookingsForEngagement(
  supabase: ReturnType<typeof createAdminClient>
): Promise<BookingWithRelations[]> {
  const nowMs = Date.now()
  const windowStartIso = new Date(nowMs - EVENT_ENGAGEMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const windowEndIso = new Date(nowMs + EVENT_ENGAGEMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id,
      customer_id,
      event_id,
      seats,
      is_reminder_only,
      status,
      review_sms_sent_at,
      review_window_closes_at,
      event:events!inner(
        id,
        name,
        start_datetime,
        date,
        time,
        event_status
      ),
      customer:customers(
        id,
        first_name,
        mobile_number,
        sms_status
      )
    `)
    .in('status', ['confirmed'])
    .gte('event.start_datetime', windowStartIso)
    .lte('event.start_datetime', windowEndIso)
    .limit(2000)

  if (error) {
    throw error
  }

  return ((data || []) as any[]).map((row) => ({
    ...row,
    event: Array.isArray(row.event) ? (row.event[0] || null) : (row.event || null),
    customer: Array.isArray(row.customer) ? (row.customer[0] || null) : (row.customer || null)
  })) as BookingWithRelations[]
}

async function loadTableBookingsForEngagement(
  supabase: ReturnType<typeof createAdminClient>
): Promise<TableBookingWithCustomer[]> {
  const nowMs = Date.now()
  const windowStartIso = new Date(nowMs - TABLE_ENGAGEMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const windowEndIso = new Date(nowMs + TABLE_ENGAGEMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('table_bookings')
    .select(`
      id,
      customer_id,
      status,
      booking_type,
      start_datetime,
      review_sms_sent_at,
      customer:customers(
        id,
        first_name,
        mobile_number,
        sms_status
      )
    `)
    .eq('status', 'confirmed')
    .not('start_datetime', 'is', null)
    .gte('start_datetime', windowStartIso)
    .lte('start_datetime', windowEndIso)
    .limit(1000)

  if (error) {
    throw error
  }

  return ((data || []) as any[]).map((row) => ({
    ...row,
    customer: Array.isArray(row.customer) ? (row.customer[0] || null) : (row.customer || null)
  })) as TableBookingWithCustomer[]
}

async function loadEventsForInterestMarketing(
  supabase: ReturnType<typeof createAdminClient>
): Promise<MarketingEventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, slug, start_datetime, event_type, category_id, booking_open, event_status')
    .not('start_datetime', 'is', null)
    .eq('booking_open', true)
    .limit(500)

  if (error) {
    throw error
  }

  return ((data || []) as MarketingEventRow[]).filter((eventRow) => {
    if (!eventRow.start_datetime) return false
    if (eventRow.event_status && ['cancelled', 'draft'].includes(eventRow.event_status)) return false
    return true
  })
}

function buildInterestEventDestination(eventRow: MarketingEventRow): string {
  const slug = typeof eventRow.slug === 'string' ? eventRow.slug.trim() : ''
  if (slug.length > 0) {
    return buildEventBaseUrl(slug)
  }

  return 'https://www.the-anchor.pub/events'
}

function formatEventDateText(isoDateTime: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(isoDateTime))
}

function resolveRelatedEventStart(value: any): string | null {
  const eventRecord = Array.isArray(value) ? value[0] : value
  return typeof eventRecord?.start_datetime === 'string' ? eventRecord.start_datetime : null
}

type InterestReminderTemplateKey =
  | typeof TEMPLATE_INTEREST_REMINDER_14D
  | typeof TEMPLATE_INTEREST_REMINDER_7D
  | typeof TEMPLATE_INTEREST_REMINDER_1D

function resolveInterestReminderTemplate(
  nowMs: number,
  eventStartMs: number
): InterestReminderTemplateKey | null {
  const dueAt14d = eventStartMs - 14 * 24 * 60 * 60 * 1000
  const dueAt7d = eventStartMs - 7 * 24 * 60 * 60 * 1000
  const dueAt1d = eventStartMs - 24 * 60 * 60 * 1000

  if (nowMs >= dueAt1d) return TEMPLATE_INTEREST_REMINDER_1D
  if (nowMs >= dueAt7d) return TEMPLATE_INTEREST_REMINDER_7D
  if (nowMs >= dueAt14d) return TEMPLATE_INTEREST_REMINDER_14D
  return null
}

function hasSentInterestReminder(
  row: ManualInterestRecipientRow,
  templateKey: InterestReminderTemplateKey
): boolean {
  if (templateKey === TEMPLATE_INTEREST_REMINDER_14D) {
    return typeof row.reminder_14d_sent_at === 'string'
  }
  if (templateKey === TEMPLATE_INTEREST_REMINDER_7D) {
    return typeof row.reminder_7d_sent_at === 'string'
  }
  return typeof row.reminder_1d_sent_at === 'string'
}

function interestReminderUpdatePayload(
  templateKey: InterestReminderTemplateKey,
  sentAt: string
): Record<string, string> {
  if (templateKey === TEMPLATE_INTEREST_REMINDER_14D) {
    return { reminder_14d_sent_at: sentAt }
  }
  if (templateKey === TEMPLATE_INTEREST_REMINDER_7D) {
    return { reminder_7d_sent_at: sentAt }
  }
  return { reminder_1d_sent_at: sentAt }
}

async function processInterestMarketing(
  supabase: ReturnType<typeof createAdminClient>,
  safety: EventEngagementCronSafetyState
): Promise<{ sent: number; skipped: number; eventsProcessed: number }> {
  const nowMs = Date.now()
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const events = await loadEventsForInterestMarketing(supabase)

  const result = {
    sent: 0,
    skipped: 0,
    eventsProcessed: 0
  }

  for (const eventRow of events) {
    if (result.sent >= MAX_INTEREST_MARKETING_SMS_PER_RUN) {
      break
    }

    if (!eventRow.start_datetime) {
      result.skipped += 1
      continue
    }

    const eventStartMs = Date.parse(eventRow.start_datetime)
    if (!Number.isFinite(eventStartMs) || eventStartMs <= nowMs) {
      result.skipped += 1
      continue
    }

    const manualTemplateKey = resolveInterestReminderTemplate(nowMs, eventStartMs)
    if (!manualTemplateKey) {
      result.skipped += 1
      continue
    }

    result.eventsProcessed += 1
    const eventCategoryId =
      typeof eventRow.category_id === 'string' && eventRow.category_id.trim().length > 0
        ? eventRow.category_id
        : null
    const eventType =
      typeof eventRow.event_type === 'string' && eventRow.event_type.trim().length > 0
        ? eventRow.event_type
        : null
    const matchingBasis: 'category' | 'event_type' | null = eventCategoryId ? 'category' : eventType ? 'event_type' : null

    const [pastBookings, pastWaitlist, existingBookings, manualRecipients] = await Promise.all([
      matchingBasis === 'category'
        ? supabase
            .from('bookings')
            .select('customer_id, event:events!inner(category_id, start_datetime)')
            .not('customer_id', 'is', null)
            .eq('event.category_id', eventCategoryId)
        : matchingBasis === 'event_type'
          ? supabase
              .from('bookings')
              .select('customer_id, event:events!inner(event_type, start_datetime)')
              .not('customer_id', 'is', null)
              .eq('event.event_type', eventType)
          : Promise.resolve({ data: [], error: null } as any),
      matchingBasis === 'category'
        ? supabase
            .from('waitlist_entries')
            .select('customer_id, event:events!inner(category_id, start_datetime)')
            .not('customer_id', 'is', null)
            .eq('event.category_id', eventCategoryId)
        : matchingBasis === 'event_type'
          ? supabase
              .from('waitlist_entries')
              .select('customer_id, event:events!inner(event_type, start_datetime)')
              .not('customer_id', 'is', null)
              .eq('event.event_type', eventType)
          : Promise.resolve({ data: [], error: null } as any),
      supabase
        .from('bookings')
        .select('customer_id, is_reminder_only')
        .eq('event_id', eventRow.id)
        .in('status', ['confirmed', 'pending_payment'])
        .not('customer_id', 'is', null),
      (supabase.from('event_interest_manual_recipients') as any)
        .select('id, customer_id, reminder_14d_sent_at, reminder_7d_sent_at, reminder_1d_sent_at')
        .eq('event_id', eventRow.id)
    ])

    let manualRecipientsData = (manualRecipients.data || []) as ManualInterestRecipientRow[]
    let manualRecipientsErrorMessage: string | undefined

    if (manualRecipients.error) {
      if (isUndefinedTableError(manualRecipients.error)) {
        const fallbackManualRecipients = await supabase
          .from('bookings')
          .select('customer_id')
          .eq('event_id', eventRow.id)
          .eq('is_reminder_only', true)
          .in('status', ['confirmed', 'pending_payment'])
          .not('customer_id', 'is', null)

        if (fallbackManualRecipients.error) {
          manualRecipientsErrorMessage = fallbackManualRecipients.error.message
        } else {
          manualRecipientsData = ((fallbackManualRecipients.data || []) as Array<{ customer_id: string | null }>)
            .map((row) => ({
              id: null,
              customer_id: row.customer_id,
              reminder_14d_sent_at: null,
              reminder_7d_sent_at: null,
              reminder_1d_sent_at: null
            }))
        }
      } else if (manualRecipients.error?.code === '42703') {
        const fallbackManualRecipients = await (supabase.from('event_interest_manual_recipients') as any)
          .select('id, customer_id')
          .eq('event_id', eventRow.id)

        if (fallbackManualRecipients.error) {
          manualRecipientsErrorMessage = fallbackManualRecipients.error.message
        } else {
          manualRecipientsData = ((fallbackManualRecipients.data || []) as Array<{ customer_id: string | null }>)
            .map((row) => ({
              id: null,
              customer_id: row.customer_id,
              reminder_14d_sent_at: null,
              reminder_7d_sent_at: null,
              reminder_1d_sent_at: null
            }))
        }
      } else {
        manualRecipientsErrorMessage = manualRecipients.error.message
      }
    }

    if (pastBookings.error || pastWaitlist.error || existingBookings.error || manualRecipientsErrorMessage) {
      logger.warn('Failed loading event interest marketing segments', {
        metadata: {
          eventId: eventRow.id,
          matchingBasis,
          bookingError: pastBookings.error?.message,
          waitlistError: pastWaitlist.error?.message,
          existingError: existingBookings.error?.message,
          manualError: manualRecipientsErrorMessage
        }
      })
      continue
    }

    const interestedCustomerIds = new Set<string>()
    for (const row of (pastBookings.data || []) as any[]) {
      const customerId = row.customer_id
      const eventStartIso = resolveRelatedEventStart(row?.event)
      if (typeof customerId === 'string' && typeof eventStartIso === 'string' && Date.parse(eventStartIso) < nowMs) {
        interestedCustomerIds.add(customerId)
      }
    }
    for (const row of (pastWaitlist.data || []) as any[]) {
      const customerId = row.customer_id
      const eventStartIso = resolveRelatedEventStart(row?.event)
      if (typeof customerId === 'string' && typeof eventStartIso === 'string' && Date.parse(eventStartIso) < nowMs) {
        interestedCustomerIds.add(customerId)
      }
    }
    for (const row of manualRecipientsData) {
      const customerId = row?.customer_id
      if (typeof customerId === 'string') {
        interestedCustomerIds.add(customerId)
      }
    }

    if (interestedCustomerIds.size === 0) {
      continue
    }

    const alreadyBooked = new Set<string>(
      ((existingBookings.data || []) as any[])
        .filter((row) => row?.is_reminder_only !== true)
        .map((row) => row?.customer_id)
        .filter((value): value is string => typeof value === 'string')
    )

    const manualRecipientsByCustomer = new Map<string, ManualInterestRecipientRow>()
    for (const row of manualRecipientsData) {
      if (typeof row.customer_id !== 'string') continue
      manualRecipientsByCustomer.set(row.customer_id, row)
    }

    const manualCandidateIds = Array.from(manualRecipientsByCustomer.keys()).filter(
      (customerId) => !alreadyBooked.has(customerId)
    )
    const behaviorCandidateIds = Array.from(interestedCustomerIds).filter(
      (customerId) => !alreadyBooked.has(customerId) && !manualRecipientsByCustomer.has(customerId)
    )

    if (behaviorCandidateIds.length > 0) {
      let alreadyMessaged: Set<string>

      try {
        alreadyMessaged = await loadSentEventInterestCustomerSet(
          supabase,
          behaviorCandidateIds,
          [TEMPLATE_INTEREST_MARKETING_14D],
          eventRow.id
        )
      } catch (error) {
        logger.error('Failed loading event-interest dedupe set for interest marketing', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: {
            eventId: eventRow.id,
            templateKey: TEMPLATE_INTEREST_MARKETING_14D,
            customerCount: behaviorCandidateIds.length,
          },
        })
        safety.recordSafetyAbort({
          stage: 'interest_marketing:dedupe',
          bookingId: null,
          tableBookingId: null,
          customerId: null,
          eventId: eventRow.id,
          templateKey: TEMPLATE_INTEREST_MARKETING_14D,
          code: 'dedupe_unavailable',
          logFailure: false,
        })
        safety.throwSafetyAbort()
      }
      const candidateIds = behaviorCandidateIds.filter((customerId) => !alreadyMessaged.has(customerId))

      if (candidateIds.length > 0) {
        const { data: customers, error: customerError } = await supabase
          .from('customers')
          .select('id, first_name, mobile_number, sms_status, marketing_sms_opt_in')
          .in('id', candidateIds)
          .eq('sms_status', 'active')
          .eq('marketing_sms_opt_in', true)

        if (customerError) {
          logger.warn('Failed loading customers for interest marketing', {
            metadata: {
              eventId: eventRow.id,
              error: customerError.message
            }
          })
        } else {
          for (const customer of (customers || []) as any[]) {
            if (result.sent >= MAX_INTEREST_MARKETING_SMS_PER_RUN) {
              break
            }

            if (!customer?.mobile_number || !customer?.id) {
              continue
            }

            const firstName = customer.first_name || 'there'
            const eventDateText = formatEventDateText(eventRow.start_datetime)
            const destination = buildInterestEventDestination(eventRow)
            const body = ensureReplyInstruction(
              `The Anchor: Hi ${firstName}, reminder: ${eventRow.name} is coming up on ${eventDateText}. Book here: ${destination} Reply STOP to opt out.`,
              supportPhone
            )

            const smsResult = await sendSmsSafe(customer.mobile_number, body, {
              customerId: customer.id,
              metadata: {
                event_id: eventRow.id,
                event_type: eventType,
                category_id: eventCategoryId,
                matching_basis: matchingBasis,
                template_key: TEMPLATE_INTEREST_MARKETING_14D,
                marketing: true
              }
            }, {
              customerId: customer.id,
              eventId: eventRow.id,
              templateKey: TEMPLATE_INTEREST_MARKETING_14D
            })

            maybeRecordFatalSmsSafetyAbort(safety, smsResult, {
              stage: 'interest_marketing:send_sms',
              bookingId: null,
              tableBookingId: null,
              customerId: customer.id,
              eventId: eventRow.id,
              templateKey: TEMPLATE_INTEREST_MARKETING_14D,
            })
            if (safety.primaryAbort) {
              safety.throwSafetyAbort()
            }

            if (!smsResult.success) {
              result.skipped += 1
              continue
            }

            result.sent += 1
          }
        }
      }
    }

    if (result.sent >= MAX_INTEREST_MARKETING_SMS_PER_RUN) {
      break
    }

    if (manualCandidateIds.length > 0) {
      let alreadyMessagedManualTemplate: Set<string>

      try {
        alreadyMessagedManualTemplate = await loadSentEventInterestCustomerSet(
          supabase,
          manualCandidateIds,
          [manualTemplateKey],
          eventRow.id
        )
      } catch (error) {
        logger.error('Failed loading event-interest dedupe set for manual-interest marketing', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: {
            eventId: eventRow.id,
            templateKey: manualTemplateKey,
            customerCount: manualCandidateIds.length,
          },
        })
        safety.recordSafetyAbort({
          stage: 'interest_marketing:dedupe',
          bookingId: null,
          tableBookingId: null,
          customerId: null,
          eventId: eventRow.id,
          templateKey: manualTemplateKey,
          code: 'dedupe_unavailable',
          logFailure: false,
        })
        safety.throwSafetyAbort()
      }

      const { data: manualCustomers, error: manualCustomerError } = await supabase
        .from('customers')
        .select('id, first_name, mobile_number, sms_status, marketing_sms_opt_in')
        .in('id', manualCandidateIds)
        .eq('sms_status', 'active')
        .eq('marketing_sms_opt_in', true)

      if (manualCustomerError) {
        logger.warn('Failed loading manual-interest recipients', {
          metadata: {
            eventId: eventRow.id,
            error: manualCustomerError.message
          }
        })
        continue
      }

      for (const customer of (manualCustomers || []) as any[]) {
        if (result.sent >= MAX_INTEREST_MARKETING_SMS_PER_RUN) {
          break
        }

        if (!customer?.mobile_number || !customer?.id) {
          continue
        }

        const manualRecipient = manualRecipientsByCustomer.get(customer.id)
        if (!manualRecipient) {
          result.skipped += 1
          continue
        }

        const alreadySentForTemplate = typeof manualRecipient.id === 'string'
          ? hasSentInterestReminder(manualRecipient, manualTemplateKey)
          : alreadyMessagedManualTemplate.has(customer.id)
        if (alreadySentForTemplate) {
          result.skipped += 1
          continue
        }

        const firstName = customer.first_name || 'there'
        const eventDateText = formatEventDateText(eventRow.start_datetime)
        const destination = buildInterestEventDestination(eventRow)
        const baseBody = manualTemplateKey === TEMPLATE_INTEREST_REMINDER_1D
          ? `The Anchor: Hi ${firstName}, reminder: ${eventRow.name} is tomorrow at ${eventDateText}.`
          : `The Anchor: Hi ${firstName}, reminder: ${eventRow.name} is coming up on ${eventDateText}.`
        const body = ensureReplyInstruction(
          `${baseBody} Book here: ${destination}`,
          supportPhone
        )

        const smsResult = await sendSmsSafe(customer.mobile_number, body, {
          customerId: customer.id,
          metadata: {
            event_id: eventRow.id,
            event_type: eventType,
            category_id: eventCategoryId,
            matching_basis: matchingBasis,
            template_key: manualTemplateKey,
            marketing: true,
            manual_interest: true
          }
        }, {
          customerId: customer.id,
          eventId: eventRow.id,
          templateKey: manualTemplateKey
        })

        maybeRecordFatalSmsSafetyAbort(safety, smsResult, {
          stage: 'interest_marketing:send_sms',
          bookingId: null,
          tableBookingId: null,
          customerId: customer.id,
          eventId: eventRow.id,
          templateKey: manualTemplateKey,
        })

        if (!smsResult.success) {
          result.skipped += 1
          if (safety.primaryAbort) {
            safety.throwSafetyAbort()
          }
          continue
        }

        const sentAt = smsResult.scheduledFor || new Date().toISOString()
        if (typeof manualRecipient.id === 'string') {
          const { data: updatedManualRecipient, error: updateError } = await (supabase.from('event_interest_manual_recipients') as any)
            .update(interestReminderUpdatePayload(manualTemplateKey, sentAt))
            .eq('id', manualRecipient.id)
            .eq('event_id', eventRow.id)
            .eq('customer_id', customer.id)
            .select('id')
            .maybeSingle()

          if (updateError) {
            logger.warn('Failed updating manual-interest reminder cadence state', {
              metadata: {
                eventId: eventRow.id,
                customerId: customer.id,
                templateKey: manualTemplateKey,
                error: updateError.message
              }
            })
          } else if (!updatedManualRecipient) {
            logger.warn('Manual-interest reminder cadence state update affected no rows', {
              metadata: {
                eventId: eventRow.id,
                customerId: customer.id,
                templateKey: manualTemplateKey
              }
            })
          }
        } else {
          alreadyMessagedManualTemplate.add(customer.id)
        }

        result.sent += 1
        if (safety.primaryAbort) {
          safety.throwSafetyAbort()
        }
      }
    }
  }

  return result
}

async function processReminders(
  supabase: ReturnType<typeof createAdminClient>,
  bookings: BookingWithRelations[],
  appBaseUrl: string,
  safety: EventEngagementCronSafetyState
): Promise<{ sent7d: number; sent1d: number; skipped: number }> {
  const now = new Date()
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const bookingIds = bookings.map((b) => b.id)
  let sentSet: Set<string>

  try {
    sentSet = await loadSentTemplateSet(supabase, bookingIds, [TEMPLATE_REMINDER_7D, TEMPLATE_REMINDER_1D])
  } catch (error) {
    logger.error('Failed loading event engagement reminder dedupe set', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        bookingCount: bookingIds.length,
      },
    })
    safety.recordSafetyAbort({
      stage: 'reminders:dedupe',
      bookingId: null,
      tableBookingId: null,
      customerId: null,
      eventId: null,
      templateKey: null,
      code: 'dedupe_unavailable',
      logFailure: false,
    })
    safety.throwSafetyAbort()
  }

  const result = {
    sent7d: 0,
    sent1d: 0,
    skipped: 0
  }
  const bookedCustomerEventKeys = new Set(
    bookings
      .filter((booking) => booking.is_reminder_only !== true)
      .map((booking) => `${booking.event_id}:${booking.customer_id}`)
  )

  for (const booking of bookings) {
    if (
      booking.is_reminder_only === true &&
      bookedCustomerEventKeys.has(`${booking.event_id}:${booking.customer_id}`)
    ) {
      result.skipped += 1
      continue
    }

    const customer = booking.customer
    const event = booking.event
    const eventStartIso = resolveEventStartIso(event)
    if (!customer || !event || !eventStartIso || !customer.mobile_number || customer.sms_status !== 'active') {
      result.skipped += 1
      continue
    }

    if (event.event_status && ['cancelled', 'draft'].includes(event.event_status)) {
      result.skipped += 1
      continue
    }

    const eventStart = new Date(eventStartIso)
    if (eventStart.getTime() <= now.getTime()) {
      result.skipped += 1
      continue
    }

    const dueAt7d = eventStart.getTime() - 7 * 24 * 60 * 60 * 1000
    const dueAt1d = eventStart.getTime() - 24 * 60 * 60 * 1000
    const shouldSend1d = now.getTime() >= dueAt1d
    const shouldSend7d = now.getTime() >= dueAt7d && now.getTime() < dueAt1d

    let templateKey: string | null = null
    if (shouldSend1d) templateKey = TEMPLATE_REMINDER_1D
    else if (shouldSend7d) templateKey = TEMPLATE_REMINDER_7D

    if (!templateKey) {
      result.skipped += 1
      continue
    }

    if (sentSet.has(`${booking.id}:${templateKey}`)) {
      result.skipped += 1
      continue
    }

    let manageLink: string | null = null
    try {
      const token = await createEventManageToken(supabase, {
        customerId: booking.customer_id,
        bookingId: booking.id,
        eventStartIso,
        appBaseUrl
      })
      manageLink = token.url
    } catch {
      manageLink = null
    }

    const firstName = customer.first_name || 'there'
    const eventDateText = formatEventDateTime(eventStartIso)
    const baseBody = templateKey === TEMPLATE_REMINDER_1D
      ? `The Anchor: Hi ${firstName}, reminder: ${event.name} is tomorrow at ${eventDateText}.`
      : `The Anchor: Hi ${firstName}, reminder: ${event.name} is coming up on ${eventDateText}.`
    const messageBody = ensureReplyInstruction(
      manageLink ? `${baseBody} Manage booking: ${manageLink}` : baseBody,
      supportPhone
    )

    const smsResult = await sendSmsSafe(customer.mobile_number, messageBody, {
      customerId: customer.id,
      metadata: {
        event_booking_id: booking.id,
        event_id: event.id,
        template_key: templateKey
      }
    }, {
      customerId: customer.id,
      bookingId: booking.id,
      eventId: event.id,
      templateKey: templateKey
    })

    maybeRecordFatalSmsSafetyAbort(safety, smsResult, {
      stage: 'reminders:send_sms',
      bookingId: booking.id,
      tableBookingId: null,
      customerId: customer.id,
      eventId: event.id,
      templateKey: templateKey,
    })
    if (safety.primaryAbort) {
      safety.throwSafetyAbort()
    }

    if (!smsResult.success) {
      result.skipped += 1
      continue
    }

    sentSet.add(`${booking.id}:${templateKey}`)
    if (templateKey === TEMPLATE_REMINDER_1D) result.sent1d += 1
    else result.sent7d += 1
  }

  return result
}

async function processReviewFollowups(
  supabase: ReturnType<typeof createAdminClient>,
  bookings: BookingWithRelations[],
  appBaseUrl: string,
  safety: EventEngagementCronSafetyState
): Promise<{ sent: number; skipped: number }> {
  const now = new Date()
  const nowMs = now.getTime()
  const maxAgeMs = EVENT_ENGAGEMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const reviewLinkTarget = await getGoogleReviewLink(supabase)

  const confirmedPastBookings = bookings.filter((booking) => {
    if (booking.status !== 'confirmed' || booking.review_sms_sent_at) return false
    const eventStartIso = resolveEventStartIso(booking.event)
    if (!eventStartIso) return false
    const eventStart = new Date(eventStartIso)
    const eventStartMs = eventStart.getTime()
    return eventStartMs <= nowMs && nowMs - eventStartMs <= maxAgeMs
  })
  const boundedPastBookings = confirmedPastBookings.slice(0, MAX_EVENT_REVIEW_FOLLOWUPS_PER_RUN)

  let sentSet: Set<string>

  try {
    sentSet = await loadSentTemplateSet(
      supabase,
      boundedPastBookings.map((b) => b.id),
      [TEMPLATE_REVIEW_FOLLOWUP]
    )
  } catch (error) {
    logger.error('Failed loading event engagement review-followup dedupe set', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        bookingCount: boundedPastBookings.length,
      },
    })
    safety.recordSafetyAbort({
      stage: 'reviews:dedupe',
      bookingId: null,
      tableBookingId: null,
      customerId: null,
      eventId: null,
      templateKey: TEMPLATE_REVIEW_FOLLOWUP,
      code: 'dedupe_unavailable',
      logFailure: false,
    })
    safety.throwSafetyAbort()
  }

  const result = { sent: 0, skipped: 0 }

  for (const booking of boundedPastBookings) {
    const customer = booking.customer
    const event = booking.event
    const eventStartIso = resolveEventStartIso(event)
    if (!customer || !event || !eventStartIso || !customer.mobile_number || customer.sms_status !== 'active') {
      result.skipped += 1
      continue
    }

    const dueAt = computeNextMorningNineLondon(eventStartIso)
    if (now.getTime() < dueAt.getTime()) {
      result.skipped += 1
      continue
    }

    if (sentSet.has(`${booking.id}:${TEMPLATE_REVIEW_FOLLOWUP}`)) {
      result.skipped += 1
      continue
    }

    const provisionalExpiry = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString()
    const { rawToken, hashedToken } = await createGuestToken(supabase, {
      customerId: customer.id,
      actionType: 'review_redirect',
      eventBookingId: booking.id,
      expiresAt: provisionalExpiry
    })

    const redirectUrl = `${appBaseUrl}/r/${rawToken}`
    const firstName = customer.first_name || 'there'
    const messageBody = ensureReplyInstruction(
      `The Anchor: Hi ${firstName}, thanks for booking ${event.name}. We'd love your feedback: ${redirectUrl}`,
      supportPhone
    )

    const smsResult = await sendSmsSafe(customer.mobile_number, messageBody, {
      customerId: customer.id,
      metadata: {
        event_booking_id: booking.id,
        event_id: event.id,
        template_key: TEMPLATE_REVIEW_FOLLOWUP,
        review_redirect_target: reviewLinkTarget
      }
    }, {
      customerId: customer.id,
      bookingId: booking.id,
      eventId: event.id,
      templateKey: TEMPLATE_REVIEW_FOLLOWUP
    })

    maybeRecordFatalSmsSafetyAbort(safety, smsResult, {
      stage: 'reviews:send_sms',
      bookingId: booking.id,
      tableBookingId: null,
      customerId: customer.id,
      eventId: event.id,
      templateKey: TEMPLATE_REVIEW_FOLLOWUP,
    })

    if (!smsResult.success) {
      const { error: deleteTokenError } = await supabase
        .from('guest_tokens')
        .delete()
        .eq('hashed_token', hashedToken)
      if (deleteTokenError) {
        logger.warn('Failed deleting provisional review token after SMS failure', {
          metadata: {
            bookingId: booking.id,
            customerId: customer.id,
            error: deleteTokenError.message
          }
        })
      }
      result.skipped += 1
      if (safety.primaryAbort) {
        safety.throwSafetyAbort()
      }
      continue
    }

    const reviewSentAt = smsResult.scheduledFor || new Date().toISOString()
    const reviewWindowClosesAt = new Date(Date.parse(reviewSentAt) + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: updatedBooking, error: bookingUpdateError } = await supabase
      .from('bookings')
      .update({
        status: 'visited_waiting_for_review',
        review_sms_sent_at: reviewSentAt,
        review_window_closes_at: reviewWindowClosesAt,
        updated_at: new Date().toISOString()
      })
      .eq('id', booking.id)
      .eq('status', 'confirmed')
      .select('id')
      .maybeSingle()
    if (bookingUpdateError) {
      logger.warn('Failed updating event booking review follow-up state after SMS send', {
        metadata: {
          bookingId: booking.id,
          customerId: customer.id,
          error: bookingUpdateError.message
        }
      })
    } else if (!updatedBooking) {
      logger.warn('Review follow-up state update affected no booking rows after SMS send', {
        metadata: {
          bookingId: booking.id,
          customerId: customer.id
        }
      })
    }

    const { data: updatedToken, error: tokenUpdateError } = await supabase
      .from('guest_tokens')
      .update({
        expires_at: reviewWindowClosesAt
      })
      .eq('hashed_token', hashedToken)
      .select('id')
      .maybeSingle()
    if (tokenUpdateError) {
      logger.warn('Failed updating review token expiry after SMS send', {
        metadata: {
          bookingId: booking.id,
          customerId: customer.id,
          error: tokenUpdateError.message
        }
      })
    } else if (!updatedToken) {
      logger.warn('Review token expiry update affected no rows after SMS send', {
        metadata: {
          bookingId: booking.id,
          customerId: customer.id
        }
      })
    }

    try {
      await recordAnalyticsEvent(supabase, {
        customerId: customer.id,
        eventBookingId: booking.id,
        eventType: 'review_sms_sent',
        metadata: {
          event_id: event.id,
          review_sent_at: reviewSentAt,
          review_window_closes_at: reviewWindowClosesAt
        }
      })
    } catch (analyticsError) {
      logger.warn('Failed to record review follow-up analytics event', {
        metadata: {
          bookingId: booking.id,
          customerId: customer.id,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        }
      })
    }

    result.sent += 1
    if (safety.primaryAbort) {
      safety.throwSafetyAbort()
    }
  }

  return result
}

async function processTableReviewFollowups(
  supabase: ReturnType<typeof createAdminClient>,
  tableBookings: TableBookingWithCustomer[],
  appBaseUrl: string,
  safety: EventEngagementCronSafetyState
): Promise<{ sent: number; skipped: number }> {
  const now = Date.now()
  const maxAgeMs = TABLE_ENGAGEMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const reviewLinkTarget = await getGoogleReviewLink(supabase)

  const eligibleBookings = tableBookings.filter((booking) => {
    if (booking.status !== 'confirmed' || booking.review_sms_sent_at) return false
    const startMs = Date.parse(booking.start_datetime || '')
    if (!Number.isFinite(startMs)) return false
    return now >= startMs + 4 * 60 * 60 * 1000 && now - startMs <= maxAgeMs
  })
  const boundedEligibleBookings = eligibleBookings.slice(0, MAX_TABLE_REVIEW_FOLLOWUPS_PER_RUN)

  let sentSet: Set<string>

  try {
    sentSet = await loadSentTableTemplateSet(
      supabase,
      boundedEligibleBookings.map((booking) => booking.id),
      [TEMPLATE_TABLE_REVIEW_FOLLOWUP]
    )
  } catch (error) {
    logger.error('Failed loading table booking review-followup dedupe set', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        bookingCount: boundedEligibleBookings.length,
      },
    })
    safety.recordSafetyAbort({
      stage: 'table_reviews:dedupe',
      bookingId: null,
      tableBookingId: null,
      customerId: null,
      eventId: null,
      templateKey: TEMPLATE_TABLE_REVIEW_FOLLOWUP,
      code: 'dedupe_unavailable',
      logFailure: false,
    })
    safety.throwSafetyAbort()
  }

  const result = { sent: 0, skipped: 0 }

  for (const booking of boundedEligibleBookings) {
    const customer = booking.customer
    if (!customer || !customer.mobile_number || customer.sms_status !== 'active') {
      result.skipped += 1
      continue
    }

    if (sentSet.has(`${booking.id}:${TEMPLATE_TABLE_REVIEW_FOLLOWUP}`)) {
      result.skipped += 1
      continue
    }

    const provisionalExpiry = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString()
    const { rawToken, hashedToken } = await createGuestToken(supabase, {
      customerId: customer.id,
      actionType: 'review_redirect',
      tableBookingId: booking.id,
      expiresAt: provisionalExpiry
    })

    const redirectUrl = `${appBaseUrl}/r/${rawToken}`
    const firstName = customer.first_name || 'there'
    const messageBody = ensureReplyInstruction(
      `The Anchor: Hi ${firstName}, thanks for visiting The Anchor. We'd love your feedback: ${redirectUrl}`,
      supportPhone
    )

    const smsResult = await sendSmsSafe(customer.mobile_number, messageBody, {
      customerId: customer.id,
      metadata: {
        table_booking_id: booking.id,
        template_key: TEMPLATE_TABLE_REVIEW_FOLLOWUP,
        review_redirect_target: reviewLinkTarget
      }
    }, {
      customerId: customer.id,
      tableBookingId: booking.id,
      templateKey: TEMPLATE_TABLE_REVIEW_FOLLOWUP
    })

    maybeRecordFatalSmsSafetyAbort(safety, smsResult, {
      stage: 'table_reviews:send_sms',
      bookingId: null,
      tableBookingId: booking.id,
      customerId: customer.id,
      eventId: null,
      templateKey: TEMPLATE_TABLE_REVIEW_FOLLOWUP,
    })

    if (!smsResult.success) {
      const { error: deleteTokenError } = await supabase
        .from('guest_tokens')
        .delete()
        .eq('hashed_token', hashedToken)
      if (deleteTokenError) {
        logger.warn('Failed deleting provisional table-review token after SMS failure', {
          metadata: {
            tableBookingId: booking.id,
            customerId: customer.id,
            error: deleteTokenError.message
          }
        })
      }
      result.skipped += 1
      if (safety.primaryAbort) {
        safety.throwSafetyAbort()
      }
      continue
    }

    const reviewSentAt = smsResult.scheduledFor || new Date().toISOString()
    const reviewWindowClosesAt = new Date(Date.parse(reviewSentAt) + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: updatedTableBooking, error: tableBookingUpdateError } = await (supabase.from('table_bookings') as any)
      .update({
        status: 'visited_waiting_for_review',
        review_sms_sent_at: reviewSentAt,
        updated_at: new Date().toISOString()
      })
      .eq('id', booking.id)
      .eq('status', 'confirmed')
      .select('id')
      .maybeSingle()
    if (tableBookingUpdateError) {
      logger.warn('Failed updating table booking review follow-up state after SMS send', {
        metadata: {
          tableBookingId: booking.id,
          customerId: customer.id,
          error: tableBookingUpdateError.message
        }
      })
    } else if (!updatedTableBooking) {
      logger.warn('Table-booking review follow-up state update affected no rows after SMS send', {
        metadata: {
          tableBookingId: booking.id,
          customerId: customer.id
        }
      })
    }

    const { data: updatedTableReviewToken, error: tokenUpdateError } = await supabase
      .from('guest_tokens')
      .update({
        expires_at: reviewWindowClosesAt
      })
      .eq('hashed_token', hashedToken)
      .select('id')
      .maybeSingle()
    if (tokenUpdateError) {
      logger.warn('Failed updating table-review token expiry after SMS send', {
        metadata: {
          tableBookingId: booking.id,
          customerId: customer.id,
          error: tokenUpdateError.message
        }
      })
    } else if (!updatedTableReviewToken) {
      logger.warn('Table-review token expiry update affected no rows after SMS send', {
        metadata: {
          tableBookingId: booking.id,
          customerId: customer.id
        }
      })
    }

    try {
      await recordAnalyticsEvent(supabase, {
        customerId: customer.id,
        tableBookingId: booking.id,
        eventType: 'review_sms_sent',
        metadata: {
          booking_type: booking.booking_type || 'regular',
          review_sent_at: reviewSentAt,
          review_window_closes_at: reviewWindowClosesAt
        }
      })
    } catch (analyticsError) {
      logger.warn('Failed to record table-review follow-up analytics event', {
        metadata: {
          tableBookingId: booking.id,
          customerId: customer.id,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        }
      })
    }

    result.sent += 1
    if (safety.primaryAbort) {
      safety.throwSafetyAbort()
    }
  }

  return result
}

async function processReviewWindowCompletion(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ completed: number }> {
  const nowIso = new Date().toISOString()
  const result = { completed: 0 }

  const { data: rows, error } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id')
    .in('status', ['visited_waiting_for_review', 'review_clicked'])
    .not('review_window_closes_at', 'is', null)
    .lte('review_window_closes_at', nowIso)
    .limit(1000)

  if (error) {
    throw error
  }

  const bookingRows = (rows || []) as Array<{ id: string; customer_id: string; event_id: string }>
  if (bookingRows.length === 0) {
    return result
  }

  for (const idChunk of chunkArray(bookingRows.map((row) => row.id))) {
    const { data: updatedRows, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'completed',
        completed_at: nowIso,
        updated_at: nowIso
      })
      .in('id', idChunk)
      .in('status', ['visited_waiting_for_review', 'review_clicked'])
      .select('id, customer_id, event_id')

    if (updateError) {
      throw updateError
    }

    for (const updated of (updatedRows || []) as Array<{ id: string; customer_id: string; event_id: string }>) {
      result.completed += 1
      await recordAnalyticsEventSafe(supabase, {
        customerId: updated.customer_id,
        eventBookingId: updated.id,
        eventType: 'review_window_closed',
        metadata: {
          event_id: updated.event_id
        }
      }, {
        bookingId: updated.id,
        customerId: updated.customer_id,
        eventId: updated.event_id,
        eventType: 'review_window_closed'
      })
    }
  }

  return result
}

async function processTableReviewWindowCompletion(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ completed: number }> {
  const nowMs = Date.now()
  const nowIso = new Date().toISOString()
  const result = { completed: 0 }

  const { data: rows, error } = await (supabase.from('table_bookings') as any)
    .select('id, customer_id, booking_type, review_sms_sent_at')
    .in('status', ['visited_waiting_for_review', 'review_clicked'])
    .not('review_sms_sent_at', 'is', null)
    .limit(1000)

  if (error) {
    throw error
  }

  const bookingRows = ((rows || []) as Array<{
    id: string
    customer_id: string
    booking_type: string | null
    review_sms_sent_at: string | null
  }>).filter((row) => {
    const sentAtMs = Date.parse(row.review_sms_sent_at || '')
    if (!Number.isFinite(sentAtMs)) return false
    return sentAtMs + 7 * 24 * 60 * 60 * 1000 <= nowMs
  })
  if (bookingRows.length === 0) {
    return result
  }

  for (const idChunk of chunkArray(bookingRows.map((row) => row.id))) {
    const { data: updatedRows, error: updateError } = await (supabase.from('table_bookings') as any)
      .update({
        status: 'completed',
        completed_at: nowIso,
        updated_at: nowIso
      })
      .in('id', idChunk)
      .in('status', ['visited_waiting_for_review', 'review_clicked'])
      .select('id, customer_id, booking_type')

    if (updateError) {
      throw updateError
    }

    for (const updated of (updatedRows || []) as Array<{ id: string; customer_id: string; booking_type: string | null }>) {
      result.completed += 1
      await recordAnalyticsEventSafe(supabase, {
        customerId: updated.customer_id,
        tableBookingId: updated.id,
        eventType: 'review_window_closed',
        metadata: {
          booking_type: updated.booking_type || 'regular'
        }
      }, {
        tableBookingId: updated.id,
        customerId: updated.customer_id,
        eventType: 'review_window_closed'
      })
    }
  }

  return result
}

export async function GET(request: NextRequest) {
  let runContext: {
    supabase: ReturnType<typeof createAdminClient>
    runId: string
    runKey: string
    shouldResolve: boolean
  } | null = null
  let resolvedStatus: 'completed' | 'failed' | null = null
  let runErrorMessage: string | undefined
  let guard: Awaited<ReturnType<typeof evaluateEventEngagementSendGuard>> | null = null
  const safetyAborts: EventEngagementCronSafetyAbort[] = []

  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  try {
    const runKey = getLondonRunKey()
    const acquireResult = await acquireCronRun(runKey)
    const safetyState: EventEngagementCronSafetyState = {
      runKey,
      safetyAborts,
      primaryAbort: null,
      recordSafetyAbort: (abort) => {
        const entry: EventEngagementCronSafetyAbort = { runKey, ...abort }
        safetyAborts.push(entry)
        if (!safetyState.primaryAbort) {
          safetyState.primaryAbort = entry
        }
      },
      throwSafetyAbort: () => {
        if (safetyState.primaryAbort) {
          throw new EventEngagementCronSafetyAbortError(safetyState.primaryAbort)
        }
        throw new Error('Missing event engagement safety abort metadata')
      },
    }
    runContext = {
      supabase: acquireResult.supabase,
      runId: acquireResult.runId,
      runKey,
      shouldResolve: acquireResult.shouldResolve
    }

    if (acquireResult.skip) {
      resolvedStatus = 'completed'
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: acquireResult.skipReason,
        runKey,
        processedAt: new Date().toISOString()
      })
    }

    guard = await evaluateEventEngagementSendGuard(acquireResult.supabase)
    if (guard.blocked) {
      logger.error('Event guest engagement send guard tripped; run aborted', {
        metadata: {
          runKey,
          recentCount: guard.recentCount,
          limit: guard.limit,
          windowMinutes: guard.windowMinutes
        }
      })

      resolvedStatus = 'completed'
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'send_guard_blocked',
        runKey,
        guard,
        processedAt: new Date().toISOString()
      })
    }

    const supabase = acquireResult.supabase
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

    const [bookings, tableBookings] = await Promise.all([
      loadEventBookingsForEngagement(supabase),
      loadTableBookingsForEngagement(supabase)
    ])

    const reminders = await processReminders(supabase, bookings, appBaseUrl, safetyState)
    const reviews = await processReviewFollowups(supabase, bookings, appBaseUrl, safetyState)
    const completion = await processReviewWindowCompletion(supabase)
    const marketing = await processInterestMarketing(supabase, safetyState)
    const tableReviews = await processTableReviewFollowups(supabase, tableBookings, appBaseUrl, safetyState)
    const tableCompletion = await processTableReviewWindowCompletion(supabase)

    resolvedStatus = 'completed'
    return NextResponse.json({
      success: true,
      reminders,
      reviews,
      completion,
      tableReviews,
      tableCompletion,
      marketing,
      runKey,
      guard,
      processedAt: new Date().toISOString()
    })
  } catch (error) {
    if (error instanceof EventEngagementCronSafetyAbortError) {
      resolvedStatus = 'failed'
      runErrorMessage = error.abort.code

      logger.error('Aborting event guest engagement cron due to fatal SMS safety signal', {
        error: new Error(error.abort.code),
        metadata: error.abort,
      })

      return NextResponse.json({
        success: true,
        aborted: true,
        abortReason: error.abort.code,
        abortStage: error.abort.stage,
        abortBookingId: error.abort.bookingId,
        abortTableBookingId: error.abort.tableBookingId,
        abortCustomerId: error.abort.customerId,
        abortEventId: error.abort.eventId,
        abortTemplateKey: error.abort.templateKey,
        safetyAborts,
        runKey: error.abort.runKey,
        guard,
        processedAt: new Date().toISOString(),
      })
    }

    resolvedStatus = 'failed'
    runErrorMessage = error instanceof Error ? error.message : String(error)

    logger.error('Failed to process event guest engagement cron', {
      error: error instanceof Error ? error : new Error(String(error))
    })

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process event guest engagement'
      },
      { status: 500 }
    )
  } finally {
    if (runContext?.shouldResolve && resolvedStatus) {
      await resolveCronRunResult(
        runContext.supabase,
        runContext.runId,
        resolvedStatus,
        resolvedStatus === 'failed' ? runErrorMessage : undefined
      )
    }
  }
}
