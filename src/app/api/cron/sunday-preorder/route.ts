import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { createSundayPreorderToken } from '@/lib/table-bookings/sunday-preorder'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { persistCronRunResult, recoverCronRunLock } from '@/lib/cron-run-results'
import { getSmartFirstName } from '@/lib/sms/bulk'

const TEMPLATE_REMINDER_48H = 'sunday_preorder_reminder_48h'
const TEMPLATE_REMINDER_26H = 'sunday_preorder_reminder_26h'
const TEMPLATE_CANCELLED_24H = 'sunday_preorder_cancelled_24h'
const JOB_NAME = 'sunday-preorder'
const STALE_RUN_WINDOW_MINUTES = 30
const RUN_KEY_INTERVAL_MINUTES = 15
const MAX_SUNDAY_PREORDER_SMS_PER_RUN = parsePositiveIntEnv('MAX_SUNDAY_PREORDER_SMS_PER_RUN', 80)
const SUNDAY_PREORDER_SEND_GUARD_WINDOW_MINUTES = parsePositiveIntEnv(
  'SUNDAY_PREORDER_SEND_GUARD_WINDOW_MINUTES',
  60
)
const SUNDAY_PREORDER_SEND_GUARD_LIMIT = parsePositiveIntEnv(
  'SUNDAY_PREORDER_SEND_GUARD_LIMIT',
  80
)
const SUNDAY_PREORDER_TEMPLATE_KEYS = [
  TEMPLATE_REMINDER_48H,
  TEMPLATE_REMINDER_26H,
  TEMPLATE_CANCELLED_24H
]

