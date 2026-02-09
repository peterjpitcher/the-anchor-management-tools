import { NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { SmsQueueService } from '@/services/sms-queue'
import { PrivateBookingService } from '@/services/private-bookings'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { sendSMS } from '@/lib/twilio'
import {
  createPrivateBookingFeedbackToken,
  PRIVATE_BOOKING_FEEDBACK_TEMPLATE_KEY
} from '@/lib/private-bookings/feedback'
import { recordAnalyticsEvent } from '@/lib/analytics/events'

const JOB_NAME = 'private-booking-monitor'
const LONDON_TZ = 'Europe/London'
const STALE_RUN_WINDOW_MINUTES = 30
const PRIVATE_FEEDBACK_LOOKBACK_DAYS = 7

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

function computePrivateFeedbackDueAt(eventDate?: string | null): Date | null {
  if (!eventDate) return null
  try {
    const [yearRaw, monthRaw, dayRaw] = eventDate.split('-').map((value) => Number.parseInt(value, 10))
    if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || !Number.isFinite(dayRaw)) {
      return null
    }

    const nextDayUtc = new Date(Date.UTC(yearRaw, monthRaw - 1, dayRaw + 1))
    const nextDateKey = [
      String(nextDayUtc.getUTCFullYear()),
      String(nextDayUtc.getUTCMonth() + 1).padStart(2, '0'),
      String(nextDayUtc.getUTCDate()).padStart(2, '0')
    ].join('-')

    const londonNextMorning = fromZonedTime(`${nextDateKey}T09:00`, LONDON_TZ)
    return Number.isFinite(londonNextMorning.getTime()) ? londonNextMorning : null
  } catch {
    return null
  }
}

