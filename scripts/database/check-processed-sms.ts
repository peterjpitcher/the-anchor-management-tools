#!/usr/bin/env tsx

/**
 * check-processed-sms (read-only diagnostic)
 *
 * Inspect send_sms jobs + messages for one or more table booking references.
 *
 * Usage:
 *   tsx scripts/database/check-processed-sms.ts TB-2025-1234 [TB-2025-5678 ...]
 *
 * Safety:
 * - Strictly read-only (blocks --confirm).
 * - Fails closed by setting process.exitCode=1 when any check cannot be performed.
 * - No hardcoded booking references.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

type BookingRow = {
  id: string
  customer_id: string | null
  created_at: string | null
  status: string | null
}

type JobRow = {
  id: string
  status: string | null
  created_at: string | null
  completed_at: string | null
  payload: Record<string, unknown> | null
  error_message: string | null
}

type MessageRow = {
  id: string
  status: string | null
  twilio_status: string | null
  created_at: string | null
  body: string | null
  metadata: Record<string, unknown> | null
}

function markFailure(failures: string[], message: string, error?: unknown) {
  process.exitCode = 1
  failures.push(message)
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function readBookingRefs(argv: string[]): string[] {
  const out: string[] = []
  for (const arg of argv) {
    if (typeof arg !== 'string') continue
    if (arg.startsWith('--')) continue
    const trimmed = arg.trim()
    if (!trimmed) continue
    out.push(trimmed)
  }
  return Array.from(new Set(out))
}

function safeIso(value: string | null | undefined): string {
  return typeof value === 'string' && value.length > 0 ? value : '<unknown>'
}

function safeSubstring(value: string | null | undefined, maxLen: number): string {
  const raw = typeof value === 'string' ? value : ''
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  if (!trimmed) return '<empty>'
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed
}

function isRelevantMessage(params: { bookingRef: string; bookingId: string; message: MessageRow }): boolean {
  const body = params.message.body || ''
  const metadataBookingId = params.message.metadata?.booking_id
  return (
    body.includes(params.bookingRef) ||
    body.includes('Sunday Lunch') ||
    metadataBookingId === params.bookingId
  )
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) {
    console.log(`
check-processed-sms (read-only diagnostic)

Usage:
  tsx scripts/database/check-processed-sms.ts TB-2025-1234 [TB-2025-5678 ...]

Notes:
  - Strictly read-only (blocks --confirm).
  - Sets exit code 1 when any diagnostic query errors.
`)
    return
  }

  if (argv.includes('--confirm')) {
    throw new Error('check-processed-sms is strictly read-only; remove --confirm.')
  }

  const bookingRefs = readBookingRefs(argv)
  if (bookingRefs.length === 0) {
    console.error('Usage: tsx scripts/database/check-processed-sms.ts <booking-ref> [<booking-ref> ...]')
    process.exitCode = 1
    return
  }

  const supabase = createAdminClient()
  const failures: string[] = []

  console.log('📱 check-processed-sms (read-only)\n')
  console.log(`Booking reference(s): ${bookingRefs.join(', ')}\n`)

  for (const ref of bookingRefs) {
    console.log(`\n🔍 Checking ${ref}`)
    console.log('-'.repeat(40))

    let booking: BookingRow | null = null
    try {
      const { data, error } = await supabase
        .from('table_bookings')
        .select('id, customer_id, created_at, status')
        .eq('booking_reference', ref)
        .maybeSingle()

      booking = assertScriptQuerySucceeded<BookingRow | null>({
        operation: `Load table booking ${ref}`,
        error,
        data: data as BookingRow | null,
        allowMissing: true
      })

      if (!booking) {
        markFailure(failures, `Booking not found for reference ${ref}`)
        continue
      }
    } catch (error) {
      markFailure(failures, `Failed loading booking ${ref}`, error)
      continue
    }

    console.log(`Booking ID: ${booking.id}`)
    console.log(`Customer ID: ${booking.customer_id || '<missing>'}`)
    console.log(`Status: ${booking.status || 'unknown'}`)
    console.log(`Created: ${safeIso(booking.created_at)}`)

    console.log('\n📨 SMS jobs (type=send_sms):')
    try {
      const bookingFilter = `payload->booking_id.eq.${booking.id},payload->table_booking_id.eq.${booking.id}`
      const customerFilter = booking.customer_id
        ? `,payload->customer_id.eq.${booking.customer_id}`
        : ''

      const { data, error } = await supabase
        .from('jobs')
        .select('id, status, created_at, completed_at, payload, error_message')
        .eq('type', 'send_sms')
        .or(`${bookingFilter}${customerFilter}`)
        .order('created_at', { ascending: false })

      const jobs =
        (assertScriptQuerySucceeded({
          operation: `Load send_sms jobs for booking ${booking.id}`,
          error,
          data: (data ?? []) as JobRow[],
          allowMissing: true
        }) ?? []) as JobRow[]

      if (jobs.length === 0) {
        console.log('❌ No SMS jobs found for this booking')
      } else {
        console.log(`Found ${jobs.length} SMS job(s):`)
        for (const job of jobs.slice(0, 10)) {
          console.log(`- ${job.id} (${job.status || 'unknown'}) @ ${safeIso(job.created_at)}`)
          if (job.completed_at) {
            console.log(`  completed_at: ${job.completed_at}`)
          }
          const template = typeof job.payload?.template === 'string' ? job.payload.template : null
          if (template) {
            console.log(`  template: ${template}`)
          }
          if (job.error_message) {
            console.log(`  error_message: ${job.error_message}`)
          }
        }
      }
    } catch (error) {
      markFailure(failures, `Failed loading send_sms jobs for booking ${booking.id}`, error)
    }

    console.log('\n🗃️ Messages (outbound):')
    if (!booking.customer_id) {
      markFailure(failures, `Booking ${booking.id} is missing customer_id; cannot query messages`)
      continue
    }

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id, status, twilio_status, created_at, body, metadata')
        .eq('customer_id', booking.customer_id)
        .gte('created_at', booking.created_at || '1970-01-01T00:00:00.000Z')
        .order('created_at', { ascending: false })

      const messages =
        (assertScriptQuerySucceeded({
          operation: `Load outbound messages for customer ${booking.customer_id}`,
          error,
          data: (data ?? []) as MessageRow[],
          allowMissing: true
        }) ?? []) as MessageRow[]

      const relevant = messages.filter((msg) => isRelevantMessage({ bookingRef: ref, bookingId: booking.id, message: msg }))
      if (relevant.length === 0) {
        console.log('❌ No relevant messages found in database')
      } else {
        console.log(`Found ${relevant.length} relevant message(s):`)
        for (const msg of relevant.slice(0, 10)) {
          console.log(`- ${msg.id} (${msg.twilio_status || msg.status || 'unknown'}) @ ${safeIso(msg.created_at)}`)
          console.log(`  preview: "${safeSubstring(msg.body, 80)}"`)
        }
      }
    } catch (error) {
      markFailure(failures, `Failed loading messages for booking ${booking.id}`, error)
    }
  }

  console.log('\n📊 Job processor health check (jobs completed in last hour):')
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from('jobs')
      .select('type, status, completed_at')
      .eq('status', 'completed')
      .gte('completed_at', oneHourAgo)
      .order('completed_at', { ascending: false })
      .limit(10)

    const recentJobs =
      (assertScriptQuerySucceeded({
        operation: 'Load recently completed jobs',
        error,
        data: (data ?? []) as Array<{ type: string | null }>,
        allowMissing: true
      }) ?? []) as Array<{ type: string | null }>

    if (recentJobs.length === 0) {
      console.log('⚠️  No jobs completed in last hour - processor may be down')
    } else {
      console.log(`✅ ${recentJobs.length} job(s) completed in last hour`)
      const byType: Record<string, number> = {}
      for (const job of recentJobs) {
        const type = job.type || 'unknown'
        byType[type] = (byType[type] || 0) + 1
      }
      Object.entries(byType).forEach(([type, count]) => console.log(`  ${type}: ${count}`))
    }
  } catch (error) {
    markFailure(failures, 'Failed to load recently completed jobs', error)
  }

  if (failures.length > 0) {
    console.error(`\n❌ check-processed-sms completed with ${failures.length} failure(s).`)
  } else {
    console.log('\n✅ check-processed-sms completed without errors.')
  }
}

run().catch((error) => {
  console.error('❌ check-processed-sms script failed:', error)
  process.exitCode = 1
})

