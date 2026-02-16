#!/usr/bin/env tsx

import path from 'path'
import dotenv from 'dotenv'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  sms_opt_in: boolean | null
  sms_status: string | null
}

type ProgramRow = { id: string }

type LoyaltyMemberRow = {
  id: string
  status: string | null
  tier_id: string | null
  join_date: string | null
}

type WelcomeSeriesRow = { id: string | null }

type RecentJobRow = {
  id: string
  status: string | null
  created_at: string | null
  scheduled_for: string | null
  payload: unknown
  error: string | null
}

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=')[1] ?? null
  }

  const idx = argv.findIndex((arg) => arg === flag)
  if (idx !== -1) {
    return argv[idx + 1] ?? null
  }

  return null
}

function readCustomerId(argv: string[] = process.argv): string | null {
  return (
    readOptionalFlagValue(argv, '--customer-id') ??
    process.env.TEST_LOYALTY_ENROLLMENT_CUSTOMER_ID ??
    null
  )
}

function assertCustomerId(customerId: string | null): string {
  const id = customerId?.trim() || ''
  if (!id) {
    throw new Error(
      'test-loyalty-enrollment blocked: --customer-id (or TEST_LOYALTY_ENROLLMENT_CUSTOMER_ID) is required.'
    )
  }
  return id
}

async function main() {
  const argv = process.argv.slice(2)
  const customerId = assertCustomerId(readCustomerId(process.argv))

  if (argv.includes('--confirm')) {
    throw new Error(
      'test-loyalty-enrollment is read-only. It no longer creates/deletes customers or loyalty members.'
    )
  }

  const supabase = createAdminClient()

  console.log('🔍 Loyalty enrollment SMS diagnostics (read-only)')
  console.log('Customer:', customerId)

  const { data: customerData, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number, sms_opt_in, sms_status')
    .eq('id', customerId)
    .maybeSingle()

  const customer = assertScriptQuerySucceeded({
    operation: `Lookup customer ${customerId}`,
    error: customerError,
    data: customerData as CustomerRow | null,
    allowMissing: true,
  }) as CustomerRow | null

  if (!customer) {
    throw new Error('Customer not found.')
  }

  console.log(`Name: ${[customer.first_name, customer.last_name].filter(Boolean).join(' ') || '(unknown)'}`)
  console.log(`Mobile: ${customer.mobile_number || '(missing)'}`)
  console.log(`SMS opt-in: ${customer.sms_opt_in ? 'Yes' : 'No'}`)
  console.log(`SMS status: ${customer.sms_status || 'N/A'}`)

  const { data: programData, error: programError } = await supabase
    .from('loyalty_programs')
    .select('id')
    .eq('active', true)
    .maybeSingle()

  const program = assertScriptQuerySucceeded({
    operation: 'Lookup active loyalty program',
    error: programError,
    data: programData as ProgramRow | null,
    allowMissing: true,
  }) as ProgramRow | null

  if (!program) {
    console.log('No active loyalty program found.')
    return
  }

  console.log('Active program:', program.id)

  const { data: membersData, error: membersError } = await supabase
    .from('loyalty_members')
    .select('*')
    .eq('customer_id', customer.id)
    .eq('program_id', program.id)
    .order('created_at', { ascending: false })
    .limit(5)

  const members =
    (assertScriptQuerySucceeded({
      operation: 'Lookup loyalty members',
      error: membersError,
      data: membersData as LoyaltyMemberRow[] | null,
      allowMissing: true,
    }) ?? []) as LoyaltyMemberRow[]

  if (!members || members.length === 0) {
    console.log('No loyalty membership found for this customer/program.')
  } else {
    console.log(`Found ${members.length} loyalty member(s) (showing up to 5):`)
    for (const member of members) {
      console.log(`- Member: ${member.id}`)
      if (member.status) console.log(`  Status: ${member.status}`)
      if (member.tier_id) console.log(`  Tier: ${member.tier_id}`)
      if (member.join_date) console.log(`  Join date: ${member.join_date}`)

      const { data: welcomeSeriesData, error: welcomeError } = await supabase
        .from('loyalty_welcome_series')
        .select('*')
        .eq('member_id', member.id)
        .maybeSingle()

      const welcomeSeries = assertScriptQuerySucceeded({
        operation: `Lookup loyalty_welcome_series for member ${member.id}`,
        error: welcomeError,
        data: welcomeSeriesData as WelcomeSeriesRow | null,
        allowMissing: true,
      }) as WelcomeSeriesRow | null

      if (!welcomeSeries) {
        console.log('  Welcome series: (none found)')
      } else {
        console.log(`  Welcome series: ${welcomeSeries.id || '(unknown id)'}`)
      }
    }
  }

  const { data: recentJobsData, error: jobsError } = await supabase
    .from('jobs')
    .select('id, status, created_at, scheduled_for, payload, error')
    .eq('type', 'send_sms')
    .order('created_at', { ascending: false })
    .limit(50)

  const recentJobs =
    (assertScriptQuerySucceeded({
      operation: 'Lookup recent send_sms jobs',
      error: jobsError,
      data: recentJobsData as RecentJobRow[] | null,
      allowMissing: true,
    }) ?? []) as RecentJobRow[]

  const scanned = recentJobs.length
  const customerJobs = recentJobs.filter((job: RecentJobRow) => {
    const payloadText = typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload ?? {})
    return payloadText.includes(customer.id)
  })

  console.log(
    `Recent send_sms jobs referencing this customer: ${customerJobs.length} (scanned last ${scanned})`
  )

  for (const job of customerJobs.slice(0, 10)) {
    console.log(`- Job: ${job.id}`)
    console.log(`  Status: ${job.status}`)
    console.log(`  Created: ${job.created_at}`)
    console.log(`  Scheduled: ${job.scheduled_for || 'N/A'}`)
    if (job.error) console.log(`  Error: ${job.error}`)
  }

  if (customerJobs.length > 10) {
    console.log(`(showing first 10; ${customerJobs.length - 10} more omitted)`)
  }

  console.log('✅ Diagnostics complete (read-only).')
}

main().catch((error) => {
  console.error('❌ test-loyalty-enrollment failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
