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

function safePreview(value: unknown, maxChars: number): string {
  try {
    const asString = typeof value === 'string' ? value : JSON.stringify(value)
    if (typeof asString !== 'string') {
      return '[unprintable]'
    }
    if (asString.length <= maxChars) {
      return asString
    }
    return `${asString.substring(0, maxChars)}...`
  } catch {
    return '[unserializable]'
  }
}

type AuditLogRows = Array<Record<string, unknown>>

async function loadAuditLogs(params: {
  supabase: ReturnType<typeof createAdminClient>
  bookingId: string
  limit: number
}): Promise<{ mode: 'resource' | 'entity' | null; rows: AuditLogRows }> {
  const { supabase, bookingId, limit } = params

  const { data: resourceRows, error: resourceError } = await supabase
    .from('audit_logs')
    .select('id, operation_type, operation_status, created_at, additional_info')
    .eq('resource_type', 'table_booking')
    .eq('resource_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!resourceError) {
    return { mode: 'resource', rows: resourceRows ?? [] }
  }

  const { data: entityRows, error: entityError } = await supabase
    .from('audit_logs')
    .select('id, action, created_at, metadata')
    .eq('entity_type', 'table_booking')
    .eq('entity_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!entityError) {
    return { mode: 'entity', rows: entityRows ?? [] }
  }

  markFailure('Failed to load audit logs (both schema variants failed).', {
    resourceError,
    entityError
  })
  return { mode: null, rows: [] }
}

async function checkBookingErrors() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-booking-errors is strictly read-only; do not pass --confirm.')
  }

  const bookingReference = resolveBookingReference(argv)
  if (!bookingReference) {
    throw new Error(
      "Missing required booking reference. Usage: tsx scripts/database/check-booking-errors.ts --booking-ref TB-YYYY-XXXX (or pass as first arg)."
    )
  }

  const limit = parseLimit(argv)
  const showAdditionalInfo = argv.includes('--show-additional-info')

  console.log(`🔍 Checking booking '${bookingReference}' in detail\n`)
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Show additional info: ${showAdditionalInfo ? 'yes' : 'no'}`)
  console.log('Note: This script is strictly read-only and will not queue SMS or mutate jobs.\n')

  const supabase = createAdminClient()

  const { data: bookingRow, error: bookingError } = await supabase
    .from('table_bookings')
    .select(
      `
        id,
        booking_reference,
        status,
        booking_type,
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
    booking_type: string | null
    created_at: string | null
    customer: {
      id: string
      first_name: string | null
      last_name: string | null
      mobile_number: string | null
      sms_opt_in: boolean | null
    } | null
  }

  console.log('📝 Booking Details:')
  console.log(`  ID: ${booking.id}`)
  console.log(`  Reference: ${booking.booking_reference || 'unknown'}`)
  console.log(`  Status: ${booking.status || 'unknown'}`)
  console.log(`  Type: ${booking.booking_type || 'unknown'}`)
  console.log(`  Created: ${booking.created_at ? new Date(booking.created_at).toLocaleString() : 'unknown'}`)
  console.log(
    `  Customer: ${booking.customer ? `${booking.customer.first_name || ''} ${booking.customer.last_name || ''}`.trim() || 'unknown' : 'unknown'}`
  )
  console.log(`  Phone: ${maskPhone(booking.customer?.mobile_number)}`)
  console.log(`  SMS Opt-in: ${booking.customer?.sms_opt_in ? '✅ Yes' : '❌ No'}\n`)

  console.log('📋 Audit Logs (sample):')
  const auditLogs = await loadAuditLogs({ supabase, bookingId: booking.id, limit })
  if (auditLogs.rows.length === 0) {
    console.log('  No audit logs found (or query failed).')
  } else if (auditLogs.mode === 'resource') {
    auditLogs.rows.forEach((row) => {
      console.log(`  - ${String(row['operation_type'] || 'unknown')} at ${String(row['created_at'] || '')}`)
      if (showAdditionalInfo && row['additional_info']) {
        console.log(`    Info: ${safePreview(row['additional_info'], 400)}`)
      }
    })
  } else {
    auditLogs.rows.forEach((row) => {
      console.log(`  - ${String(row['action'] || 'unknown')} at ${String(row['created_at'] || '')}`)
      if (showAdditionalInfo && row['metadata']) {
        console.log(`    Info: ${safePreview(row['metadata'], 400)}`)
      }
    })
  }

  console.log('\n🔍 Related jobs (sample):')
  const { data: jobsRows, error: jobsError } = await supabase
    .from('jobs')
    .select('id, type, status, created_at, scheduled_for, processed_at, error, payload')
    .or(
      [
        `payload->booking_id.eq.${booking.id}`,
        `payload->bookingId.eq.${booking.id}`,
        `payload->cs->booking_id.eq.${booking.id}`,
        `payload->cs->bookingId.eq.${booking.id}`
      ].join(',')
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  const jobs = (assertScriptQuerySucceeded({
    operation: 'Load related jobs',
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
    payload: unknown
  }>

  if (jobs.length === 0) {
    console.log('  No related jobs found in sample.')
  } else {
    jobs.forEach((job) => {
      console.log(`  - Job ${job.id}`)
      console.log(`    Type: ${job.type || 'unknown'}`)
      console.log(`    Status: ${job.status || 'unknown'}`)
      console.log(`    Created: ${job.created_at ? new Date(job.created_at).toLocaleString() : 'unknown'}`)
      if (job.scheduled_for) {
        console.log(`    Scheduled: ${new Date(job.scheduled_for).toLocaleString()}`)
      }
      if (job.processed_at) {
        console.log(`    Processed: ${new Date(job.processed_at).toLocaleString()}`)
      }
      if (job.error) {
        console.log(`    Error: ${safePreview(job.error, 200)}`)
      }
      console.log(`    Payload: ${safePreview(job.payload, 200)}`)
    })
  }
}

void checkBookingErrors().catch((error) => {
  markFailure('check-booking-errors failed.', error)
})