async function loadSentPrivateFeedbackSet(
  supabase: ReturnType<typeof createAdminClient>,
  bookingIds: string[]
): Promise<Set<string>> {
  const sent = new Set<string>()
  if (bookingIds.length === 0) {
    return sent
  }

  for (const bookingChunk of chunkArray(bookingIds)) {
    const { data, error } = await supabase
      .from('messages')
      .select('private_booking_id, metadata')
      .in('private_booking_id', bookingChunk)
      .eq('template_key', PRIVATE_BOOKING_FEEDBACK_TEMPLATE_KEY)

    if (error) {
      logger.warn('Failed loading private-booking feedback dedupe set', {
        metadata: {
          error: error.message
        }
      })
      continue
    }

    for (const row of data || []) {
      const bookingId = (row as any).private_booking_id || (row as any)?.metadata?.private_booking_id
      if (typeof bookingId === 'string') {
        sent.add(bookingId)
      }
    }
  }

  return sent
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
    const stats = {
      remindersSent: 0,
      expirationsProcessed: 0,
      balanceRemindersSent: 0,
      eventRemindersSent: 0,
      privateFeedbackSmsSent: 0
    }

    // --- PASS 1: REMINDERS (Drafts - Catch-up Logic) ---
    // Find draft bookings where hold_expiry is approaching (<= 7 days)
    const { data: drafts } = await supabase
      .from('private_bookings')
      .select('id, customer_first_name, customer_name, contact_phone, hold_expiry, event_date, customer_id')
      .eq('status', 'draft')
      .gt('hold_expiry', now.toISOString()) // Not expired yet
      .not('hold_expiry', 'is', null)
      // Removed .not('contact_phone', 'is', null) to support fallback to customer record
    
    if (drafts) {
      for (const booking of drafts) {
        if (!booking.hold_expiry) continue;

        // Resolve phone number (fallback to customer record)
        let contactPhone = booking.contact_phone;
        if (!contactPhone && booking.customer_id) {
            const { data: customer } = await supabase
                .from('customers')
                .select('mobile_number')
                .eq('id', booking.customer_id)
                .single();
            contactPhone = customer?.mobile_number;
        }

        if (!contactPhone) continue;

        const expiry = new Date(booking.hold_expiry);
        const diffMs = expiry.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        const eventDateReadable = new Date(booking.event_date).toLocaleDateString('en-GB', { 
          day: 'numeric', month: 'long', year: 'numeric' 
        });

        // 1. Check 7-Day Reminder (Window: 2-7 days)
        if (diffDays <= 7 && diffDays > 1) {
            const triggerType = 'deposit_reminder_7day';
            // Check if ALREADY sent
            const { count } = await supabase
                .from('private_booking_sms_queue')
                .select('*', { count: 'exact', head: true })
                .eq('booking_id', booking.id)
                .eq('trigger_type', triggerType)
                .in('status', ['pending', 'approved', 'sent']);
            
            if ((count ?? 0) === 0) {
                const messageBody = `The Anchor: Hi ${booking.customer_first_name}, just a reminder that your hold on ${eventDateReadable} expires in ${diffDays} days. Please pay the deposit soon to secure the date.`;
                
                const result = await SmsQueueService.queueAndSend({
                    booking_id: booking.id,
                    trigger_type: triggerType,
                    template_key: `private_booking_${triggerType}`,
                    message_body: messageBody,
                    customer_phone: contactPhone,
                    customer_name: booking.customer_name,
                    priority: 2
                });

                if (result.error) {
                    console.error(`Failed to queue 7-day reminder for booking ${booking.id}:`, result.error);
                } else {
                    stats.remindersSent++;
                }
            }
        }

        // 2. Check 1-Day Reminder (Window: <= 1 day)
        if (diffDays <= 1 && diffDays > 0) {
          const triggerType = 'deposit_reminder_1day'
          // Check if ALREADY sent
          const { count } = await supabase
            .from('private_booking_sms_queue')
            .select('*', { count: 'exact', head: true })
            .eq('booking_id', booking.id)
            .eq('trigger_type', triggerType)
            .in('status', ['pending', 'approved', 'sent'])

          if ((count ?? 0) === 0) {
            const expiryReadable = expiry.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long'
            })
            const messageBody = `The Anchor: Hi ${booking.customer_first_name}, your hold on ${eventDateReadable} expires soon (by ${expiryReadable}). Please pay the deposit to prevent the date being released.`

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
            } else {
              stats.remindersSent++
            }
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

    // --- PASS 3: BALANCE REMINDERS (Confirmed - Catch-up Logic) ---
    // Find confirmed bookings where event is <= 14 days away and balance > 0
    
    const fourteenDaysFromNow = new Date(now);
    fourteenDaysFromNow.setDate(now.getDate() + 14);
    // Reset time to end of day to ensure we catch events on the 14th day fully? 
    // Actually, simplest is just strict ISO string comparison.
    
    const { data: confirmedBookings } = await supabase
      .from('private_bookings_with_details')
      .select(
        'id, customer_first_name, customer_name, contact_phone, customer_mobile, event_date, total_amount, calculated_total, deposit_amount, balance_due_date, final_payment_date, customer_id'
      )
      .eq('status', 'confirmed')
      .gt('event_date', now.toISOString()) // Future events only
      .lte('event_date', fourteenDaysFromNow.toISOString()) // <= 14 days away
      // Removed .not('contact_phone', 'is', null) to allow fallback

    if (confirmedBookings) {
      for (const booking of confirmedBookings) {
        // Resolve phone number (fallback to customer record)
        const contactPhone = booking.contact_phone || booking.customer_mobile

        if (!contactPhone) continue;

        // Simple balance check: if final payment date is set, assume paid.
        const isPaid = !!booking.final_payment_date;
        
        if (!isPaid) {
           const triggerType = 'balance_reminder_14day';
           
           const totalAmount = Number(booking.calculated_total ?? booking.total_amount ?? 0)
           const depositAmount = Number(booking.deposit_amount ?? 0)
           const balanceDue = Math.max(totalAmount - depositAmount, 0)
           if (!Number.isFinite(balanceDue) || balanceDue <= 0) continue

           // Check duplicate
           const { count } = await supabase
             .from('private_booking_sms_queue')
             .select('*', { count: 'exact', head: true })
             .eq('booking_id', booking.id)
             .eq('trigger_type', triggerType)
             .in('status', ['pending', 'approved', 'sent']);

           if ((count ?? 0) === 0) {
             const eventDateReadable = new Date(booking.event_date).toLocaleDateString('en-GB', { 
                day: 'numeric', month: 'long', year: 'numeric' 
             });
             const dueDateReadable = booking.balance_due_date
               ? new Date(booking.balance_due_date).toLocaleDateString('en-GB', {
                   day: 'numeric',
                   month: 'long',
                   year: 'numeric'
                 })
               : null

             const duePart = dueDateReadable ? ` is due by ${dueDateReadable}` : ' is now due'
             const messageBody = `The Anchor: Hi ${booking.customer_first_name}, your event at The Anchor is coming up on ${eventDateReadable}. Your remaining balance of £${balanceDue.toFixed(2)}${duePart}. Please arrange payment.`

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
             } else {
               stats.balanceRemindersSent++;
             }
           }
        }
      }
    }

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
        const isDateTbdBooking = Boolean(booking.internal_notes?.includes('Event date/time to be confirmed'))
        if (isDateTbdBooking) continue

        const triggerType = 'event_reminder_1d'

        const { count } = await supabase
          .from('private_booking_sms_queue')
          .select('*', { count: 'exact', head: true })
          .eq('booking_id', booking.id)
          .eq('trigger_type', triggerType)
          .in('status', ['pending', 'approved', 'sent'])

        if ((count ?? 0) > 0) continue

        const firstName = booking.customer_first_name || booking.customer_name?.split(' ')[0] || 'there'
        const startTimeReadable = booking.start_time ? String(booking.start_time).slice(0, 5) : null
        const timePart = startTimeReadable ? ` at ${startTimeReadable}` : ''
        const guestPart = booking.guest_count ? ` for your ${booking.guest_count} guests` : ''

        const messageBody = `The Anchor: Hi ${firstName}, reminder: your event at The Anchor is tomorrow${timePart}. We're all set${guestPart}. See you tomorrow!`

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
        } else {
          stats.eventRemindersSent++
        }
      }
    }

    // --- PASS 5: PRIVATE FEEDBACK FOLLOW-UP (next morning) ---
    const supportPhone =
      process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
    const todayLondon = getLondonRunKey(now)
    const lookbackDate = new Date(now)
    lookbackDate.setDate(lookbackDate.getDate() - PRIVATE_FEEDBACK_LOOKBACK_DAYS)
    const lookbackLondon = getLondonRunKey(lookbackDate)

    const { data: privateFeedbackCandidates } = await supabase
      .from('private_bookings')
      .select(
        'id, customer_id, customer_first_name, customer_last_name, customer_name, contact_phone, event_date, start_time, status'
      )
      .in('status', ['confirmed', 'completed'])
      .gte('event_date', lookbackLondon)
      .lt('event_date', todayLondon)
      .not('event_date', 'is', null)
      .limit(2000)

    if (privateFeedbackCandidates && privateFeedbackCandidates.length > 0) {
      const sentPrivateFeedback = await loadSentPrivateFeedbackSet(
        supabase,
        privateFeedbackCandidates.map((booking) => booking.id)
      )

      for (const booking of privateFeedbackCandidates) {
        if (sentPrivateFeedback.has(booking.id)) {
          continue
        }

        const feedbackDueAt = computePrivateFeedbackDueAt(booking.event_date)
        if (!feedbackDueAt || feedbackDueAt.getTime() > now.getTime()) {
          continue
        }

        let customerId = booking.customer_id as string | null
        let mobileNumber = booking.contact_phone as string | null
        let customerFirstName = booking.customer_first_name as string | null
        let customerLastName = booking.customer_last_name as string | null
        let smsStatus: string | null = null

        if (customerId) {
          const { data: linkedCustomer } = await supabase
            .from('customers')
            .select('id, first_name, last_name, mobile_number, sms_status')
            .eq('id', customerId)
            .maybeSingle()

          if (linkedCustomer) {
            mobileNumber = mobileNumber || linkedCustomer.mobile_number || null
            customerFirstName = customerFirstName || linkedCustomer.first_name || null
            customerLastName = customerLastName || linkedCustomer.last_name || null
            smsStatus = linkedCustomer.sms_status || null
          }
        }

        if (!mobileNumber || smsStatus === 'opted_out' || smsStatus === 'sms_deactivated') {
          continue
        }

        if (!customerId) {
          const ensured = await ensureCustomerForPhone(supabase, mobileNumber, {
            firstName:
              customerFirstName || booking.customer_name?.split(' ')[0] || undefined,
            lastName: customerLastName || undefined
          })

          customerId = ensured.customerId

          if (customerId) {
            await supabase
              .from('private_bookings')
              .update({
                customer_id: customerId
              })
              .eq('id', booking.id)
          }
        }

        if (!customerId) {
          continue
        }

        const feedbackToken = await createPrivateBookingFeedbackToken(supabase, {
          customerId,
          privateBookingId: booking.id,
          eventDate: booking.event_date,
          startTime: booking.start_time,
          appBaseUrl
        })

        const firstName = customerFirstName || booking.customer_name?.split(' ')[0] || 'there'
        const smsBody = ensureReplyInstruction(
          `The Anchor: Hi ${firstName}, thanks for your private booking at The Anchor. We'd love your feedback: ${feedbackToken.url}`,
          supportPhone
        )

        const smsResult = await sendSMS(mobileNumber, smsBody, {
          customerId,
          metadata: {
            private_booking_id: booking.id,
            template_key: PRIVATE_BOOKING_FEEDBACK_TEMPLATE_KEY
          }
        })

        if (!smsResult.success) {
          continue
        }

        sentPrivateFeedback.add(booking.id)
        stats.privateFeedbackSmsSent += 1

        await recordAnalyticsEvent(supabase, {
          customerId,
          privateBookingId: booking.id,
          eventType: 'review_sms_sent',
          metadata: {
            booking_type: 'private',
            template_key: PRIVATE_BOOKING_FEEDBACK_TEMPLATE_KEY
          }
        })
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