type SundayBookingRow = {
  id: string
  customer_id: string
  booking_reference: string | null
  party_size: number | null
  status: string
  start_datetime: string | null
  sunday_preorder_completed_at: string | null
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

function allowSundaySendGuardSchemaGaps(): boolean {
  return parseBooleanEnv('SUNDAY_PREORDER_SEND_GUARD_ALLOW_SCHEMA_GAPS', process.env.NODE_ENV !== 'production')
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function getUtcRunKey(now: Date = new Date()): string {
  const bucketMinute = Math.floor(now.getUTCMinutes() / RUN_KEY_INTERVAL_MINUTES) * RUN_KEY_INTERVAL_MINUTES
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}T${pad2(
    now.getUTCHours()
  )}:${pad2(bucketMinute)}`
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

  const pgError = error as { code?: string } | null
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
    logger.warn('Sunday pre-order restart update affected no rows; recovering lock', {
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

async function evaluateSundaySendGuard(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ blocked: boolean; recentCount: number; windowMinutes: number; limit: number }> {
  const windowMinutes = SUNDAY_PREORDER_SEND_GUARD_WINDOW_MINUTES
  const limit = SUNDAY_PREORDER_SEND_GUARD_LIMIT
  const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString()

  const { count, error } = await (supabase.from('messages') as any)
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .in('template_key', SUNDAY_PREORDER_TEMPLATE_KEYS)
    .gte('created_at', sinceIso)

  if (error) {
    const pgError = error as { code?: string; message?: string }
    if (pgError?.code === '42703' || pgError?.code === '42P01') {
      if (allowSundaySendGuardSchemaGaps()) {
        logger.warn('Sunday pre-order send guard skipped because schema is missing expected columns', {
          metadata: { error: pgError.message }
        })
        return { blocked: false, recentCount: 0, windowMinutes, limit }
      }

      logger.error('Sunday pre-order send guard blocked run because schema is unavailable', {
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

function totalSundaySmsSent(counters: {
  reminders48Sent: number
  reminders26Sent: number
  cancellationSmsSent: number
}): number {
  return counters.reminders48Sent + counters.reminders26Sent + counters.cancellationSmsSent
}

async function sendSmsSafe(
  to: string,
  body: string,
  options: {
    customerId: string
    allowTransactionalOverride?: boolean
    metadata?: Record<string, unknown>
  },
  context: {
    bookingId: string
    customerId: string
    templateKey: string
  }
): Promise<Awaited<ReturnType<typeof sendSMS>>> {
  try {
    return await sendSMS(to, body, {
      ...options,
      allowTransactionalOverride: options.allowTransactionalOverride === true
    })
  } catch (smsError) {
    logger.warn('Failed sending Sunday pre-order SMS', {
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
    logger.warn('Failed recording Sunday pre-order analytics event', {
      metadata: {
        ...context,
        error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
      }
    })
  }
}

function chunkArray<T>(input: T[], size = 200): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size))
  }
  return chunks
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

  for (const bookingChunk of chunkArray(bookingIds, 300)) {
    const { data, error } = await supabase
      .from('messages')
      .select('table_booking_id, template_key, metadata')
      .in('table_booking_id', bookingChunk)
      .in('template_key', templateKeys)

    if (error) {
      // Fail closed: running without a complete dedupe view can cause duplicate sends.
      logger.error('Failed to load Sunday pre-order message dedupe set', {
        metadata: {
          error: error.message
        }
      })
      throw error
    }

    for (const row of data || []) {
      const bookingId = (row as any).table_booking_id || (row as any)?.metadata?.table_booking_id
      const templateKey = (row as any).template_key || (row as any)?.metadata?.template_key
      if (typeof bookingId === 'string' && typeof templateKey === 'string') {
        sent.add(`${bookingId}:${templateKey}`)
      }
    }
  }

  return sent
}

function shouldAbortSundaySmsRun(smsResult: Awaited<ReturnType<typeof sendSMS>>): boolean {
  const code = (smsResult as any)?.code
  const logFailure = (smsResult as any)?.logFailure === true
  // Fatal safety signals: loops must abort to avoid continued sends when dedupe/logging cannot be trusted.
  return (
    logFailure
    || code === 'logging_failed'
    || code === 'safety_unavailable'
    || code === 'idempotency_conflict'
  )
}

async function loadSundayBookings(
  supabase: ReturnType<typeof createAdminClient>
): Promise<SundayBookingRow[]> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select(`
      id,
      customer_id,
      booking_reference,
      party_size,
      status,
      start_datetime,
      sunday_preorder_completed_at,
      customer:customers(
        id,
        first_name,
        mobile_number,
        sms_status
      )
    `)
    .eq('booking_type', 'sunday_lunch')
    .eq('status', 'confirmed')
    .not('start_datetime', 'is', null)
    .limit(3000)

  if (error) {
    throw error
  }

  return ((data || []) as any[]).map((row) => ({
    ...row,
    customer: Array.isArray(row.customer) ? (row.customer[0] || null) : (row.customer || null)
  })) as SundayBookingRow[]
}

function shouldSend48HourReminder(nowMs: number, startMs: number): boolean {
  return nowMs >= startMs - 48 * 60 * 60 * 1000 && nowMs < startMs - 26 * 60 * 60 * 1000
}

function shouldSend26HourReminder(nowMs: number, startMs: number): boolean {
  return nowMs >= startMs - 26 * 60 * 60 * 1000 && nowMs < startMs - 24 * 60 * 60 * 1000
}

function shouldCancelForMissingPreorder(nowMs: number, startMs: number): boolean {
  return nowMs >= startMs - 24 * 60 * 60 * 1000
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

  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  try {
    const runKey = getUtcRunKey()
    const acquireResult = await acquireCronRun(runKey)
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

    const guard = await evaluateSundaySendGuard(acquireResult.supabase)
    if (guard.blocked) {
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
    const now = new Date()
    const nowMs = now.getTime()
    const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const counters = {
      reminders48Sent: 0,
      reminders26Sent: 0,
      cancelledAt24h: 0,
      cancellationSmsSent: 0,
      skipped: 0
    }
    const abortState = {
      safetyAborts: 0,
      aborted: false,
      abortReason: null as string | null,
      abortBookingId: null as string | null,
      abortTemplateKey: null as string | null
    }

    const bookings = await loadSundayBookings(supabase)
    let sentTemplateSet: Set<string>
    try {
      sentTemplateSet = await loadSentTemplateSet(
        supabase,
        bookings.map((booking) => booking.id),
        [TEMPLATE_REMINDER_48H, TEMPLATE_REMINDER_26H, TEMPLATE_CANCELLED_24H]
      )
    } catch (dedupeError) {
      abortState.safetyAborts += 1
      abortState.aborted = true
      abortState.abortReason = 'dedupe_unavailable'

      logger.error('Aborting Sunday pre-order cron due to dedupe load failure', {
        error: dedupeError instanceof Error ? dedupeError : new Error(String(dedupeError)),
        metadata: { runKey }
      })

      resolvedStatus = 'failed'
      runErrorMessage = abortState.abortReason
      return NextResponse.json({
        success: true,
        counters,
        runKey,
        guard,
        ...abortState,
        processedAt: new Date().toISOString()
      })
    }

    for (const booking of bookings) {
      const customer = booking.customer
      const startIso = booking.start_datetime

      if (!customer || !startIso) {
        counters.skipped += 1
        continue
      }
      const mobileNumber = customer.mobile_number || null

      if (booking.sunday_preorder_completed_at) {
        counters.skipped += 1
        continue
      }

      const startMs = Date.parse(startIso)
      if (!Number.isFinite(startMs)) {
        counters.skipped += 1
        continue
      }

      if (shouldCancelForMissingPreorder(nowMs, startMs)) {
        const nowIso = new Date().toISOString()

        const { data: cancelledRows, error: cancelError } = await (supabase.from('table_bookings') as any)
          .update({
            status: 'cancelled',
            cancelled_at: nowIso,
            cancelled_by: 'system',
            updated_at: nowIso
          })
          .eq('id', booking.id)
          .eq('status', 'confirmed')
          .is('sunday_preorder_completed_at', null)
          .select('id')

        if (cancelError || !cancelledRows || cancelledRows.length === 0) {
          counters.skipped += 1
          continue
        }

        counters.cancelledAt24h += 1

        await recordAnalyticsEventSafe(supabase, {
          customerId: customer.id,
          tableBookingId: booking.id,
          eventType: 'table_booking_cancelled',
          metadata: {
            cancellation_reason: 'sunday_preorder_incomplete_24h',
            cancelled_by: 'system'
          }
        }, {
          bookingId: booking.id,
          customerId: customer.id,
          eventType: 'table_booking_cancelled'
        })

        const cancellationKey = `${booking.id}:${TEMPLATE_CANCELLED_24H}`
        if (mobileNumber && !sentTemplateSet.has(cancellationKey)) {
          if (totalSundaySmsSent(counters) < MAX_SUNDAY_PREORDER_SMS_PER_RUN) {
            const message = ensureReplyInstruction(
              `The Anchor: Hi ${getSmartFirstName(customer.first_name)}, your Sunday lunch booking ${booking.booking_reference || ''} has been cancelled because the required pre-order wasn't completed 24 hours before the booking. No charge has been applied.`,
              supportPhone
            )

            const smsResult = await sendSmsSafe(mobileNumber, message, {
              customerId: customer.id,
              allowTransactionalOverride: true,
              metadata: {
                table_booking_id: booking.id,
                template_key: TEMPLATE_CANCELLED_24H
              }
            }, {
              bookingId: booking.id,
              customerId: customer.id,
              templateKey: TEMPLATE_CANCELLED_24H
            })

            if (smsResult.success) {
              sentTemplateSet.add(cancellationKey)
              counters.cancellationSmsSent += 1
            }

            if (shouldAbortSundaySmsRun(smsResult)) {
              abortState.safetyAborts += 1
              abortState.aborted = true
              abortState.abortReason = (smsResult as any)?.code || 'sms_safety_abort'
              abortState.abortBookingId = booking.id
              abortState.abortTemplateKey = TEMPLATE_CANCELLED_24H

              logger.error('Aborting Sunday pre-order cron due to fatal SMS safety signal', {
                error: new Error(abortState.abortReason || 'sms_safety_abort'),
                metadata: {
                  runKey,
                  bookingId: booking.id,
                  templateKey: TEMPLATE_CANCELLED_24H,
                  code: (smsResult as any)?.code || null,
                  logFailure: (smsResult as any)?.logFailure === true
                }
              })

              break
            }
          }
        }

        continue
      }

      if (!mobileNumber) {
        counters.skipped += 1
        continue
      }

      let templateKey: string | null = null
      if (shouldSend26HourReminder(nowMs, startMs)) {
        templateKey = TEMPLATE_REMINDER_26H
      } else if (shouldSend48HourReminder(nowMs, startMs)) {
        templateKey = TEMPLATE_REMINDER_48H
      }

      if (!templateKey) {
        counters.skipped += 1
        continue
      }

      const dedupeKey = `${booking.id}:${templateKey}`
      if (sentTemplateSet.has(dedupeKey)) {
        counters.skipped += 1
        continue
      }

      if (totalSundaySmsSent(counters) >= MAX_SUNDAY_PREORDER_SMS_PER_RUN) {
        counters.skipped += 1
        continue
      }

      let preorderUrl: string | null = null
      try {
        const token = await createSundayPreorderToken(supabase, {
          customerId: customer.id,
          tableBookingId: booking.id,
          bookingStartIso: startIso,
          appBaseUrl
        })
        preorderUrl = token.url
      } catch {
        preorderUrl = null
      }

      const intro = templateKey === TEMPLATE_REMINDER_26H
        ? 'Final reminder: please complete your Sunday lunch pre-order.'
        : 'please complete your Sunday lunch pre-order.'

      const smsResult = await sendSmsSafe(
        mobileNumber,
        ensureReplyInstruction(
          preorderUrl
            ? `The Anchor: Hi ${getSmartFirstName(customer.first_name)}, ${intro} Complete here: ${preorderUrl}`
            : `The Anchor: Hi ${getSmartFirstName(customer.first_name)}, please use the Sunday pre-order link from your original booking text. If you can't find it, reply to this message and we'll resend it.`,
          supportPhone
        ),
        {
          customerId: customer.id,
          allowTransactionalOverride: true,
          metadata: {
            table_booking_id: booking.id,
            template_key: templateKey
          }
        },
        {
          bookingId: booking.id,
          customerId: customer.id,
          templateKey: templateKey
        }
      )

      if (shouldAbortSundaySmsRun(smsResult)) {
        abortState.safetyAborts += 1
        abortState.aborted = true
        abortState.abortReason = (smsResult as any)?.code || 'sms_safety_abort'
        abortState.abortBookingId = booking.id
        abortState.abortTemplateKey = templateKey

        logger.error('Aborting Sunday pre-order cron due to fatal SMS safety signal', {
          error: new Error(abortState.abortReason || 'sms_safety_abort'),
          metadata: {
            runKey,
            bookingId: booking.id,
            templateKey,
            code: (smsResult as any)?.code || null,
            logFailure: (smsResult as any)?.logFailure === true
          }
        })
      }

      if (!smsResult.success) {
        counters.skipped += 1
        if (abortState.aborted) {
          break
        }
        continue
      }

      sentTemplateSet.add(dedupeKey)
      if (templateKey === TEMPLATE_REMINDER_26H) {
        counters.reminders26Sent += 1
      } else {
        counters.reminders48Sent += 1
      }

      if (abortState.aborted) {
        break
      }
    }

    resolvedStatus = abortState.aborted ? 'failed' : 'completed'
    if (abortState.aborted) {
      runErrorMessage = abortState.abortReason || 'sms_safety_abort'
    }
    return NextResponse.json({
      success: true,
      counters,
      runKey,
      guard,
      ...abortState,
      processedAt: new Date().toISOString()
    })
  } catch (error) {
    resolvedStatus = 'failed'
    runErrorMessage = error instanceof Error ? error.message : String(error)

    logger.error('Failed to process Sunday pre-order cron', {
      error: error instanceof Error ? error : new Error(String(error))
    })

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process Sunday pre-orders'
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
