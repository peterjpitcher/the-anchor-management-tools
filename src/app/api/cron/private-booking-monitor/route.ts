import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { SmsQueueService } from '@/services/sms-queue'
import { PrivateBookingService } from '@/services/private-bookings'
import { toLocalIsoDate } from '@/lib/dateUtils'

const JOB_NAME = 'private-booking-monitor'
const LONDON_TZ = 'Europe/London'
const STALE_RUN_WINDOW_MINUTES = 30

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
    .single()

  if (restartError) {
    throw restartError
  }

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
    const authResult = authorizeCronRequest(request)

    if (!authResult.authorized) {
      console.log('Unauthorized request', authResult.reason)
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

    console.log('Starting private booking monitor...')

    const now = new Date()
    const todayIso = toLocalIsoDate(now)
    const stats = { remindersSent: 0, expirationsProcessed: 0, balanceRemindersSent: 0 }

    // --- PASS 1: REMINDERS (7 Days & 1 Day remaining) ---
    // Find draft bookings where hold_expiry is approaching
    const { data: drafts } = await supabase
      .from('private_bookings')
      .select('id, customer_first_name, customer_name, contact_phone, hold_expiry, event_date')
      .eq('status', 'draft')
      .not('hold_expiry', 'is', null)
      .not('contact_phone', 'is', null)
    
    if (drafts) {
      for (const booking of drafts) {
        if (!booking.hold_expiry || !booking.contact_phone) continue;

        const expiry = new Date(booking.hold_expiry);
        const diffMs = expiry.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        let triggerType: string | null = null;
        let messageBody: string | null = null;

        const eventDateReadable = new Date(booking.event_date).toLocaleDateString('en-GB', { 
          day: 'numeric', month: 'long', year: 'numeric' 
        });

        if (diffDays === 7) {
          triggerType = 'deposit_reminder_7day';
          messageBody = `Hi ${booking.customer_first_name}, just a quick reminder that your hold on ${eventDateReadable} expires in 1 week. Please pay the deposit soon to secure the booking.`;
        } else if (diffDays === 1) {
          triggerType = 'deposit_reminder_1day';
          messageBody = `Hi ${booking.customer_first_name}, your hold on ${eventDateReadable} expires tomorrow! Please pay the deposit today to prevent the date being released.`;
        }

        if (triggerType && messageBody) {
           // Check if already sent
           const { count } = await supabase
             .from('private_booking_sms_queue')
             .select('*', { count: 'exact', head: true })
             .eq('booking_id', booking.id)
             .eq('trigger_type', triggerType);

           if (count === 0) {
             await SmsQueueService.queueAndSend({
               booking_id: booking.id,
               trigger_type: triggerType,
               template_key: `private_booking_${triggerType}`,
               message_body: messageBody,
               customer_phone: booking.contact_phone,
               customer_name: booking.customer_name,
               priority: 2
             });
             stats.remindersSent++;
           }
        }
      }
    }

    // --- PASS 2: EXPIRY ---
    const { data: expiredDrafts } = await supabase
      .from('private_bookings')
      .select('id, hold_expiry')
      .eq('status', 'draft')
      .lt('hold_expiry', now.toISOString())
      .not('hold_expiry', 'is', null);

    if (expiredDrafts) {
      for (const booking of expiredDrafts) {
        await PrivateBookingService.expireBooking(booking.id);
        stats.expirationsProcessed++;
      }
    }

    // --- PASS 3: BALANCE REMINDERS (14 days before event) ---
    // Find confirmed bookings where event is in 14 days and balance > 0
    // We assume total_amount and deposit_amount are set. Need to check other payments?
    // Ideally we query bookings and calculate balance. 
    // For simplicity in SQL: total_amount > (deposit_amount + COALESCE(total_other_payments, 0))
    // But 'other payments' aren't easily summed in a simple query unless we join. 
    // Let's fetch candidates and check balance in code.
    
    const fourteenDaysFromNow = new Date(now);
    fourteenDaysFromNow.setDate(now.getDate() + 14);
    const targetDateIso = toLocalIsoDate(fourteenDaysFromNow);

    const { data: confirmedBookings } = await supabase
      .from('private_bookings')
      .select(`
         id, customer_first_name, customer_name, contact_phone, event_date, 
         total_amount, deposit_amount, deposit_paid_date,
         final_payment_date
      `)
      .eq('status', 'confirmed')
      .eq('event_date', targetDateIso)
      .not('contact_phone', 'is', null);

    if (confirmedBookings) {
      for (const booking of confirmedBookings) {
        if (!booking.contact_phone) continue;

        // Simple balance check: if final payment date is set, assume paid.
        // Or check amounts.
        const isPaid = !!booking.final_payment_date;
        
        if (!isPaid) {
           const triggerType = 'balance_reminder_14day';
           const eventDateReadable = new Date(booking.event_date).toLocaleDateString('en-GB', { 
              day: 'numeric', month: 'long', year: 'numeric' 
           });
           const messageBody = `Hi ${booking.customer_first_name}, your event on ${eventDateReadable} is coming up soon! Just a reminder that the final balance is due today. Can you please arrange payment?`;

           // Check duplicate
           const { count } = await supabase
             .from('private_booking_sms_queue')
             .select('*', { count: 'exact', head: true })
             .eq('booking_id', booking.id)
             .eq('trigger_type', triggerType);

           if (count === 0) {
             await SmsQueueService.queueAndSend({
               booking_id: booking.id,
               trigger_type: triggerType,
               template_key: `private_booking_${triggerType}`,
               message_body: messageBody,
               customer_phone: booking.contact_phone,
               customer_name: booking.customer_name,
               priority: 1
             });
             stats.balanceRemindersSent++;
           }
        }
      }
    }

    console.log('Private booking monitor completed:', stats)
    await resolveCronRunResult(supabase, runId, 'completed')

    return new NextResponse(
      JSON.stringify({ success: true, stats }), 
      { status: 200 }
    )

  } catch (error) {
    console.error('Error in private booking monitor:', error)
    if (runContext) {
        const failureMessage = error instanceof Error ? error.message : 'Unknown error'
        await resolveCronRunResult(runContext.supabase, runContext.runId, 'failed', failureMessage)
    }
    return new NextResponse(`Error: ${error}`, { status: 500 })
  }
}
