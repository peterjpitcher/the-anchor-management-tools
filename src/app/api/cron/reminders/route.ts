import { NextResponse } from 'next/server'
import { processScheduledEventReminders } from '@/app/actions/sms-event-reminders'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

const JOB_NAME = 'event-reminders'
const LONDON_TZ = 'Europe/London'
const STALE_RUN_WINDOW_MINUTES = 30
const DEFAULT_SEND_HOUR = 10
const eventSmsPaused = () =>
  process.env.SUSPEND_EVENT_SMS === 'true' || process.env.SUSPEND_ALL_SMS === 'true'

function getLondonRunKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
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
    logger.info('Reminder cron already completed for today', {
      metadata: { runKey, jobId: existing.id }
    })
    return { runId: existing.id, supabase, skip: true }
  }

  if (existing.status === 'running' && !isStale) {
    logger.info('Reminder cron already running, skipping duplicate trigger', {
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
    .single()

  if (restartError) {
    throw restartError
  }

  logger.warn('Reminder cron run restored from previous failed/stale state', {
    metadata: { runKey, jobId: existing.id, previousStatus: existing.status }
  })

  return { runId: restarted?.id ?? existing.id, supabase, skip: false }
}

async function resolveCronRunResult(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string,
  status: 'completed' | 'failed',
  errorMessage?: string
) {
  const updatePayload: Record<string, unknown> = {
    status,
    finished_at: new Date().toISOString()
  }

  if (errorMessage) {
    updatePayload.error_message = errorMessage.slice(0, 2000)
  }

  await supabase
    .from('cron_job_runs')
    .update(updatePayload)
    .eq('id', runId)
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  let runContext: { supabase: ReturnType<typeof createAdminClient>; runId: string; runKey: string } | null = null

  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authResult = authorizeCronRequest(request)

    if (!authResult.authorized) {
      console.log('Unauthorized reminder request', authResult.reason)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const runKey = getLondonRunKey()

    if (eventSmsPaused()) {
      logger.warn('Event SMS paused, skipping reminder cron', {
        metadata: { runKey }
      })
      return new NextResponse(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'sms_paused',
          runKey
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const londonNow = new Date(new Date().toLocaleString('en-GB', { timeZone: LONDON_TZ }))
    if (process.env.NODE_ENV === 'production' && londonNow.getHours() < DEFAULT_SEND_HOUR) {
      logger.warn('Reminder cron ran before default send hour; skipping until after 10:00 London', {
        metadata: { runKey, londonHour: londonNow.getHours() }
      })
      return new NextResponse(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'before_send_hour',
          runKey,
          londonHour: londonNow.getHours()
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const { supabase, runId, skip } = await acquireCronRun(runKey)
    runContext = { supabase, runId, runKey }

    if (skip) {
      return new NextResponse(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'already_processed',
          runKey
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('Starting reminder check (scheduled pipeline only by default)...')

    // Process new scheduled reminders from booking_reminders table (single source of truth)
    const scheduledResult = await processScheduledEventReminders()
    console.log('Scheduled reminders processed:', scheduledResult)

    if ('error' in scheduledResult) {
      await resolveCronRunResult(supabase, runId, 'failed', scheduledResult.error)
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: scheduledResult.error,
          runKey
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    if (scheduledResult.message === 'Event SMS paused') {
      await resolveCronRunResult(supabase, runId, 'failed', 'Event SMS paused')
      return new NextResponse(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'sms_paused',
          runKey
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    // Legacy path has been removed to prevent duplicate or early sends.
    console.log('Legacy reminder sender removed — only scheduled pipeline runs')
    
    console.log('Reminder check completed successfully')

    await resolveCronRunResult(supabase, runId, 'completed')

    return new NextResponse(
      JSON.stringify({
        success: true,
        scheduled: scheduledResult,
        message: 'Reminders processed successfully'
      }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Error processing reminders:', error)
    const failureMessage = error instanceof Error ? error.message : 'Unknown error'

    if (runContext) {
      try {
        await resolveCronRunResult(runContext.supabase, runContext.runId, 'failed', failureMessage)
      } catch (logError) {
        logger.error('Failed to update cron job run status', {
          error: logError as Error,
          metadata: { runId: runContext.runId, runKey: runContext.runKey }
        })
      }
    }

    // Return the error message in the response for debugging
    return new NextResponse(`Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
  }
} 
