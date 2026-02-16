#!/usr/bin/env tsx

/**
 * check-enrollment-sms (read-only diagnostic)
 *
 * Inspect recent loyalty enrollments and related SMS/job state.
 *
 * Usage:
 *   tsx scripts/database/check-enrollment-sms.ts [--hours 24]
 *
 * Safety:
 * - Strictly read-only (blocks --confirm).
 * - Fails closed by setting process.exitCode=1 when any check cannot be performed.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

type LoyaltyMemberRow = {
  id: string
  created_at: string | null
  customer_id: string | null
}

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  mobile_e164: string | null
}

type CustomerMessagingHealthRow = {
  sms_suspended: boolean | null
  total_sms_sent: number | null
  failed_sms_count: number | null
}

type JobRow = {
  id: string
  status: string | null
  created_at: string | null
  payload: unknown
  error_message: string | null
}

type LoyaltyNotificationRow = {
  notification_type: string | null
  channel: string | null
  created_at: string | null
  content: string | null
}

type LoyaltyProgramRow = {
  id: string
  active: boolean | null
  settings: Record<string, unknown> | null
}

function parseOptionalPositiveInt(raw: string | null | undefined): number | null {
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readArgValue(argv: string[], flag: string): string | null {
  const idx = argv.findIndex((arg) => arg === flag)
  if (idx !== -1) {
    const value = argv[idx + 1]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    const [, value] = eq.split('=', 2)
    return value && value.trim().length > 0 ? value.trim() : null
  }

  return null
}

function readHours(argv: string[]): number | null {
  return parseOptionalPositiveInt(readArgValue(argv, '--hours') ?? process.env.CHECK_ENROLLMENT_SMS_HOURS)
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

function formatCustomerName(customer: CustomerRow | null): string {
  if (!customer) return 'Unknown'
  const first = (customer.first_name || '').trim()
  const last = (customer.last_name || '').trim()
  const joined = `${first} ${last}`.trim()
  return joined.length > 0 ? joined : 'Unknown'
}

function safeIso(value: string | null | undefined): string {
  return typeof value === 'string' && value.length > 0 ? value : '<unknown>'
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) {
    console.log(`
check-enrollment-sms (read-only diagnostic)

Usage:
  tsx scripts/database/check-enrollment-sms.ts [--hours 24]

Notes:
  - Strictly read-only (blocks --confirm).
  - Sets exit code 1 when any diagnostic query errors.
`)
    return
  }

  if (argv.includes('--confirm')) {
    throw new Error('check-enrollment-sms is strictly read-only; remove --confirm.')
  }

  const hours = readHours(argv) ?? 24
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()
  const failures: string[] = []

  console.log('🔍 check-enrollment-sms (read-only)\n')
  console.log(`Window: last ${hours} hour(s) (since ${sinceIso})\n`)

  let recentMembers: LoyaltyMemberRow[] = []
  try {
    const { data, error } = await supabase
      .from('loyalty_members')
      .select('id, created_at, customer_id')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })

    recentMembers =
      (assertScriptQuerySucceeded({
        operation: 'Load recent loyalty members',
        error,
        data: (data ?? []) as LoyaltyMemberRow[],
        allowMissing: true
      }) ?? []) as LoyaltyMemberRow[]

    console.log(`📊 Recent loyalty enrollments: ${recentMembers.length}\n`)
    for (const member of recentMembers) {
      console.log(`Member ID: ${member.id}`)
      console.log(`Enrolled: ${safeIso(member.created_at)}`)
      console.log(`Customer ID: ${member.customer_id || '<missing>'}`)

      if (!member.customer_id) {
        markFailure(failures, `Member ${member.id} is missing customer_id`)
        console.log('---')
        continue
      }

      try {
        const { data: customerData, error: customerError } = await supabase
          .from('customers')
          .select('id, first_name, last_name, mobile_number, mobile_e164')
          .eq('id', member.customer_id)
          .maybeSingle()

        const customer = assertScriptQuerySucceeded<CustomerRow | null>({
          operation: `Load customer ${member.customer_id} for loyalty member ${member.id}`,
          error: customerError,
          data: customerData as CustomerRow | null,
          allowMissing: true
        })

        console.log(`Customer: ${formatCustomerName(customer)}`)
        console.log(`Phone: ${customer?.mobile_e164 || customer?.mobile_number || '<missing>'}`)
      } catch (error) {
        markFailure(
          failures,
          `Failed loading customer details for loyalty member ${member.id}`,
          error
        )
      }

      console.log('---')
    }
  } catch (error) {
    markFailure(failures, 'Failed to load recent loyalty members', error)
  }

  console.log('\n📱 Recent send_sms jobs:')
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, status, created_at, payload, error_message')
      .eq('type', 'send_sms')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(10)

    const smsJobs =
      (assertScriptQuerySucceeded({
        operation: 'Load recent send_sms jobs',
        error,
        data: (data ?? []) as JobRow[],
        allowMissing: true
      }) ?? []) as JobRow[]

    console.log(`Found ${smsJobs.length} send_sms job(s) in the last ${hours} hour(s).`)
    for (const job of smsJobs) {
      console.log(`- ${job.id} (${job.status || 'unknown'}) @ ${safeIso(job.created_at)}`)
      if (job.error_message) {
        console.log(`  error_message: ${job.error_message}`)
      }
    }
  } catch (error) {
    markFailure(failures, 'Failed to load recent send_sms jobs', error)
  }

  console.log('\n📋 Recent loyalty notifications:')
  try {
    const { data, error } = await supabase
      .from('loyalty_notifications')
      .select('notification_type, channel, created_at, content')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(10)

    const notifications =
      (assertScriptQuerySucceeded({
        operation: 'Load recent loyalty notifications',
        error,
        data: (data ?? []) as LoyaltyNotificationRow[],
        allowMissing: true
      }) ?? []) as LoyaltyNotificationRow[]

    console.log(`Found ${notifications.length} notification(s).`)
    for (const notif of notifications) {
      console.log(
        `- ${notif.notification_type || 'unknown'} (${notif.channel || 'unknown'}) @ ${safeIso(notif.created_at)}`
      )
    }
  } catch (error) {
    markFailure(
      failures,
      'Failed to load loyalty_notifications (table may be missing in this environment)',
      error
    )
  }

  if (recentMembers.length > 0) {
    console.log('\n🏥 Customer messaging health (enrolled customers):')
    for (const member of recentMembers) {
      if (!member.customer_id) continue

      try {
        const { data, error } = await supabase
          .from('customer_messaging_health')
          .select('sms_suspended, total_sms_sent, failed_sms_count')
          .eq('customer_id', member.customer_id)
          .maybeSingle()

        const health = assertScriptQuerySucceeded<CustomerMessagingHealthRow | null>({
          operation: `Load customer_messaging_health for customer ${member.customer_id}`,
          error,
          data: data as CustomerMessagingHealthRow | null,
          allowMissing: true
        })

        if (!health) {
          console.log(`- ${member.customer_id}: <no record>`)
          continue
        }

        console.log(
          `- ${member.customer_id}: suspended=${health.sms_suspended === true} sent=${health.total_sms_sent || 0} failed=${health.failed_sms_count || 0}`
        )
      } catch (error) {
        markFailure(failures, `Failed to load messaging health for customer ${member.customer_id}`, error)
      }
    }
  }

  console.log('\n⚙️ Loyalty program status:')
  try {
    const { data, error } = await supabase
      .from('loyalty_programs')
      .select('id, active, settings')
      .eq('active', true)
      .maybeSingle()

    const program = assertScriptQuerySucceeded<LoyaltyProgramRow | null>({
      operation: 'Load active loyalty program',
      error,
      data: data as LoyaltyProgramRow | null,
      allowMissing: true
    })

    if (!program) {
      markFailure(failures, 'No active loyalty program found')
    } else {
      const welcomeBonus = program.settings?.welcome_bonus
      console.log(`✅ Active loyalty program found (${program.id})`)
      console.log(`Welcome bonus: ${typeof welcomeBonus === 'number' ? welcomeBonus : '<unset>'}`)
    }
  } catch (error) {
    markFailure(failures, 'Failed to load active loyalty program', error)
  }

  if (failures.length > 0) {
    console.error(`\n❌ check-enrollment-sms completed with ${failures.length} failure(s).`)
  } else {
    console.log('\n✅ check-enrollment-sms completed without errors.')
  }
}

run().catch((error) => {
  console.error('❌ check-enrollment-sms script failed:', error)
  process.exitCode = 1
})

