import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import {
  buildPaymentReminderSmsForStage,
  buildSessionThreeDayReminderSms,
} from '@/lib/parking/notifications'
import { logParkingNotification } from '@/lib/parking/repository'
import { updateParkingBookingById } from '@/lib/parking/booking-updates'
import type { ParkingBooking } from '@/types/parking'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { persistCronRunResult, recoverCronRunLock } from '@/lib/cron-run-results'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DAY_MS = 24 * 60 * 60 * 1000
const JOB_NAME = 'parking-notifications'
const STALE_RUN_WINDOW_MINUTES = 30
const RUN_KEY_INTERVAL_MINUTES = 15
const TEMPLATE_PARKING_PAYMENT_REMINDER_WEEK = 'parking_payment_reminder_week_before_expiry'
const TEMPLATE_PARKING_PAYMENT_REMINDER_DAY = 'parking_payment_reminder_day_before_expiry'
const TEMPLATE_PARKING_SESSION_START_3D = 'parking_session_start_3d'
const TEMPLATE_PARKING_SESSION_END_3D = 'parking_session_end_3d'
const PARKING_TEMPLATE_KEYS = [
  TEMPLATE_PARKING_PAYMENT_REMINDER_WEEK,
  TEMPLATE_PARKING_PAYMENT_REMINDER_DAY,
  TEMPLATE_PARKING_SESSION_START_3D,
  TEMPLATE_PARKING_SESSION_END_3D
]
const PARKING_SEND_GUARD_WINDOW_MINUTES = parsePositiveIntEnv('PARKING_SEND_GUARD_WINDOW_MINUTES', 60)
const PARKING_SEND_GUARD_LIMIT = parsePositiveIntEnv('PARKING_SEND_GUARD_LIMIT', 80)

type ParkingCronSafetyAbort = {
  runKey: string
  stage: string
  bookingId: string | null
  eventType: 'payment_reminder' | 'session_start' | 'session_end' | null
  templateKey: string | null
  code: string
  logFailure: boolean
}

class ParkingCronSafetyAbortError extends Error {
  abort: ParkingCronSafetyAbort

  constructor(abort: ParkingCronSafetyAbort) {
    super(abort.code)
    this.name = 'ParkingCronSafetyAbortError'
    this.abort = abort
  }
}

