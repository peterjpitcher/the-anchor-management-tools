#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'analyze-private-bookings-customers'
const SAMPLE_LIMIT = 5
const DUPLICATE_PHONE_SAMPLE_LIMIT = 1000

type BookingSampleRow = {
  id: string
  customer_first_name: string | null
  customer_last_name: string | null
  contact_email: string | null
  contact_phone: string | null
  event_date: string | null
}

function assertReadOnly(argv: string[]): void {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] read-only script does not support --confirm`)
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) {
    return '***'
  }
  return `***${digits.slice(-4)}`
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) {
    return '***'
  }
  const first = (local || '*').slice(0, 1)
  return `${first}***@${domain}`
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  assertReadOnly(process.argv)

  const supabase = createAdminClient()

  console.log('Analyzing private bookings customer linkage...\n')

  const { count: standaloneCount, error: standaloneError } = await (supabase.from('private_bookings') as any)
    .select('id', { count: 'exact', head: true })
    .is('customer_id', null)

  if (standaloneError) {
    throw new Error(
      `[${SCRIPT_NAME}] Failed to count private bookings without customer_id: ${standaloneError.message || 'unknown error'}`
    )
  }
  if (typeof standaloneCount !== 'number') {
    throw new Error(`[${SCRIPT_NAME}] Standalone bookings count unavailable`)
  }

  const { count: totalCount, error: totalError } = await (supabase.from('private_bookings') as any)
    .select('id', { count: 'exact', head: true })

  if (totalError) {
    throw new Error(
      `[${SCRIPT_NAME}] Failed to count private bookings: ${totalError.message || 'unknown error'}`
    )
  }
  if (typeof totalCount !== 'number') {
    throw new Error(`[${SCRIPT_NAME}] Total bookings count unavailable`)
  }

  if (totalCount === 0) {
    console.log('No private bookings found.')
    return
  }

  const percent = Math.round((standaloneCount / totalCount) * 100)
  console.log('Private bookings analysis:')
  console.log(`- Total bookings: ${totalCount}`)
  console.log(`- Without customer link: ${standaloneCount} (${percent}%)`)
  console.log(`\nPotential lost customers (unlinked): ${standaloneCount}`)

  const { data: samplesData, error: samplesError } = await (supabase.from('private_bookings') as any)
    .select('id, customer_first_name, customer_last_name, contact_email, contact_phone, event_date')
    .is('customer_id', null)
    .order('event_date', { ascending: false })
    .limit(SAMPLE_LIMIT)

  const samples =
    (assertScriptQuerySucceeded({
      operation: 'Load private booking samples',
      error: samplesError,
      data: samplesData as BookingSampleRow[] | null,
      allowMissing: true,
    }) ?? []) as BookingSampleRow[]

  if (samples.length > 0) {
    console.log('\nRecent bookings without customer records:')
    samples.forEach((booking, i) => {
      const name = [booking.customer_first_name, booking.customer_last_name].filter(Boolean).join(' ')
      const phone = booking.contact_phone ? maskPhone(booking.contact_phone) : 'Not provided'
      const email = booking.contact_email ? maskEmail(booking.contact_email) : 'Not provided'
      const eventDate = booking.event_date ? new Date(booking.event_date).toLocaleDateString('en-GB') : 'Unknown'

      console.log(`- ${i + 1}. ${name || '(missing name)'}`)
      console.log(`  Phone: ${phone}`)
      console.log(`  Email: ${email}`)
      console.log(`  Event: ${eventDate}`)
    })
  }

  console.log('\nChecking for missed customer linking opportunities (phone matches)...')

  const { data: phonesData, error: phonesError } = await (supabase.from('private_bookings') as any)
    .select('contact_phone')
    .is('customer_id', null)
    .not('contact_phone', 'is', null)
    .limit(DUPLICATE_PHONE_SAMPLE_LIMIT)

  const phoneRows =
    (assertScriptQuerySucceeded({
      operation: 'Load unlinked private booking phone numbers',
      error: phonesError,
      data: phonesData as Array<{ contact_phone: string | null }> | null,
      allowMissing: true,
    }) ?? []) as Array<{ contact_phone: string | null }>

  const phones = Array.from(
    new Set(
      phoneRows
        .map((row) => row.contact_phone)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    )
  )

  if (phones.length === 0) {
    console.log('No unlinked bookings with phone numbers found.')
    return
  }

  const { data: existingCustomersData, error: existingCustomersError } = await (supabase.from('customers') as any)
    .select('mobile_number')
    .in('mobile_number', phones)

  const existingCustomers =
    (assertScriptQuerySucceeded({
      operation: 'Load matching customers by phone',
      error: existingCustomersError,
      data: existingCustomersData as Array<{ mobile_number: string | null }> | null,
      allowMissing: true,
    }) ?? []) as Array<{ mobile_number: string | null }>

  const matchCount = existingCustomers.length
  if (matchCount === 0) {
    console.log('No matching customers found for sampled booking phone numbers.')
    return
  }

  console.log(
    `Found ${matchCount} phone number(s) that already exist in customers (sample cap ${DUPLICATE_PHONE_SAMPLE_LIMIT}).`
  )
  console.log('These are missed linking opportunities.')
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
