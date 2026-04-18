import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { SmsQueueService } from '@/services/sms-queue'
import { PrivateBookingService } from '@/services/private-bookings'
import { PRIVATE_BOOKING_FEEDBACK_TEMPLATE_KEY } from '@/lib/private-bookings/feedback'
import { persistCronRunResult, recoverCronRunLock } from '@/lib/cron-run-results'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { reportCronFailure } from '@/lib/cron/alerting'
import { hasCustomerReviewed } from '@/lib/sms/review-once'
import { createGuestToken } from '@/lib/guest/tokens'
import { getGoogleReviewLink } from '@/lib/events/review-link'
import { sendSMS } from '@/lib/twilio'
import { ensureReplyInstruction } from '@/lib/sms/support'
import {
  depositReminder7DayMessage,
  depositReminder1DayMessage,
  balanceReminder14DayMessage,
  balanceReminder7DayMessage,
  balanceReminder1DayMessage,
  eventReminder1DayMessage,
} from '@/lib/private-bookings/messages'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'

const JOB_NAME = 'private-booking-monitor'
const LONDON_TZ = 'Europe/London'
const STALE_RUN_WINDOW_MINUTES = 30
const MAX_PRIVATE_BOOKING_SMS_PER_RUN = parsePositiveIntEnv('MAX_PRIVATE_BOOKING_SMS_PER_RUN', 120)
const PRIVATE_BOOKING_SEND_GUARD_WINDOW_MINUTES = parsePositiveIntEnv(
  'PRIVATE_BOOKING_SEND_GUARD_WINDOW_MINUTES',
  60
)
const PRIVATE_BOOKING_SEND_GUARD_LIMIT = parsePositiveIntEnv(
  'PRIVATE_BOOKING_SEND_GUARD_LIMIT',
  120
)
const PRIVATE_BOOKING_SEND_GUARD_ALLOW_SCHEMA_GAPS = parseBooleanEnv(
  'PRIVATE_BOOKING_SEND_GUARD_ALLOW_SCHEMA_GAPS',
  process.env.NODE_ENV !== 'production'
)
const PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED = parseBooleanEnv(
  'PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED',
  process.env.NODE_ENV !== 'production'
)
const PRIVATE_BOOKING_MONITOR_TEMPLATE_KEYS = [
  'private_booking_deposit_reminder_7day',
  'private_booking_deposit_reminder_1day',
  'private_booking_balance_reminder_14day',
  'private_booking_event_reminder_1d',
  'private_booking_expired',
  'private_booking_post_event_followup',
  PRIVATE_BOOKING_FEEDBACK_TEMPLATE_KEY
]

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

function chunkArray<T>(input: T[], size = 250): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size))
  }
  return chunks
}

function getLondonRunKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

/**
 * Reserve a send via the business idempotency key before any cron-driven SMS
 * fires. Key shape is `{booking_id}:{trigger_type}:{window_key}` — if another
 * run already claimed the same key, Postgres returns unique-violation 23505
 * and we skip cleanly. Returns true when the reservation succeeded (caller
 * should proceed with the send), false when we should skip.
 */
async function reserveCronSmsSend(
  supabase: ReturnType<typeof createAdminClient>,
  params: { bookingId: string; triggerType: string; windowKey: string }
): Promise<{ reserved: boolean; reason?: 'duplicate' | 'error' }> {
  const idempotencyKey = `${params.bookingId}:${params.triggerType}:${params.windowKey}`
  const { error } = await supabase
    .from('private_booking_send_idempotency')
    .insert({
      idempotency_key: idempotencyKey,
      booking_id: params.bookingId,
      trigger_type: params.triggerType,
      window_key: params.windowKey
    })

  if (!error) {
    return { reserved: true }
  }

  const pgError = error as { code?: string; message?: string }
  if (pgError?.code === '23505') {
    return { reserved: false, reason: 'duplicate' }
  }

  logger.error('Private booking idempotency reservation failed', {
    error: new Error(pgError?.message || 'idempotency insert failed'),
    metadata: {
      bookingId: params.bookingId,
      triggerType: params.triggerType,
      windowKey: params.windowKey,
      idempotencyKey,
      code: pgError?.code || null
    }
  })
  return { reserved: false, reason: 'error' }
}