type ParkingCronSafetyState = {
  runKey: string
  safetyAborts: ParkingCronSafetyAbort[]
  recordSafetyAbort: (abort: Omit<ParkingCronSafetyAbort, 'runKey'>) => never
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

function allowParkingSendGuardSchemaGaps(): boolean {
  return parseBooleanEnv('PARKING_SEND_GUARD_ALLOW_SCHEMA_GAPS', process.env.NODE_ENV !== 'production')
}

function allowParkingDedupeSchemaGaps(): boolean {
  return parseBooleanEnv('PARKING_DEDUPE_ALLOW_SCHEMA_GAPS', process.env.NODE_ENV !== 'production')
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
    console.warn('Parking notifications restart update affected no rows; recovering lock', {
      runKey,
      jobId: existing.id
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

async function evaluateParkingSendGuard(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ blocked: boolean; recentCount: number; windowMinutes: number; limit: number }> {
  const windowMinutes = PARKING_SEND_GUARD_WINDOW_MINUTES
  const limit = PARKING_SEND_GUARD_LIMIT
  const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString()

  const { count, error } = await (supabase.from('messages') as any)
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .in('template_key', PARKING_TEMPLATE_KEYS)
    .gte('created_at', sinceIso)

  if (error) {
    const pgError = error as { code?: string; message?: string }
    if (pgError?.code === '42703' || pgError?.code === '42P01') {
      if (allowParkingSendGuardSchemaGaps()) {
        console.warn('Parking send guard skipped because schema is missing expected columns', pgError.message)
        return { blocked: false, recentCount: 0, windowMinutes, limit }
      }

      console.error('Parking send guard blocked run because schema is unavailable', pgError.message)
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

async function hasParkingReminderBeenSent(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    bookingId: string
    eventType: 'payment_reminder' | 'session_start' | 'session_end'
    templateKey: string
    payload?: Record<string, unknown>
  }
): Promise<boolean> {
  let query = (supabase.from('parking_booking_notifications') as any)
    .select('id')
    .eq('booking_id', input.bookingId)
    .eq('channel', 'sms')
    .eq('event_type', input.eventType)
    .eq('status', 'sent')
    .limit(1)

  const stage = typeof input.payload?.stage === 'string' ? input.payload.stage : null
  if (stage) {
    query = query.contains('payload', { stage })
  } else if (input.templateKey) {
    query = query.contains('payload', { template_key: input.templateKey })
  }

  const { data, error } = await query
  if (error) {
    const pgError = error as { code?: string; message?: string }
    if (pgError?.code === '42703' || pgError?.code === '42P01') {
      if (allowParkingDedupeSchemaGaps()) {
        console.warn('Parking reminder dedupe skipped because schema is missing expected columns', pgError.message)
        return false
      }

      console.error('Parking reminder dedupe blocked send because schema is unavailable', input.bookingId, pgError.message)
      return true
    }
    console.error('Failed to evaluate parking reminder dedupe state', input.bookingId, error)
    return true
  }

  return Array.isArray(data) && data.length > 0
}

export async function GET(request: Request) {
  let runContext: {
    supabase: ReturnType<typeof createAdminClient>
    runId: string
    runKey: string
    shouldResolve: boolean
  } | null = null
  let resolvedStatus: 'completed' | 'failed' | null = null
  let runErrorMessage: string | undefined
  let guard: Awaited<ReturnType<typeof evaluateParkingSendGuard>> | null = null
  const safetyAborts: ParkingCronSafetyAbort[] = []

  const authResult = authorizeCronRequest(request)

  if (!authResult.authorized) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const runKey = getUtcRunKey()
    const acquireResult = await acquireCronRun(runKey)
    const safetyState: ParkingCronSafetyState = {
      runKey,
      safetyAborts,
      recordSafetyAbort: (abort) => {
        const entry: ParkingCronSafetyAbort = { runKey, ...abort }
        safetyAborts.push(entry)
        throw new ParkingCronSafetyAbortError(entry)
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
      })
    }

    guard = await evaluateParkingSendGuard(acquireResult.supabase)
    if (guard.blocked) {
      resolvedStatus = 'completed'
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'send_guard_blocked',
        runKey,
        guard
      })
    }

    const supabase = await acquireResult.supabase
    const now = new Date()

    const pendingPaymentLifecycle = await processPendingPaymentLifecycle(supabase, now, safetyState)
    const paidSessionReminders = await processPaidSessionReminders(supabase, now, safetyState)

    resolvedStatus = 'completed'
    return NextResponse.json({
      success: true,
      pendingPaymentLifecycle,
      paidSessionReminders,
      runKey,
      guard
    })
  } catch (error) {
    if (error instanceof ParkingCronSafetyAbortError) {
      resolvedStatus = 'failed'
      runErrorMessage = error.abort.code
      console.error('Aborting parking notifications cron due to fatal SMS safety signal', {
        metadata: error.abort,
      })

      return NextResponse.json({
        success: true,
        aborted: true,
        abortReason: error.abort.code,
        abortStage: error.abort.stage,
        abortBookingId: error.abort.bookingId,
        abortEventType: error.abort.eventType,
        abortTemplateKey: error.abort.templateKey,
        safetyAborts,
        runKey: error.abort.runKey,
        guard,
      })
    }

    resolvedStatus = 'failed'
    runErrorMessage = error instanceof Error ? error.message : String(error)
    console.error('Parking notifications cron failed:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
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

async function processPendingPaymentLifecycle(
  supabase: ReturnType<typeof createAdminClient>,
  now: Date,
  safety: ParkingCronSafetyState
) {
  const { data: bookings, error } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('status', 'pending_payment')
    .eq('payment_status', 'pending')
    .not('payment_due_at', 'is', null)

  if (error) {
    console.error('Failed to fetch pending parking payment lifecycle bookings', error)
    return { sent: 0, expired: 0, errors: 1, skipped: 0 }
  }

  if (!bookings || bookings.length === 0) {
    return { sent: 0, expired: 0, errors: 0, skipped: 0 }
  }

  let sent = 0
  let expired = 0
  let errors = 0
  let skipped = 0

  for (const booking of bookings as ParkingBooking[]) {
    const dueAt = new Date(booking.payment_due_at || booking.expires_at || '')
    if (Number.isNaN(dueAt.getTime())) {
      skipped += 1
      continue
    }

    const msUntilDue = dueAt.getTime() - now.getTime()
    if (msUntilDue <= 0) {
      const expireResult = await updateParkingBookingById(
        supabase,
        booking.id,
        {
          status: 'expired',
          payment_status: 'expired',
          updated_at: now.toISOString(),
        },
        'Failed to expire unpaid parking booking'
      )

      if (expireResult !== 'updated') {
        errors += 1
      } else {
        expired += 1
      }

      continue
    }

    const shouldSendDayBefore =
      !booking.unpaid_day_before_sms_sent &&
      msUntilDue <= DAY_MS

    const shouldSendWeekBefore =
      !booking.unpaid_week_before_sms_sent &&
      msUntilDue <= 7 * DAY_MS &&
      msUntilDue > DAY_MS

    if (!shouldSendDayBefore && !shouldSendWeekBefore) {
      skipped += 1
      continue
    }

    const paymentLink = await lookupPendingPaymentLink(supabase, booking.id)

    if (shouldSendDayBefore) {
      const reminderPayload = { stage: 'day_before_expiry' }
      const alreadySent = await hasParkingReminderBeenSent(supabase, {
        bookingId: booking.id,
        eventType: 'payment_reminder',
        templateKey: TEMPLATE_PARKING_PAYMENT_REMINDER_DAY,
        payload: reminderPayload
      })

      if (alreadySent) {
        const backfillResult = await updateParkingBookingById(
          supabase,
          booking.id,
          { unpaid_day_before_sms_sent: true },
          'Failed to backfill day-before reminder flag from notification history'
        )

        if (backfillResult !== 'updated') {
          errors += 1
        }
        skipped += 1
        continue
      }

      const smsResult = await sendParkingReminderSms({
        supabase,
        booking,
        eventType: 'payment_reminder',
        templateKey: TEMPLATE_PARKING_PAYMENT_REMINDER_DAY,
        smsBody: buildPaymentReminderSmsForStage(booking, 'day_before_expiry', paymentLink || undefined),
        payload: reminderPayload,
        safety,
      })

      if (smsResult.sent) {
        sent += 1
        const updateResult = await updateParkingBookingById(
          supabase,
          booking.id,
          { unpaid_day_before_sms_sent: true },
          'Failed to mark day-before reminder sent'
        )

        if (updateResult !== 'updated') {
          errors += 1
        }
      } else if (smsResult.skipped) {
        skipped += 1
      } else {
        errors += 1
      }

      continue
    }

    const reminderPayload = { stage: 'week_before_expiry' }
    const alreadySent = await hasParkingReminderBeenSent(supabase, {
      bookingId: booking.id,
      eventType: 'payment_reminder',
      templateKey: TEMPLATE_PARKING_PAYMENT_REMINDER_WEEK,
      payload: reminderPayload
    })

    if (alreadySent) {
      const backfillResult = await updateParkingBookingById(
        supabase,
        booking.id,
        { unpaid_week_before_sms_sent: true },
        'Failed to backfill week-before reminder flag from notification history'
      )

      if (backfillResult !== 'updated') {
        errors += 1
      }
      skipped += 1
      continue
    }

    const smsResult = await sendParkingReminderSms({
      supabase,
      booking,
      eventType: 'payment_reminder',
      templateKey: TEMPLATE_PARKING_PAYMENT_REMINDER_WEEK,
      smsBody: buildPaymentReminderSmsForStage(booking, 'week_before_expiry', paymentLink || undefined),
      payload: reminderPayload,
      safety,
    })

    if (smsResult.sent) {
      sent += 1
      const updateResult = await updateParkingBookingById(
        supabase,
        booking.id,
        { unpaid_week_before_sms_sent: true },
        'Failed to mark week-before reminder sent'
      )

      if (updateResult !== 'updated') {
        errors += 1
      }
    } else if (smsResult.skipped) {
      skipped += 1
    } else {
      errors += 1
    }
  }

  return { sent, expired, errors, skipped }
}

async function processPaidSessionReminders(
  supabase: ReturnType<typeof createAdminClient>,
  now: Date,
  safety: ParkingCronSafetyState
) {
  const { data: bookings, error } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('status', 'confirmed')
    .eq('payment_status', 'paid')

  if (error) {
    console.error('Failed to fetch paid parking bookings for reminders', error)
    return { startSent: 0, endSent: 0, errors: 1, skipped: 0 }
  }

  if (!bookings || bookings.length === 0) {
    return { startSent: 0, endSent: 0, errors: 0, skipped: 0 }
  }

  let startSent = 0
  let endSent = 0
  let errors = 0
  let skipped = 0

  for (const booking of bookings as ParkingBooking[]) {
    const startAt = new Date(booking.start_at)
    const endAt = new Date(booking.end_at)

    const msUntilStart = startAt.getTime() - now.getTime()
    const msUntilEnd = endAt.getTime() - now.getTime()

    const shouldSendStart =
      !booking.paid_start_three_day_sms_sent &&
      msUntilStart > 0 &&
      msUntilStart <= 3 * DAY_MS

    const shouldSendEnd =
      !booking.paid_end_three_day_sms_sent &&
      msUntilEnd > 0 &&
      msUntilEnd <= 3 * DAY_MS

    if (!shouldSendStart && !shouldSendEnd) {
      skipped += 1
      continue
    }

    if (shouldSendStart) {
      const reminderPayload = { stage: 'three_days_before_start' }
      const alreadySent = await hasParkingReminderBeenSent(supabase, {
        bookingId: booking.id,
        eventType: 'session_start',
        templateKey: TEMPLATE_PARKING_SESSION_START_3D,
        payload: reminderPayload
      })

      if (alreadySent) {
        const backfillResult = await updateParkingBookingById(
          supabase,
          booking.id,
          { paid_start_three_day_sms_sent: true },
          'Failed to backfill paid start reminder flag from notification history'
        )

        if (backfillResult !== 'updated') {
          errors += 1
        }
        skipped += 1
      } else {
      const smsResult = await sendParkingReminderSms({
        supabase,
        booking,
        eventType: 'session_start',
        templateKey: TEMPLATE_PARKING_SESSION_START_3D,
        smsBody: buildSessionThreeDayReminderSms(booking, 'start'),
        payload: reminderPayload,
        safety,
      })

      if (smsResult.sent) {
        startSent += 1
        const updateResult = await updateParkingBookingById(
          supabase,
          booking.id,
          { paid_start_three_day_sms_sent: true },
          'Failed to mark paid start reminder sent'
        )

        if (updateResult !== 'updated') {
          errors += 1
        }
      } else if (smsResult.skipped) {
        skipped += 1
      } else {
        errors += 1
      }
      }
    }

    if (shouldSendEnd) {
      const reminderPayload = { stage: 'three_days_before_end' }
      const alreadySent = await hasParkingReminderBeenSent(supabase, {
        bookingId: booking.id,
        eventType: 'session_end',
        templateKey: TEMPLATE_PARKING_SESSION_END_3D,
        payload: reminderPayload
      })

      if (alreadySent) {
        const backfillResult = await updateParkingBookingById(
          supabase,
          booking.id,
          { paid_end_three_day_sms_sent: true },
          'Failed to backfill paid end reminder flag from notification history'
        )

        if (backfillResult !== 'updated') {
          errors += 1
        }
        skipped += 1
        continue
      }

      const smsResult = await sendParkingReminderSms({
        supabase,
        booking,
        eventType: 'session_end',
        templateKey: TEMPLATE_PARKING_SESSION_END_3D,
        smsBody: buildSessionThreeDayReminderSms(booking, 'end'),
        payload: reminderPayload,
        safety,
      })

      if (smsResult.sent) {
        endSent += 1
        const updateResult = await updateParkingBookingById(
          supabase,
          booking.id,
          { paid_end_three_day_sms_sent: true },
          'Failed to mark paid end reminder sent'
        )

        if (updateResult !== 'updated') {
          errors += 1
        }
      } else if (smsResult.skipped) {
        skipped += 1
      } else {
        errors += 1
      }
    }
  }

  return { startSent, endSent, errors, skipped }
}

async function sendParkingReminderSms(params: {
  supabase: ReturnType<typeof createAdminClient>
  booking: ParkingBooking
  eventType: 'payment_reminder' | 'session_start' | 'session_end'
  templateKey: string
  smsBody: string
  payload?: Record<string, unknown>
  safety: ParkingCronSafetyState
}): Promise<{ sent: boolean; skipped: boolean }> {
  const { supabase, booking, eventType, templateKey, smsBody, payload, safety } = params

  if (!booking.customer_mobile) {
    try {
      await logParkingNotification(
        {
          booking_id: booking.id,
          channel: 'sms',
          event_type: eventType,
          status: 'skipped',
          payload: {
            template_key: templateKey,
            reason: 'No customer mobile number on booking',
            ...(payload || {}),
          },
        },
        supabase
      )
    } catch (error) {
      console.error('Failed to log skipped parking notification', booking.id, error)
    }
    return { sent: false, skipped: true }
  }

  const smsWithReply = ensureReplyInstruction(
    smsBody,
    process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  )

  let smsResult: Awaited<ReturnType<typeof sendSMS>>
  try {
    smsResult = await sendSMS(booking.customer_mobile, smsWithReply, {
      customerId: booking.customer_id ?? undefined,
      metadata: {
        parking_booking_id: booking.id,
        event_type: eventType,
        template_key: templateKey,
        ...(payload || {}),
      },
      customerFallback: {
        email: booking.customer_email ?? undefined,
      },
    })
  } catch (smsError) {
    console.error('Parking reminder SMS send threw unexpectedly', booking.id, smsError)
    try {
      await logParkingNotification(
        {
          booking_id: booking.id,
          channel: 'sms',
          event_type: eventType,
          status: 'failed',
          payload: {
            template_key: templateKey,
            sms: smsWithReply,
            reason: smsError instanceof Error ? smsError.message : String(smsError),
            ...(payload || {}),
          },
        },
        supabase
      )
    } catch (logError) {
      console.error('Failed to log parking reminder SMS exception', booking.id, logError)
    }
    return { sent: false, skipped: false }
  }

  const smsCode = typeof (smsResult as any)?.code === 'string' ? ((smsResult as any).code as string) : null
  const smsLogFailure = (smsResult as any)?.logFailure === true

  try {
    await logParkingNotification(
      {
        booking_id: booking.id,
        channel: 'sms',
        event_type: eventType,
        status: smsResult.success ? 'sent' : 'failed',
        sent_at: smsResult.success ? new Date().toISOString() : null,
        message_sid: smsResult.success && smsResult.sid ? smsResult.sid : null,
        payload: {
          template_key: templateKey,
          sms: smsWithReply,
          sms_code: smsCode,
          sms_log_failure: smsLogFailure,
          ...(payload || {}),
        },
      },
      supabase
    )
  } catch (error) {
    console.error('Failed to log parking reminder notification result', booking.id, error)
    if (smsResult.success) {
      safety.recordSafetyAbort({
        stage: 'parking_notification_log',
        bookingId: booking.id,
        eventType,
        templateKey,
        code: 'logging_failed',
        logFailure: true,
      })
    }
  }

  if (
    smsLogFailure ||
    smsCode === 'logging_failed' ||
    smsCode === 'safety_unavailable' ||
    smsCode === 'idempotency_conflict'
  ) {
    safety.recordSafetyAbort({
      stage: 'send_sms',
      bookingId: booking.id,
      eventType,
      templateKey,
      code: smsCode ?? 'logging_failed',
      logFailure: smsLogFailure,
    })
  }

  return {
    sent: smsResult.success,
    skipped: false,
  }
}

async function lookupPendingPaymentLink(supabase: ReturnType<typeof createAdminClient>, bookingId: string) {
  const { data, error } = await supabase
    .from('parking_booking_payments')
    .select('metadata')
    .eq('booking_id', bookingId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Failed to lookup parking payment metadata', bookingId, error)
    return null
  }

  const metadata = data?.metadata as { approve_url?: string } | null
  return metadata?.approve_url ?? null
}
