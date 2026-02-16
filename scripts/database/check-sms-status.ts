#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 50

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function maskPhone(phone: string | null | undefined): string {
  if (!phone) {
    return 'unknown'
  }
  const trimmed = phone.trim()
  if (trimmed.length <= 4) {
    return '****'
  }
  return `****${trimmed.slice(-4)}`
}

function resolveBookingReference(argv: string[]): string | null {
  const idx = argv.indexOf('--booking-ref')
  if (idx !== -1) {
    return argv[idx + 1] || null
  }

  const positional = argv[2]
  if (positional && !positional.startsWith('-')) {
    return positional
  }

  return null
}

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit')
  if (idx === -1) {
    return 10
  }

  const raw = argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--limit must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > HARD_CAP) {
    throw new Error(`--limit too high (got ${parsed}, hard cap ${HARD_CAP})`)
  }
  return parsed
}

async function checkSmsStatus() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-sms-status is strictly read-only; do not pass --confirm.')
  }

  const bookingReference = resolveBookingReference(argv)
  if (!bookingReference) {
    throw new Error(
      "Missing required booking reference. Usage: tsx scripts/database/check-sms-status.ts --booking-ref TB-YYYY-XXXX (or pass as first arg)."
    )
  }

  const limit = parseLimit(argv)
  const showBody = argv.includes('--show-body')

  console.log(`📱 Checking SMS Status for Booking: ${bookingReference}\n`)
  console.log('='.repeat(60))
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Show message bodies: ${showBody ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()

  const { data: bookingRow, error: bookingError } = await supabase
    .from('table_bookings')
    .select(
      `
        id,
        booking_reference,
        status,
        created_at,
        customer:customers(
          id,
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        )
      `
    )
    .eq('booking_reference', bookingReference)
    .maybeSingle()

  if (bookingError) {
    markFailure('Failed to load table_booking for booking reference.', bookingError)
    return
  }

  if (!bookingRow) {
    markFailure(`Booking not found for reference '${bookingReference}'.`)
    return
  }

  const booking = bookingRow as {
    id: string
    booking_reference: string | null
    status: string | null
    created_at: string | null
    customer: {
      id: string
      first_name: string | null
      last_name: string | null
      mobile_number: string | null
      sms_opt_in: boolean | null
    } | null
  }

  console.log('📌 Booking Details:')
  console.log(`   Reference: ${booking.booking_reference || 'unknown'}`)
  console.log(
    `   Customer: ${booking.customer ? `${booking.customer.first_name || ''} ${booking.customer.last_name || ''}`.trim() || 'unknown' : 'unknown'}`
  )
  console.log(`   Phone: ${maskPhone(booking.customer?.mobile_number)}`)
  console.log(`   SMS Opt-in: ${booking.customer?.sms_opt_in ? '✅ Yes' : '❌ No'}`)
  console.log(`   Status: ${booking.status || 'unknown'}`)
  console.log(`   Created: ${booking.created_at ? new Date(booking.created_at).toLocaleString() : 'unknown'}`)

  console.log('\n📨 Checking SMS Jobs Queue:')
  const { data: jobsRows, error: jobsError } = await supabase
    .from('jobs')
    .select('id, type, status, created_at, scheduled_for, processed_at, error, payload')
    .or(`payload->booking_id.eq.${booking.id},payload->variables->reference.eq.${bookingReference}`)
    .order('created_at', { ascending: false })
    .limit(limit)

  const jobs = (assertScriptQuerySucceeded({
    operation: 'Load SMS-related jobs',
    error: jobsError,
    data: jobsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    type: string | null
    status: string | null
    created_at: string | null
    scheduled_for: string | null
    processed_at: string | null
    error: unknown
    payload: Record<string, unknown> | null
  }>

  if (jobs.length === 0) {
    process.exitCode = 1
    console.log('   ⚠️  NO SMS JOBS FOUND IN QUEUE (sample)')
    console.log('   This may mean the SMS was never queued for sending.')
  } else {
    console.log(`   Found ${jobs.length} job(s):\n`)
    for (const job of jobs) {
      console.log(`   Job ID: ${job.id}`)
      console.log(`   Type: ${job.type || 'unknown'}`)
      console.log(`   Status: ${job.status || 'unknown'}`)
      console.log(`   Created: ${job.created_at ? new Date(job.created_at).toLocaleString() : 'unknown'}`)
      console.log(`   Scheduled: ${job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : 'unknown'}`)
      if (job.processed_at) {
        console.log(`   Processed: ${new Date(job.processed_at).toLocaleString()}`)
      }
      if (job.error) {
        console.log(`   ❌ Error: ${String(job.error)}`)
      }
      const template = job.payload ? (job.payload['template'] as unknown) : undefined
      const to = job.payload ? (job.payload['to'] as unknown) : undefined
      if (typeof template === 'string') {
        console.log(`   Template: ${template}`)
      }
      if (typeof to === 'string') {
        console.log(`   To: ${maskPhone(to)}`)
      }
      console.log('')
    }
  }

  console.log('💬 Checking Messages Table:')
  const customerId = booking.customer?.id
  if (!customerId) {
    markFailure('Booking customer context missing; cannot check messages table.')
  } else {
    const { data: messagesRows, error: messagesError } = await supabase
      .from('messages')
      .select('id, direction, status, created_at, body, error_message')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(limit)

    const messages = (assertScriptQuerySucceeded({
      operation: 'Load recent messages for customer',
      error: messagesError,
      data: messagesRows ?? [],
      allowMissing: true
    }) ?? []) as Array<{
      id: string
      direction: string | null
      status: string | null
      created_at: string | null
      body: string | null
      error_message: string | null
    }>

    if (messages.length === 0) {
      console.log('   ⚠️  No recent messages found for this customer (sample)')
    } else {
      console.log(`   Found ${messages.length} recent message(s):\n`)
      for (const msg of messages) {
        console.log(`   Message ID: ${msg.id}`)
        console.log(`   Direction: ${msg.direction || 'unknown'}`)
        console.log(`   Status: ${msg.status || 'unknown'}`)
        console.log(`   Created: ${msg.created_at ? new Date(msg.created_at).toLocaleString() : 'unknown'}`)
        if (showBody) {
          console.log(`   Body: ${(msg.body || '').substring(0, 80)}...`)
        }
        if (msg.error_message) {
          console.log(`   ❌ Error: ${msg.error_message}`)
        }
        console.log('')
      }
    }
  }

  console.log('🔍 Checking Recent Webhook Logs (Twilio status):')
  const phone = booking.customer?.mobile_number
  const webhookQuery = supabase
    .from('webhook_logs')
    .select('id, created_at, response_status, to_number, from_number')
    .eq('webhook_type', 'twilio_status')
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: webhooksRows, error: webhooksError } = phone
    ? await webhookQuery.or(`to_number.eq.${phone},from_number.eq.${phone}`)
    : await webhookQuery

  const webhooks = (assertScriptQuerySucceeded({
    operation: 'Load recent Twilio status webhook logs',
    error: webhooksError,
    data: webhooksRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ created_at: string | null; response_status: number | null }>

  if (webhooks.length > 0) {
    console.log(`   Found ${webhooks.length} recent webhook(s)`)
    const recentWebhook = webhooks[0]
    console.log(`   Latest: ${recentWebhook?.created_at ? new Date(recentWebhook.created_at).toLocaleString() : 'unknown'}`)
    console.log(`   Status: ${recentWebhook?.response_status ?? 'unknown'}`)
  } else {
    console.log('   No recent webhook activity found in sample')
  }

  console.log('\n📊 Customer Messaging Health:')
  if (!customerId) {
    console.log('   No customer ID available.')
  } else {
    const { data: healthRow, error: healthError } = await supabase
      .from('customer_messaging_health')
      .select('sms_suspended, sms_failure_count, last_sms_sent_at, last_sms_error')
      .eq('customer_id', customerId)
      .maybeSingle()

    if (healthError) {
      markFailure('Failed to load customer_messaging_health.', healthError)
    } else if (healthRow) {
      const health = healthRow as {
        sms_suspended: boolean | null
        sms_failure_count: number | null
        last_sms_sent_at: string | null
        last_sms_error: string | null
      }

      console.log(`   SMS Suspended: ${health.sms_suspended ? '❌ Yes' : '✅ No'}`)
      console.log(`   Failure Count: ${health.sms_failure_count ?? 0}`)
      if (health.last_sms_sent_at) {
        console.log(`   Last SMS Sent: ${new Date(health.last_sms_sent_at).toLocaleString()}`)
      }
      if (health.last_sms_error) {
        console.log(`   Last Error: ${health.last_sms_error}`)
      }
    } else {
      console.log('   No health record found (this is normal for new customers)')
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('📋 Summary:')

  const anyCompleted = jobs.some((j) => j.status === 'completed')
  const anyErrored = jobs.some((j) => Boolean(j.error))

  if (jobs.length === 0) {
    console.log('   ❌ No SMS jobs found - SMS was likely never queued.')
  } else if (anyErrored) {
    process.exitCode = 1
    console.log('   ❌ SMS job(s) failed with error.')
  } else if (anyCompleted) {
    console.log('   ✅ At least one SMS job was processed.')
  } else {
    console.log('   ⏳ SMS job(s) are pending/not processed yet.')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ SMS status check completed with failures.')
  } else {
    console.log('\n✅ SMS status check complete!')
  }
}

void checkSmsStatus().catch((error) => {
  markFailure('check-sms-status failed.', error)
})

