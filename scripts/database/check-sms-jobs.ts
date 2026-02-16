#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { config } from 'dotenv'
import path from 'path'

config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'check-sms-jobs'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ${message}`)
}

async function checkSMSJobs() {
  if (process.argv.includes('--confirm')) {
    throw new Error('check-sms-jobs is read-only and does not support --confirm.')
  }

  console.log('Checking SMS Jobs Queue...\n')

  const supabase = createAdminClient()

  // 1. Check pending SMS jobs
  console.log('1. Pending SMS Jobs:')
  const { data: pendingJobs, error: pendingError } = await supabase
    .from('jobs')
    .select('id, created_at, scheduled_for, status, payload, error_message')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10)

  const pendingSmsRows = (assertScriptQuerySucceeded({
    operation: 'Load pending SMS jobs',
    error: pendingError,
    data: pendingJobs ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    id: string
    created_at: string
    scheduled_for: string | null
    payload: unknown
  }>

  console.log(`Found ${pendingSmsRows.length} pending SMS jobs`)
  if (pendingSmsRows.length > 0) {
    console.table(
      pendingSmsRows.map((job) => ({
        id: job.id,
        created_at: job.created_at,
        scheduled_for: job.scheduled_for,
        payload_preview: `${JSON.stringify(job.payload).substring(0, 80)}...`,
      }))
    )
  }

  // 2. Check failed SMS jobs
  console.log('\n2. Failed SMS Jobs:')
  const { data: failedJobs, error: failedError } = await supabase
    .from('jobs')
    .select('id, created_at, status, attempts, error_message, payload')
    .eq('type', 'send_sms')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(10)

  const failedSmsRows = (assertScriptQuerySucceeded({
    operation: 'Load failed SMS jobs',
    error: failedError,
    data: failedJobs ?? [],
    allowMissing: true,
  }) ?? []) as Array<{ id: string; created_at: string; attempts: number | null; error_message: string | null }>

  console.log(`Found ${failedSmsRows.length} failed SMS jobs`)
  if (failedSmsRows.length > 0) {
    console.table(
      failedSmsRows.map((job) => ({
        id: job.id,
        created_at: job.created_at,
        attempts: job.attempts,
        error: job.error_message || 'unknown',
      }))
    )
  }

  // 3. Check recent table bookings (to validate customer opt-in state)
  console.log('\n3. Recent Table Bookings (last 7 days):')
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const { data: recentBookings, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(
      `
      id,
      booking_reference,
      date,
      time,
      status,
      created_at,
      customers (
        id,
        first_name,
        last_name,
        mobile_number,
        sms_opt_in
      )
    `
    )
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(10)

  const recentBookingRows = (assertScriptQuerySucceeded({
    operation: 'Load recent table bookings',
    error: bookingsError,
    data: recentBookings ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    booking_reference: string
    customers: { first_name?: string | null; last_name?: string | null; sms_opt_in?: boolean | null } | null
    date: string
    time: string | null
    status: string
    created_at: string
  }>

  console.log(`Found ${recentBookingRows.length} recent bookings`)
  if (recentBookingRows.length > 0) {
    console.table(
      recentBookingRows.map((booking) => ({
        booking_reference: booking.booking_reference,
        customer: `${booking.customers?.first_name ?? ''} ${booking.customers?.last_name ?? ''}`.trim(),
        date: booking.date,
        time: booking.time,
        status: booking.status,
        sms_opt_in: booking.customers?.sms_opt_in,
        created_at: booking.created_at,
      }))
    )
  }

  // 4. Check table booking SMS templates
  console.log('\n4. Active Table Booking SMS Templates:')
  const { data: templates, error: templatesError } = await supabase
    .from('table_booking_sms_templates')
    .select('template_key, booking_type, is_active')
    .eq('is_active', true)
    .order('template_key', { ascending: true })

  const activeTemplateRows = (assertScriptQuerySucceeded({
    operation: 'Load active table booking SMS templates',
    error: templatesError,
    data: templates ?? [],
    allowMissing: true,
  }) ?? []) as Array<{ template_key: string; booking_type: string | null; is_active: boolean }>

  console.log(`Found ${activeTemplateRows.length} active templates`)
  if (activeTemplateRows.length > 0) {
    console.table(
      activeTemplateRows.map((template) => ({
        template_key: template.template_key,
        booking_type: template.booking_type || 'all',
        is_active: template.is_active,
      }))
    )
  }

  // 5. Check environment variables (SMS + job processor)
  console.log('\n5. Environment Variables Check:')
  const envVars = {
    TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: !!process.env.TWILIO_PHONE_NUMBER,
    NEXT_PUBLIC_CONTACT_PHONE_NUMBER: !!process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER,
    CRON_SECRET: !!process.env.CRON_SECRET,
  }

  console.table(
    Object.entries(envVars).map(([key, value]) => ({
      Variable: key,
      Status: value ? '✅ Set' : '❌ Missing',
    }))
  )

  // 6. Recent job status distribution (last 24 hours, best-effort counts)
  console.log('\n6. Job Processing History (last 24 hours):')
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const statuses: Array<'pending' | 'processing' | 'completed' | 'failed'> = [
    'pending',
    'processing',
    'completed',
    'failed',
  ]

  const counts: Record<string, number> = {}
  for (const status of statuses) {
    const { count, error } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'send_sms')
      .eq('status', status)
      .gte('created_at', since24h)

    assertScriptQuerySucceeded({
      operation: `Load ${status} send_sms job count`,
      error,
      data: count ?? 0,
      allowMissing: true,
    })

    counts[status] = count || 0
  }

  console.table(
    Object.entries(counts).map(([status, count]) => ({
      Status: status,
      Count: count,
    }))
  )

  if (process.exitCode === 1) {
    console.log('\nSMS jobs check completed with failures.')
  } else {
    console.log('\nSMS jobs check complete.')
  }
}

void checkSMSJobs().catch((error) => {
  markFailure('check-sms-jobs failed.', error)
})
