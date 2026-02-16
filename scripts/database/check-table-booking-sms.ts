#!/usr/bin/env tsx

import { config } from 'dotenv'
import path from 'path'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'

config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'check-table-booking-sms'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ${message}`)
}

async function checkTableBookingSMS() {
  if (process.argv.includes('--confirm')) {
    throw new Error('check-table-booking-sms is read-only and does not support --confirm.')
  }

  console.log('=== Checking Table Booking SMS Flow ===\n')

  const supabase = createAdminClient()

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const sevenDaysAgoIso = sevenDaysAgo.toISOString()

  // 1. Check active SMS templates
  console.log('1. Checking Active SMS Templates:')
  const { data: templates, error: templateError } = await supabase
    .from('table_booking_sms_templates')
    .select('template_key, booking_type, is_active, variables, template_text')
    .eq('is_active', true)
    .order('template_key', { ascending: true })

  const activeTemplates = (assertScriptQuerySucceeded({
    operation: 'Load active table booking SMS templates',
    error: templateError,
    data: templates ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    template_key: string
    booking_type: string | null
    variables: string[] | null
    template_text: string | null
  }>

  console.log(`Found ${activeTemplates.length} active templates:`)
  activeTemplates.forEach((template) => {
    console.log(`  - ${template.template_key} (${template.booking_type || 'all types'})`)
    console.log(`    Variables: ${template.variables?.join(', ') || 'none'}`)
    console.log(`    Template: ${String(template.template_text || '').substring(0, 100)}...`)
  })

  // 2. Check recent table booking SMS jobs
  console.log('\n2. Recent Table Booking SMS Jobs (last 7 days):')
  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id, status, created_at, scheduled_for, payload, error_message')
    .eq('type', 'send_sms')
    .gte('created_at', sevenDaysAgoIso)
    .like('payload', '%table_booking_confirmation%')
    .order('created_at', { ascending: false })
    .limit(10)

  const recentJobs = (assertScriptQuerySucceeded({
    operation: 'Load recent table booking send_sms jobs',
    error: jobsError,
    data: jobs ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    id: string
    status: string
    created_at: string
    scheduled_for: string | null
    payload: unknown
    error_message: string | null
  }>

  console.log(`Found ${recentJobs.length} table booking SMS jobs:`)
  recentJobs.forEach((job) => {
    console.log(`\n  Job ID: ${job.id}`)
    console.log(`  Status: ${job.status}`)
    console.log(`  Created: ${job.created_at}`)
    if (job.scheduled_for) {
      console.log(`  Scheduled for: ${job.scheduled_for}`)
    }
    console.log(`  Payload: ${JSON.stringify(job.payload, null, 2)}`)
    if (job.error_message) {
      console.log(`  Error: ${job.error_message}`)
    }
  })

  // 3. Check recent table bookings
  console.log('\n3. Recent Table Bookings (last 7 days):')
  const { data: bookings, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(
      `
      id,
      booking_reference,
      booking_type,
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
    .gte('created_at', sevenDaysAgoIso)
    .order('created_at', { ascending: false })
    .limit(10)

  const recentBookings = (assertScriptQuerySucceeded({
    operation: 'Load recent table bookings for SMS diagnostics',
    error: bookingsError,
    data: bookings ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    booking_reference: string | null
    booking_type: string | null
    status: string | null
    created_at: string | null
    customer: {
      first_name?: string | null
      last_name?: string | null
      mobile_number?: string | null
      sms_opt_in?: boolean | null
    } | null
  }>

  console.log(`Found ${recentBookings.length} recent bookings:`)
  recentBookings.forEach((booking) => {
    console.log(`\n  Booking: ${booking.booking_reference || 'unknown'}`)
    console.log(`  Type: ${booking.booking_type || 'unknown'}, Status: ${booking.status || 'unknown'}`)
    console.log(`  Customer: ${booking.customer?.first_name || ''} ${booking.customer?.last_name || ''}`.trim())
    console.log(`  Phone: ${booking.customer?.mobile_number || 'unknown'}, Opt-in: ${booking.customer?.sms_opt_in}`)
    console.log(`  Created: ${booking.created_at || 'unknown'}`)
  })

  // 4. Check for required template presence (read-only, no auto-create)
  console.log('\n4. Checking for required template:')
  const requiredTemplate = 'table_booking_confirmation'
  const { data: requiredTemplateRow, error: requiredTemplateError } = await supabase
    .from('table_booking_sms_templates')
    .select('template_key, is_active')
    .eq('template_key', requiredTemplate)
    .maybeSingle()

  const requiredTemplateData = assertScriptQuerySucceeded({
    operation: 'Check required table booking template',
    error: requiredTemplateError,
    data: requiredTemplateRow ?? null,
    allowMissing: true,
  }) as { template_key: string; is_active: boolean } | null

  if (!requiredTemplateData) {
    markFailure(`Missing required template: '${requiredTemplate}'.`)
    console.log('This script is strictly read-only and will not create templates automatically.')
    console.log('Use the dedicated remediation script instead (see scripts/fixes/ and scripts/sms-tools/).')
  } else {
    console.log(
      `Template '${requiredTemplate}' exists and is ${requiredTemplateData.is_active ? 'active' : 'inactive'}`
    )
  }

  // 5. Check messages table for recent table booking SMS messages
  console.log('\n5. Recent SMS Messages (last 7 days):')
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('id, to_number, status, twilio_status, body, created_at')
    .eq('direction', 'outbound')
    .gte('created_at', sevenDaysAgoIso)
    .like('body', '%table booking%')
    .order('created_at', { ascending: false })
    .limit(5)

  const recentMessages = (assertScriptQuerySucceeded({
    operation: 'Load recent outbound table booking SMS messages',
    error: messagesError,
    data: messages ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    id: string
    to_number: string | null
    status: string | null
    twilio_status: string | null
    body: string | null
    created_at: string | null
  }>

  console.log(`Found ${recentMessages.length} table booking SMS messages:`)
  recentMessages.forEach((msg) => {
    console.log(`\n  Message ID: ${msg.id}`)
    console.log(`  To: ${msg.to_number || 'unknown'}`)
    console.log(`  Status: ${msg.twilio_status || msg.status || 'unknown'}`)
    console.log(`  Body: ${String(msg.body || '').substring(0, 100)}...`)
    console.log(`  Created: ${msg.created_at || 'unknown'}`)
  })

  // 6. Check job queue status for SMS tasks
  console.log('\n6. Job Queue Status:')
  const { count: pendingCount, error: pendingCountError } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .eq('type', 'send_sms')

  const pendingSmsJobs = assertScriptQuerySucceeded({
    operation: 'Load pending send_sms job count',
    error: pendingCountError,
    data: pendingCount ?? 0,
    allowMissing: true,
  }) as number

  console.log(`Pending SMS jobs: ${pendingSmsJobs || 0}`)
  if (pendingSmsJobs > 0) {
    console.log("\nThere are pending SMS jobs that haven't been processed.")
    console.log('This suggests the job processor might not be running.')
  }
}

void checkTableBookingSMS().catch((error) => {
  markFailure('check-table-booking-sms failed.', error)
})
