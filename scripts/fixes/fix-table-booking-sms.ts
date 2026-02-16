#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertFixTableBookingSmsCompletedWithoutFailures,
  assertFixTableBookingSmsProbeLimit,
  assertFixTableBookingSmsProbeMutationAllowed,
  assertFixTableBookingSmsProbeMutationSucceeded,
  readFixTableBookingSmsProbeLimit,
  resolveFixTableBookingSmsRows
} from '../../src/lib/table-booking-sms-fix-safety'

type BookingCustomerRow = {
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  sms_opt_in: boolean | null
}

type RecentBookingRow = {
  id: string
  booking_reference: string | null
  created_at: string | null
  customers: BookingCustomerRow | BookingCustomerRow[] | null
}

type SmsJobRow = {
  id: string
  status: string | null
  payload: unknown
  error_message: string | null
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return TRUTHY.has(value.trim().toLowerCase())
}

function resolveCustomerRow(
  booking: RecentBookingRow
): BookingCustomerRow | null {
  if (!booking.customers) {
    return null
  }

  if (Array.isArray(booking.customers)) {
    return booking.customers[0] ?? null
  }

  return booking.customers
}

async function runFixTableBookingSmsDiagnostics(): Promise<void> {
  const supabase = createAdminClient()
  const failures: string[] = []
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const writeProbeRequested = argv.includes('--write-probe')
  const runWriteProbe =
    !dryRunOverride &&
    confirm &&
    writeProbeRequested &&
    isTruthyEnv(process.env.RUN_FIX_TABLE_BOOKING_SMS_WRITE_PROBE)

  if (argv.includes('--help')) {
    console.log(`
fix-table-booking-sms (safe by default)

Dry-run (default):
  tsx scripts/fixes/fix-table-booking-sms.ts

Gated write probe (requires multi-gating):
  RUN_FIX_TABLE_BOOKING_SMS_WRITE_PROBE=true \\
  ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION=true \\
    tsx scripts/fixes/fix-table-booking-sms.ts --confirm --write-probe --limit=1

Notes:
  - The write probe inserts a CANCELLED send_sms job (never pending) and deletes it immediately.
`)
    return
  }

  if (confirm && !runWriteProbe && !dryRunOverride) {
    throw new Error(
      'fix-table-booking-sms blocked: --confirm is only valid when running the explicitly gated write probe. Pass --write-probe --limit=1 and set RUN_FIX_TABLE_BOOKING_SMS_WRITE_PROBE=true + ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION=true.'
    )
  }

  const probeLimit = runWriteProbe
    ? assertFixTableBookingSmsProbeLimit(readFixTableBookingSmsProbeLimit(argv, process.env))
    : null

  console.log('=== Table Booking SMS Diagnostics ===\n')

  const { data: recentBookingsData, error: recentBookingsError } = await supabase
    .from('table_bookings')
    .select(`
      id,
      booking_reference,
      created_at,
      customers:customer_id (
        first_name,
        last_name,
        mobile_number,
        sms_opt_in
      )
    `)
    .eq('status', 'confirmed')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })

  const recentBookings = resolveFixTableBookingSmsRows<RecentBookingRow>({
    operation: 'Load recent confirmed table bookings for SMS diagnostics',
    rows: recentBookingsData as RecentBookingRow[] | null,
    error: recentBookingsError
  })

  if (recentBookings.length === 0) {
    console.log('No recent confirmed bookings found')
  } else {
    console.log(`Found ${recentBookings.length} recent confirmed bookings\n`)
  }

  for (const booking of recentBookings) {
    const customer = resolveCustomerRow(booking)
    console.log(`Checking booking ${booking.booking_reference || booking.id} (${booking.id})`)
    console.log(`Customer: ${(customer?.first_name || 'Unknown')} ${(customer?.last_name || '').trim()}`)
    console.log(`SMS Opt-in: ${customer?.sms_opt_in === true}`)

    const { data: smsJobsData, error: smsJobsError } = await supabase
      .from('jobs')
      .select('id, status, payload, error_message')
      .eq('type', 'send_sms')
      .or(`payload->booking_id.eq.${booking.id},payload->table_booking_id.eq.${booking.id}`)
      .limit(1)

    try {
      const jobs = resolveFixTableBookingSmsRows<SmsJobRow>({
        operation: `Load existing SMS jobs for booking ${booking.id}`,
        rows: smsJobsData as SmsJobRow[] | null,
        error: smsJobsError
      })

      if (jobs.length === 0) {
        console.log('❌ No SMS job found for this booking')
        if (customer?.sms_opt_in && customer.mobile_number) {
          console.log('   Customer has opted in and has phone number - SMS should have been queued')
        }
      } else {
        console.log('✅ SMS job exists')
        console.log(`   Job status: ${jobs[0].status || 'unknown'}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`booking:${booking.id}:${message}`)
      console.error(`❌ Failed SMS-job lookup for booking ${booking.id}: ${message}`)
    }

    console.log('---')
  }

  console.log('\n=== Recent Failed SMS Jobs ===')
  const { data: failedJobsData, error: failedJobsError } = await supabase
    .from('jobs')
    .select('id, error_message, payload')
    .eq('type', 'send_sms')
    .eq('status', 'failed')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10)

  const failedJobs = resolveFixTableBookingSmsRows<SmsJobRow>({
    operation: 'Load recent failed SMS jobs for diagnostics',
    rows: failedJobsData as SmsJobRow[] | null,
    error: failedJobsError
  })

  if (failedJobs.length === 0) {
    console.log('No failed SMS jobs found')
  } else {
    console.log(`Found ${failedJobs.length} failed SMS jobs:`)
    for (const job of failedJobs) {
      console.log(`- Job ${job.id}: ${job.error_message || '<no error_message>'}`)
    }
  }

  if (runWriteProbe) {
    assertFixTableBookingSmsProbeMutationAllowed()
    console.log('\n=== Running gated write probe (explicitly enabled) ===')
    console.log(`Probe row cap: ${probeLimit}`)

    const probePayload = {
      to: '+447700900123',
      body: 'Diagnostic probe - do not send',
      is_test: true
    }

    const scheduledFor = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: insertedRows, error: insertError } = await supabase
      .from('jobs')
      .insert({
        type: 'send_sms',
        payload: probePayload,
        status: 'cancelled',
        error_message: 'Cancelled diagnostic probe - do not send',
        scheduled_for: scheduledFor,
        completed_at: new Date().toISOString()
      })
      .select('id')

    const { updatedCount } = assertFixTableBookingSmsProbeMutationSucceeded({
      operation: 'Insert table-booking SMS diagnostic probe job',
      error: insertError,
      rows: insertedRows,
      expectedCount: probeLimit ?? 1
    })

    const probeJobId = insertedRows?.[0]?.id
    if (!probeJobId || updatedCount !== (probeLimit ?? 1)) {
      failures.push('probe_insert_missing_id')
    } else {
      const { data: deletedRows, error: deleteError } = await supabase
        .from('jobs')
        .delete()
        .eq('id', probeJobId)
        .select('id')

      try {
        assertFixTableBookingSmsProbeMutationSucceeded({
          operation: 'Delete table-booking SMS diagnostic probe job',
          error: deleteError,
          rows: deletedRows,
          expectedCount: probeLimit ?? 1
        })
        console.log(`✅ Probe job created and cleaned up: ${probeJobId}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`probe_cleanup:${message}`)
        console.error(`❌ Probe cleanup failed: ${message}`)
      }
    }
  } else {
    console.log('\n=== Write probe skipped (read-only mode) ===')
    console.log(
      'To run the gated mutation probe, pass --confirm --write-probe --limit=1 and set RUN_FIX_TABLE_BOOKING_SMS_WRITE_PROBE=true and ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION=true.'
    )
  }

  assertFixTableBookingSmsCompletedWithoutFailures({
    failureCount: failures.length,
    failures
  })
}

runFixTableBookingSmsDiagnostics().catch((error) => {
  console.error('❌ fix-table-booking-sms script failed:', error)
  process.exitCode = 1
})
