#!/usr/bin/env tsx
/**
 * SMS System Diagnostic Tool (Read-Only)
 *
 * Safety note:
 * - This script MUST NOT send SMS or mutate queue state. It is intentionally read-only.
 * - To process queue jobs, use the hardened `scripts/process-jobs.ts` script.
 * - To send a gated test SMS, use `scripts/testing/test-sms-new-customer.ts`.
 */

import { config } from 'dotenv'
import path from 'path'
import twilio from 'twilio'
import { createAdminClient } from '@/lib/supabase/admin'

config({ path: path.resolve(process.cwd(), '.env.local') })

function maskPhone(phone: unknown): string {
  if (typeof phone !== 'string' || phone.length === 0) return '(missing)'
  const trimmed = phone.trim()
  if (trimmed.length <= 6) return '***'
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-4)}`
}

async function runDiagnostics() {
  if (process.argv.includes('--confirm')) {
    throw new Error('test-and-fix-sms is read-only and does not support --confirm.')
  }

  console.log('🔍 SMS System Diagnostic Tool (read-only)\n')

  let hadErrors = false

  // 1. Check environment variables
  console.log('1️⃣ Checking environment variables...')
  const requiredEnvVars = {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
    TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID,
    NEXT_PUBLIC_CONTACT_PHONE_NUMBER: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER,
  } as const

  for (const [key, value] of Object.entries(requiredEnvVars)) {
    if (!value) {
      console.log(`❌ ${key} is missing`)
      hadErrors = true
      continue
    }

    const redacted =
      key.includes('TOKEN') || key.includes('SECRET')
        ? '***'
        : key.includes('PHONE_NUMBER')
          ? maskPhone(value)
          : value
    console.log(`✅ ${key} is set (${redacted})`)
  }

  if (hadErrors) {
    console.error('\n⚠️ Missing environment variables. Set them in `.env.local` and retry.')
    process.exitCode = 1
    return
  }

  const supabase = createAdminClient()

  // 2. Check for pending SMS jobs
  console.log('\n2️⃣ Checking pending send_sms jobs...')
  const { data: pendingJobs, error: jobError } = await supabase
    .from('jobs')
    .select('id, created_at, scheduled_for, attempts, max_attempts, payload')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10)

  if (jobError) {
    console.error('❌ Error fetching pending send_sms jobs:', jobError)
    hadErrors = true
  } else {
    console.log(`Found ${pendingJobs?.length || 0} pending send_sms jobs (showing up to 10).`)
    if (pendingJobs && pendingJobs.length > 0) {
      pendingJobs.forEach((job, index) => {
        const payload =
          typeof job.payload === 'object' && job.payload !== null
            ? (job.payload as Record<string, unknown>)
            : {}
        const to = payload.to ?? payload.phone ?? payload.phoneNumber
        console.log(`${index + 1}. Job ID: ${job.id}`)
        console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`)
        console.log(`   Scheduled: ${job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : '(missing)'}`)
        console.log(`   Attempts: ${job.attempts}/${job.max_attempts}`)
        console.log(`   To: ${maskPhone(to)}`)
      })
    }
  }

  // 3. Check SMS templates
  console.log('\n3️⃣ Checking active SMS templates...')
  const { data: templates, error: templateError } = await supabase
    .from('table_booking_sms_templates')
    .select('template_key, booking_type, is_active')
    .eq('is_active', true)

  if (templateError) {
    console.error('❌ Error fetching templates:', templateError)
    hadErrors = true
  } else {
    console.log(`✅ Found ${templates?.length || 0} active SMS templates`)
    templates?.forEach((t) => {
      console.log(`   - ${t.template_key} (${t.booking_type || 'all'})`)
    })
  }

  // 4. Check recent table bookings
  console.log('\n4️⃣ Checking recent table bookings...')
  const { data: recentBookings, error: bookingError } = await supabase
    .from('table_bookings')
    .select('booking_reference, customer_name, status, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  if (bookingError) {
    console.error('❌ Error fetching recent bookings:', bookingError)
    hadErrors = true
  } else {
    console.log('Recent bookings:')
    recentBookings?.forEach((b, i) => {
      console.log(
        `${i + 1}. ${b.booking_reference} - ${b.customer_name} (${b.status}) - ${new Date(b.created_at).toLocaleString()}`
      )
    })
  }

  // 5. Test Twilio connection (read-only)
  console.log('\n5️⃣ Testing Twilio connection...')
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID!).fetch()
    console.log(`✅ Twilio account active: ${account.friendlyName}`)
    console.log(`   Status: ${account.status}`)
  } catch (error: any) {
    console.error('❌ Twilio connection failed:', error?.message || String(error))
    hadErrors = true
  }

  // 6. Check job history
  console.log('\n6️⃣ Checking send_sms job history...')
  const { data: recentJobs, error: recentJobsError } = await supabase
    .from('jobs')
    .select('id, status, updated_at')
    .eq('type', 'send_sms')
    .order('updated_at', { ascending: false })
    .limit(20)

  if (recentJobsError) {
    console.error('❌ Error fetching send_sms job history:', recentJobsError)
    hadErrors = true
  } else {
    const statusCounts = (recentJobs || []).reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    console.log('Recent job statuses (last 20):')
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`)
    })
  }

  console.log('\n📌 Next steps (safe):')
  console.log('1. To process pending jobs, use the hardened queue processor:')
  console.log('   tsx scripts/process-jobs.ts')
  console.log('2. To send a gated test SMS, use:')
  console.log('   tsx scripts/testing/test-sms-new-customer.ts --confirm +447123456789 (plus required env guards)')

  if (hadErrors) {
    console.error('\n❌ Diagnostic completed with errors.')
    process.exitCode = 1
    return
  }

  console.log('\n✅ Diagnostic completed successfully.')
}

runDiagnostics().catch((error) => {
  console.error('\n❌ Fatal error:', error)
  process.exitCode = 1
})