function shouldAbortPrivateBookingSmsRun(result: unknown): boolean {
  const code = (result as any)?.code
  const logFailure = (result as any)?.logFailure === true
  // Fatal safety signals: loops must abort to avoid continued sends when dedupe/logging cannot be trusted.
  return (
    logFailure
    || code === 'logging_failed'
    || code === 'safety_unavailable'
    || code === 'idempotency_conflict'
  )
}

async function evaluatePrivateBookingSendGuard(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ blocked: boolean; recentCount: number; windowMinutes: number; limit: number }> {
  const windowMinutes = PRIVATE_BOOKING_SEND_GUARD_WINDOW_MINUTES
  const limit = PRIVATE_BOOKING_SEND_GUARD_LIMIT
  const sinceIso = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString()

  const { count, error } = await (supabase.from('messages') as any)
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .in('template_key', PRIVATE_BOOKING_MONITOR_TEMPLATE_KEYS)
    .gte('created_at', sinceIso)

  if (error) {
    const pgError = error as { code?: string; message?: string }
    if (pgError?.code === '42703' || pgError?.code === '42P01') {
      if (PRIVATE_BOOKING_SEND_GUARD_ALLOW_SCHEMA_GAPS) {
        logger.warn('Private booking send guard skipped because schema is missing expected columns', {
          metadata: { error: pgError.message }
        })
        return { blocked: false, recentCount: 0, windowMinutes, limit }
      }

      logger.error('Private booking send guard blocked run because guard query schema is unavailable', {
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

async function acquireCronRun(runKey: string) {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

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

  if (data) {
    return { runId: data.id, supabase, skip: false }
  }

  const pgError = error as { code?: string; message?: string }

  if (pgError?.code !== '23505') {
    throw error
  }

  const { data: existing, error: fetchError } = await supabase
    .from('cron_job_runs')
    .select('id, status, started_at, finished_at')
    .eq('job_name', JOB_NAME)
    .eq('run_key', runKey)
    .maybeSingle()

  if (fetchError) {
    throw fetchError
  }

  if (!existing) {
    throw error
  }

  const startedAt = existing.started_at ? new Date(existing.started_at) : null
  const isStale =
    existing.status === 'running' &&
    startedAt !== null &&
    Date.now() - startedAt.getTime() > STALE_RUN_WINDOW_MINUTES * 60 * 1000

  if (existing.status === 'completed') {
    logger.info('Private booking monitor already completed for today', {
      metadata: { runKey, jobId: existing.id }
    })
    return { runId: existing.id, supabase, skip: true }
  }

  if (existing.status === 'running' && !isStale) {
    logger.info('Private booking monitor already running, skipping duplicate trigger', {
      metadata: { runKey, jobId: existing.id }
    })
    return { runId: existing.id, supabase, skip: true }
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
    logger.warn('Private booking monitor restart update affected no rows; recovering lock', {
      metadata: { runKey, jobId: existing.id }
    })

    const recovered = await recoverCronRunLock(supabase, {
      jobName: JOB_NAME,
      runKey,
      nowIso,
      context: JOB_NAME,
      isRunStale: (startedAt) => {
        const startedAtMs = Date.parse(startedAt || '')
        if (!Number.isFinite(startedAtMs)) {
          return true
        }
        return Date.now() - startedAtMs > STALE_RUN_WINDOW_MINUTES * 60 * 1000
      }
    })

    if (
      recovered.result === 'already_completed' ||
      recovered.result === 'already_running' ||
      recovered.result === 'missing'
    ) {
      return { runId: recovered.runId ?? existing.id, supabase, skip: true }
    }

    return { runId: recovered.runId ?? existing.id, supabase, skip: false }
  }

  return { runId: restarted?.id ?? existing.id, supabase, skip: false }
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

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  let runContext: { supabase: ReturnType<typeof createAdminClient>; runId: string; runKey: string } | null = null

  try {
    const authResult = authorizeCronRequest(request)

    if (!authResult.authorized) {
      console.error('Unauthorized request', authResult.reason)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const runKey = getLondonRunKey()
    const { supabase, runId, skip } = await acquireCronRun(runKey)
    runContext = { supabase, runId, runKey }

    if (skip) {
      return new NextResponse(
        JSON.stringify({ success: true, skipped: true }),
        { status: 200 }
      )
    }

    const guard = await evaluatePrivateBookingSendGuard(supabase)
    if (guard.blocked) {
      logger.error('Private booking monitor send guard tripped; run aborted', {
        metadata: {
          runKey,
          recentCount: guard.recentCount,
          limit: guard.limit,
          windowMinutes: guard.windowMinutes
        }
      })

      await resolveCronRunResult(supabase, runId, 'completed')
      return new NextResponse(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'send_guard_blocked',
          runKey,
          guard
        }),
        { status: 200 }
      )
    }

    console.warn('Starting private booking monitor...')

    const now = new Date()
    const stats = {
      remindersSent: 0,
      expirationsProcessed: 0,
      expirationSmsSent: 0,
      balanceRemindersSent: 0,
      eventRemindersSent: 0,
      privateFeedbackSmsSent: 0,
      postEventFollowupSent: 0,
      smsCapReached: false
    }
    const totalSmsSent = () =>
      stats.remindersSent +
      stats.expirationSmsSent +
      stats.balanceRemindersSent +
      stats.eventRemindersSent +
      stats.privateFeedbackSmsSent +
      stats.postEventFollowupSent
    const canSendMoreSms = () => totalSmsSent() < MAX_PRIVATE_BOOKING_SMS_PER_RUN
    const abortState = {
      safetyAborts: 0,
      aborted: false,
      abortReason: null as string | null,
      abortStage: null as string | null,
      abortBookingId: null as string | null,
      abortTriggerType: null as string | null,
      abortTemplateKey: null as string | null
    }

    function recordSafetyAbort(context: {
      stage: string
      bookingId?: string | null
      triggerType?: string | null
      templateKey?: string | null
      result?: unknown
      reason?: string
    }) {
      if (abortState.aborted) {
        return
      }

      const code = (context.result as any)?.code
      const logFailure = (context.result as any)?.logFailure === true
      const abortReason =
        context.reason || (typeof code === 'string' && code.length > 0 ? code : 'sms_safety_abort')

      abortState.safetyAborts += 1
      abortState.aborted = true
      abortState.abortReason = abortReason
      abortState.abortStage = context.stage
      abortState.abortBookingId = context.bookingId || null
      abortState.abortTriggerType = context.triggerType || null
      abortState.abortTemplateKey = context.templateKey || null

      logger.error('Aborting private booking monitor due to fatal SMS safety signal', {
        error: new Error(abortReason),
        metadata: {
          runKey,
          stage: context.stage,
          bookingId: context.bookingId || null,
          triggerType: context.triggerType || null,
          templateKey: context.templateKey || null,
          code: typeof code === 'string' ? code : null,
          logFailure
        }
      })
    }

    function maybeAbortFromSmsResult(
      result: unknown,
      context: { stage: string; bookingId?: string | null; triggerType?: string | null; templateKey?: string | null }
    ) {
      if (abortState.aborted) return
      if (!shouldAbortPrivateBookingSmsRun(result)) return
      recordSafetyAbort({ ...context, result })
    }

    if (!PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED) {
      logger.info('Private booking monitor upcoming-event SMS sends are disabled; skipping balance + event reminders', {
        metadata: { runKey }
      })
    }

    // --- PASS 1: REMINDERS (Drafts - Catch-up Logic) ---
    // Find draft bookings where hold_expiry is approaching (<= 7 days)
    const { data: drafts } = await supabase
      .from('private_bookings')
      .select('id, customer_first_name, customer_name, contact_phone, hold_expiry, event_date, customer_id, deposit_amount, internal_notes')
      .eq('status', 'draft')
      .gt('hold_expiry', now.toISOString()) // Not expired yet
      .not('hold_expiry', 'is', null)
    // Removed .not('contact_phone', 'is', null) to support fallback to customer record

    if (drafts) {
      // Batch-fetch mobile numbers for bookings that lack a contact_phone to avoid N+1 queries
      const missingPhoneCustomerIds = drafts
        .filter((b) => !b.contact_phone && b.customer_id)
        .map((b) => b.customer_id as string)

      const customerMobileById = new Map<string, string | null>()
      if (missingPhoneCustomerIds.length > 0) {
        const { data: customerRows } = await supabase
          .from('customers')
          .select('id, mobile_number')
          .in('id', missingPhoneCustomerIds)
        for (const row of customerRows ?? []) {
          customerMobileById.set(row.id, row.mobile_number ?? null)
        }
      }

      for (const booking of drafts) {
        if (!canSendMoreSms()) {
          stats.smsCapReached = true
          break
        }
        if (!booking.hold_expiry) continue

        // Suppress reminders for bookings whose date is still TBD — the
        // messages would point at a placeholder date.
        if (isBookingDateTbd(booking)) continue

        // Resolve phone number (fallback to pre-fetched customer mobile map)
        const contactPhone = booking.contact_phone || (booking.customer_id ? customerMobileById.get(booking.customer_id) ?? null : null)

        if (!contactPhone) continue

        const expiry = new Date(booking.hold_expiry)
        const diffMs = expiry.getTime() - now.getTime()
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

        const eventDateReadable = new Date(booking.event_date).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })

        // Window key for idempotency: anchor on hold_expiry ISO date. Same
        // booking + same expiry day + same trigger = same send cycle.
        const holdExpiryWindowKey = booking.hold_expiry
          ? new Date(booking.hold_expiry).toISOString().slice(0, 10)
          : 'unknown'

        // 1. Check 7-Day Reminder (Window: 2-7 days)
        if (diffDays <= 7 && diffDays > 1) {
          if (!canSendMoreSms()) {
            stats.smsCapReached = true
            break
          }

          const triggerType = 'deposit_reminder_7day'
          const { count, error: duplicateCheckError } = await supabase
            .from('private_booking_sms_queue')
            .select('id', { count: 'exact', head: true })
            .eq('booking_id', booking.id)
            .eq('trigger_type', triggerType)
            .in('status', ['pending', 'approved', 'sent'])

          if (duplicateCheckError) {
            logger.warn('Skipping private booking 7-day reminder due to duplicate-check query failure', {
              metadata: {
                bookingId: booking.id,
                triggerType,
                runKey,
                error: duplicateCheckError.message
              }
            })
            continue
          }

          if ((count ?? 0) === 0) {
            const reservation = await reserveCronSmsSend(supabase, {
              bookingId: booking.id,
              triggerType,
              windowKey: holdExpiryWindowKey
            })
            if (!reservation.reserved) continue

            const messageBody = depositReminder7DayMessage({
              customerFirstName: booking.customer_first_name,
              eventDate: eventDateReadable,
              depositAmount: Number(booking.deposit_amount ?? 0),
              daysRemaining: diffDays,
            })

            const result = await SmsQueueService.queueAndSend({
              booking_id: booking.id,
              trigger_type: triggerType,
              template_key: `private_booking_${triggerType}`,
              message_body: messageBody,
              customer_phone: contactPhone,
              customer_name: booking.customer_name,
              priority: 2
            })

            if (result.error) {
              console.error(`Failed to queue 7-day reminder for booking ${booking.id}:`, result.error)
            } else if (result.sent) {
              stats.remindersSent++
            }

            maybeAbortFromSmsResult(result, {
              stage: `pass1:${triggerType}`,
              bookingId: booking.id,
              triggerType,
              templateKey: `private_booking_${triggerType}`
            })

            if (abortState.aborted) {
              break
            }
          }
        }

        // 2. Check 1-Day Reminder (Window: <= 1 day)
        if (diffDays <= 1 && diffDays > 0) {
          if (!canSendMoreSms()) {
            stats.smsCapReached = true
            break
          }

          const triggerType = 'deposit_reminder_1day'
          const { count, error: duplicateCheckError } = await supabase
            .from('private_booking_sms_queue')
            .select('id', { count: 'exact', head: true })
            .eq('booking_id', booking.id)
            .eq('trigger_type', triggerType)
            .in('status', ['pending', 'approved', 'sent'])

          if (duplicateCheckError) {
            logger.warn('Skipping private booking 1-day reminder due to duplicate-check query failure', {
              metadata: {
                bookingId: booking.id,
                triggerType,
                runKey,
                error: duplicateCheckError.message
              }
            })
            continue
          }

          if ((count ?? 0) === 0) {
            const reservation = await reserveCronSmsSend(supabase, {
              bookingId: booking.id,
              triggerType,
              windowKey: holdExpiryWindowKey
            })
            if (!reservation.reserved) continue

            const messageBody = depositReminder1DayMessage({
              customerFirstName: booking.customer_first_name,
              eventDate: eventDateReadable,
              depositAmount: Number(booking.deposit_amount ?? 0),
            })

            const result = await SmsQueueService.queueAndSend({
              booking_id: booking.id,
              trigger_type: triggerType,
              template_key: `private_booking_${triggerType}`,
              message_body: messageBody,
              customer_phone: contactPhone,
              customer_name: booking.customer_name,
              priority: 2
            })

            if (result.error) {
              console.error(`Failed to queue 1-day reminder for booking ${booking.id}:`, result.error)
            } else if (result.sent) {
              stats.remindersSent++
            }

            maybeAbortFromSmsResult(result, {
              stage: `pass1:${triggerType}`,
              bookingId: booking.id,
              triggerType,
              templateKey: `private_booking_${triggerType}`
            })

            if (abortState.aborted) {
              break
            }
          }
        }
      }
    }

    if (!abortState.aborted) {
      // --- PASS 2: EXPIRY ---
      const { data: expiredDrafts } = await supabase
        .from('private_bookings')
        .select('id, hold_expiry, event_date, internal_notes')
        .eq('status', 'draft')
        .lt('hold_expiry', now.toISOString())
        .not('hold_expiry', 'is', null);

      if (expiredDrafts) {
        for (const booking of expiredDrafts) {
          // Suppress expiry SMS for bookings whose date was never confirmed.
          if (isBookingDateTbd(booking)) continue

          const canSendExpiryNotification = canSendMoreSms()
          if (!canSendExpiryNotification) {
            stats.smsCapReached = true
          }

          try {
            const expireResult = await PrivateBookingService.expireBooking(booking.id, {
              sendNotification: canSendExpiryNotification,
              asSystem: true
            })
            stats.expirationsProcessed++
            if (expireResult.smsSent) {
              stats.expirationSmsSent++
            }

            maybeAbortFromSmsResult(
              {
                code: (expireResult as any).smsCode,
                logFailure: (expireResult as any).smsLogFailure === true
              },
              {
                stage: 'pass2:booking_expired',
                bookingId: booking.id,
                triggerType: 'booking_expired',
                templateKey: 'private_booking_expired'
              }
            )

            if (abortState.aborted) {
              break
            }
          } catch (expireError) {
            logger.error('Failed to expire private booking during cron run', {
              error: expireError instanceof Error ? expireError : new Error(String(expireError)),
              metadata: { bookingId: booking.id, runKey }
            })
          }
        }
      }
    }

    if (!abortState.aborted && PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED) {
      // --- PASS 3: BALANCE REMINDERS (Confirmed - Catch-up Logic) ---
      // Fire at 14, 7, or 1 days before event (selected by days-until-event).

      const fourteenDaysFromNow = new Date(now);
      fourteenDaysFromNow.setDate(now.getDate() + 14);

      const { data: confirmedBookings } = await supabase
        .from('private_bookings_with_details')
        .select(
          'id, customer_first_name, customer_name, contact_phone, customer_mobile, event_date, total_amount, calculated_total, deposit_amount, balance_due_date, final_payment_date, customer_id, internal_notes'
        )
        .eq('status', 'confirmed')
        .gt('event_date', now.toISOString()) // Future events only
        .lte('event_date', fourteenDaysFromNow.toISOString()) // Within 14-day window
      // Removed .not('contact_phone', 'is', null) to allow fallback

      if (confirmedBookings) {
        for (const booking of confirmedBookings) {
          if (!canSendMoreSms()) {
            stats.smsCapReached = true
            break
          }

          // Suppress for TBD bookings — no meaningful date to reference.
          if (isBookingDateTbd(booking)) continue

          // Resolve phone number (fallback to customer record)
          const contactPhone = booking.contact_phone || booking.customer_mobile

          if (!contactPhone) continue;

          // Simple balance check: if final payment date is set, assume paid.
          const isPaid = !!booking.final_payment_date;
          if (isPaid) continue

          // Compute days until event (ceil on ms → days, consistent with Pass 1).
          const eventMs = new Date(booking.event_date).getTime()
          if (!Number.isFinite(eventMs)) continue
          const daysUntilEvent = Math.ceil((eventMs - now.getTime()) / (1000 * 60 * 60 * 24))

          // Only fire at 14, 7, or 1 day windows.
          if (![14, 7, 1].includes(daysUntilEvent)) continue

          const totalAmount = Number(booking.calculated_total ?? booking.total_amount ?? 0)
          // Security deposit is a returnable bond — NOT deducted from event cost
          const balanceDue = Math.max(totalAmount, 0)
          if (!Number.isFinite(balanceDue) || balanceDue <= 0) continue

          const eventDateReadable = new Date(booking.event_date).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric'
          });
          const dueDateReadable = booking.balance_due_date
            ? new Date(booking.balance_due_date).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric'
            })
            : eventDateReadable

          let triggerType: 'balance_reminder_14day' | 'balance_reminder_7day' | 'balance_reminder_1day'
          let messageBody: string
          if (daysUntilEvent === 14) {
            triggerType = 'balance_reminder_14day'
            messageBody = balanceReminder14DayMessage({
              customerFirstName: booking.customer_first_name,
              eventDate: eventDateReadable,
              balanceAmount: balanceDue,
              balanceDueDate: dueDateReadable,
            })
          } else if (daysUntilEvent === 7) {
            triggerType = 'balance_reminder_7day'
            messageBody = balanceReminder7DayMessage({
              customerFirstName: booking.customer_first_name,
              eventDate: eventDateReadable,
              balanceAmount: balanceDue,
              balanceDueDate: dueDateReadable,
            })
          } else {
            triggerType = 'balance_reminder_1day'
            messageBody = balanceReminder1DayMessage({
              customerFirstName: booking.customer_first_name,
              eventDate: eventDateReadable,
              balanceAmount: balanceDue,
            })
          }

          // Check duplicate via the sms queue (legacy dedup).
          const { count, error: duplicateCheckError } = await supabase
            .from('private_booking_sms_queue')
            .select('id', { count: 'exact', head: true })
            .eq('booking_id', booking.id)
            .eq('trigger_type', triggerType)
            .in('status', ['pending', 'approved', 'sent']);

          if (duplicateCheckError) {
            logger.warn('Skipping private booking balance reminder due to duplicate-check query failure', {
              metadata: {
                bookingId: booking.id,
                triggerType,
                runKey,
                error: duplicateCheckError.message
              }
            })
            continue
          }

          if ((count ?? 0) > 0) continue

          if (!canSendMoreSms()) {
            stats.smsCapReached = true
            break
          }

          // Window key: balance_due_date for the 14-/7-day windows, event_date for 1-day.
          const balanceWindowKey =
            triggerType === 'balance_reminder_1day'
              ? new Date(booking.event_date).toISOString().slice(0, 10)
              : (booking.balance_due_date ?? booking.event_date).slice(0, 10)

          const reservation = await reserveCronSmsSend(supabase, {
            bookingId: booking.id,
            triggerType,
            windowKey: balanceWindowKey
          })
          if (!reservation.reserved) continue

          const result = await SmsQueueService.queueAndSend({
            booking_id: booking.id,
            trigger_type: triggerType,
            template_key: `private_booking_${triggerType}`,
            message_body: messageBody,
            customer_phone: contactPhone,
            customer_name: booking.customer_name,
            customer_id: booking.customer_id ?? undefined,
            priority: 1
          });

          if (result.error) {
            console.error(`Failed to queue balance reminder for booking ${booking.id}:`, result.error);
          } else if (result.sent) {
            stats.balanceRemindersSent++;
          }

          maybeAbortFromSmsResult(result, {
            stage: `pass3:${triggerType}`,
            bookingId: booking.id,
            triggerType,
            templateKey: `private_booking_${triggerType}`
          })

          if (abortState.aborted) {
            break
          }
        }
      }
    }

    if (!abortState.aborted && PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED) {
      // --- PASS 4: EVENT REMINDER (Confirmed - 1 day before) ---
      const tomorrow = new Date(now)
      tomorrow.setDate(now.getDate() + 1)
      const tomorrowLondon = getLondonRunKey(tomorrow)

      const { data: tomorrowBookings } = await supabase
        .from('private_bookings')
        .select('id, customer_first_name, customer_name, contact_phone, start_time, guest_count, event_date, customer_id, internal_notes')
        .eq('status', 'confirmed')
        .eq('event_date', tomorrowLondon)

      if (tomorrowBookings) {
        for (const booking of tomorrowBookings) {
          if (!canSendMoreSms()) {
            stats.smsCapReached = true
            break
          }

          // Canonical TBD-detection helper (replaces the inline string match).
          if (isBookingDateTbd(booking)) continue

          const triggerType = 'event_reminder_1d'

          const { count, error: duplicateCheckError } = await supabase
            .from('private_booking_sms_queue')
            .select('id', { count: 'exact', head: true })
            .eq('booking_id', booking.id)
            .eq('trigger_type', triggerType)
            .in('status', ['pending', 'approved', 'sent'])

          if (duplicateCheckError) {
            logger.warn('Skipping private booking event reminder due to duplicate-check query failure', {
              metadata: {
                bookingId: booking.id,
                triggerType,
                runKey,
                error: duplicateCheckError.message
              }
            })
            continue
          }

          if ((count ?? 0) > 0) continue

          const eventReminderWindowKey = new Date(booking.event_date).toISOString().slice(0, 10)
          const reservation = await reserveCronSmsSend(supabase, {
            bookingId: booking.id,
            triggerType,
            windowKey: eventReminderWindowKey
          })
          if (!reservation.reserved) continue

          const rawFirstName = booking.customer_first_name || booking.customer_name?.split(' ')[0]
          const guestPart = booking.guest_count ? `for your ${booking.guest_count} guests` : ''

          const messageBody = eventReminder1DayMessage({
            customerFirstName: rawFirstName,
            guestPart,
          })

          const result = await SmsQueueService.queueAndSend({
            booking_id: booking.id,
            trigger_type: triggerType,
            template_key: `private_booking_${triggerType}`,
            message_body: messageBody,
            customer_phone: booking.contact_phone,
            customer_name: booking.customer_name,
            customer_id: booking.customer_id ?? undefined,
            priority: 3
          })

          if (result.error) {
            console.error(`Failed to queue event reminder for booking ${booking.id}:`, result.error)
          } else if (result.sent) {
            stats.eventRemindersSent++
          }

          maybeAbortFromSmsResult(result, {
            stage: `pass4:${triggerType}`,
            bookingId: booking.id,
            triggerType,
            templateKey: `private_booking_${triggerType}`
          })

          if (abortState.aborted) {
            break
          }
        }
      }
    }

    // RETIRED: consolidated into private_booking_post_event_followup
    // Pass 5 (private_booking_feedback_followup) has been retired. The feedback form flow
    // (createPrivateBookingFeedbackToken / /g/[token]/private-feedback) continues to work for
    // existing tokens, but no new tokens are generated. Private booking review SMS now sends
    // a direct Google review link via the review-once system.

    if (!abortState.aborted && PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED) {
      // --- PASS 5: POST-EVENT FOLLOWUP (Google review request — morning after event) ---
      const yesterdayLondon = getLondonRunKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))
      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      const reviewLinkTarget = await getGoogleReviewLink(supabase)
      const supportPhone =
        process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined

      const { data: yesterdayBookings } = await supabase
        .from('private_bookings')
        .select('id, customer_first_name, customer_name, contact_phone, event_date, customer_id')
        .in('status', ['confirmed', 'completed'])
        .eq('event_date', yesterdayLondon)
        .is('review_processed_at', null)

      if (yesterdayBookings && yesterdayBookings.length > 0) {
        // Batch review-once check for all eligible customers
        const customerIds = yesterdayBookings
          .map((b) => b.customer_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
        const alreadyReviewedSet = await hasCustomerReviewed(customerIds)
        const nowIso = new Date().toISOString()

        for (const booking of yesterdayBookings) {
          if (!canSendMoreSms()) {
            stats.smsCapReached = true
            break
          }

          const customerId = booking.customer_id
          const contactPhone = booking.contact_phone

          // Mark processed regardless of send outcome (avoid re-processing)
          const markProcessed = async () => {
            await supabase
              .from('private_bookings')
              .update({ review_processed_at: nowIso, updated_at: nowIso })
              .eq('id', booking.id)
              .is('review_processed_at', null)
          }

          // If no customer_id or phone, skip but mark processed
          if (!customerId || !contactPhone) {
            await markProcessed()
            continue
          }

          // Review-once: suppress if customer already left a review on any booking
          if (alreadyReviewedSet.has(customerId)) {
            logger.info('Private booking post-event review SMS suppressed: customer already reviewed', {
              metadata: { bookingId: booking.id, customerId }
            })
            await markProcessed()
            continue
          }

          // Generate review redirect token
          let redirectUrl: string
          try {
            const provisionalExpiry = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString()
            const { rawToken } = await createGuestToken(supabase, {
              customerId,
              actionType: 'review_redirect',
              privateBookingId: booking.id,
              expiresAt: provisionalExpiry
            })
            redirectUrl = `${appBaseUrl}/r/${rawToken}`
          } catch (tokenError) {
            logger.warn('Private booking post-event: failed to create review redirect token; skipping', {
              metadata: {
                bookingId: booking.id,
                customerId,
                error: tokenError instanceof Error ? tokenError.message : String(tokenError)
              }
            })
            await markProcessed()
            continue
          }

          const rawFirstName = booking.customer_first_name || booking.customer_name?.split(' ')[0]
          const firstName = getSmartFirstName(rawFirstName)
          const messageBody = ensureReplyInstruction(
            `The Anchor: ${firstName}! Hope your event was everything you wanted. Got 30 seconds? A quick review means the world to us: ${redirectUrl}`,
            supportPhone
          )

          const smsResult = await sendSMS(contactPhone, messageBody, {
            customerId,
            metadata: {
              private_booking_id: booking.id,
              template_key: 'private_booking_post_event_followup',
              review_redirect_target: reviewLinkTarget
            }
          })

          if (smsResult.success) {
            stats.postEventFollowupSent++
            // Mark processed immediately after successful send — this is the primary
            // guard against re-sends if the cron times out before completing other work.
            await markProcessed()
          } else {
            logger.warn('Failed to send private booking post-event review SMS', {
              metadata: {
                bookingId: booking.id,
                customerId,
                error: smsResult.error || 'Unknown error',
                code: typeof (smsResult as any).code === 'string' ? (smsResult as any).code : null
              }
            })
            // Mark processed even on failure to avoid retrying a blocked send
            await markProcessed()
          }

          maybeAbortFromSmsResult(smsResult, {
            stage: 'pass5:post_event_followup',
            bookingId: booking.id,
            triggerType: 'post_event_followup',
            templateKey: 'private_booking_post_event_followup'
          })

          if (abortState.aborted) {
            break
          }
        }
      }
    }

    console.warn('Private booking monitor completed:', stats)
    await resolveCronRunResult(
      supabase,
      runId,
      abortState.aborted ? 'failed' : 'completed',
      abortState.aborted ? abortState.abortReason || 'sms_safety_abort' : undefined
    )

    return new NextResponse(
      JSON.stringify({
        success: true,
        runKey,
        guard,
        maxSmsPerRun: MAX_PRIVATE_BOOKING_SMS_PER_RUN,
        totalSmsSent: totalSmsSent(),
        stats,
        ...abortState
      }),
      { status: 200 }
    )

  } catch (error) {
    console.error('Error in private booking monitor:', error)
    await reportCronFailure('private-booking-monitor', error)
    if (runContext) {
      const failureMessage = error instanceof Error ? error.message : 'Unknown error'
      await resolveCronRunResult(runContext.supabase, runContext.runId, 'failed', failureMessage)
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
