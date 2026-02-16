#!/usr/bin/env tsx

/**
 * Script to analyze duplicate customers in detail (read-only).
 *
 * Run:
 *   scripts/analysis/analyze-duplicates-detailed.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'analyze-duplicates-detailed'

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  sms_opt_in: boolean | null
  created_at: string
  messaging_status: string | null
  sms_delivery_failures: number | null
  last_successful_sms_at: string | null
  table_booking_count: number | null
  no_show_count: number | null
  bookings?: Array<{ count: number }> | null
}

function assertReadOnly(argv: string[]): void {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] read-only script does not support --confirm`)
  }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  assertReadOnly(process.argv)

  const supabase = createAdminClient()

  console.log('Analyzing duplicate customers in detail...\n')

  const { data, error } = await (supabase.from('customers') as any)
    .select(`
        id,
        first_name,
        last_name,
        mobile_number,
        sms_opt_in,
        created_at,
        messaging_status,
        sms_delivery_failures,
        last_successful_sms_at,
        table_booking_count,
        no_show_count,
        bookings (count)
      `)
    .order('created_at')

  const allCustomers =
    (assertScriptQuerySucceeded({
      operation: 'Load customers',
      error,
      data: data as CustomerRow[] | null,
      allowMissing: true,
    }) ?? []) as CustomerRow[]

  const phoneMap = new Map<string, CustomerRow[]>()
  for (const customer of allCustomers) {
    const phone = customer.mobile_number
    if (!phone) continue
    const list = phoneMap.get(phone) ?? []
    list.push(customer)
    phoneMap.set(phone, list)
  }

  const duplicates = Array.from(phoneMap.entries())
    .filter(([, customers]) => customers.length > 1)
    .map(([phone, customers]) => ({ phone, customers }))

  if (duplicates.length === 0) {
    console.log('No duplicate phone numbers found')
    return
  }

  console.log(`Found ${duplicates.length} phone numbers with multiple customer records\n`)
  console.log('='.repeat(80))

  let duplicateNumber = 1
  for (const { phone, customers } of duplicates) {
    console.log(`\nDUPLICATE SET #${duplicateNumber}: Phone ${phone}`)
    console.log('-'.repeat(80))

    customers.forEach((customer, index) => {
      const bookingCount = customer.bookings?.[0]?.count ?? 0
      console.log(`\n  Entry ${index + 1}:`)
      console.log(`    ID: ${customer.id}`)
      console.log(
        `    Name: "${customer.first_name ?? ''}" "${customer.last_name ? customer.last_name : '(no last name)'}"`
      )
      console.log(`    SMS Opt-in: ${customer.sms_opt_in ? 'Yes' : 'No'}`)
      console.log(`    Messaging Status: ${customer.messaging_status || 'active'}`)
      console.log(`    SMS Delivery Failures: ${customer.sms_delivery_failures || 0}`)
      console.log(`    Total Event Bookings: ${bookingCount}`)
      console.log(`    Table Booking Count: ${customer.table_booking_count || 0}`)
      console.log(`    No Show Count: ${customer.no_show_count || 0}`)
      console.log(
        `    Last Successful SMS: ${
          customer.last_successful_sms_at
            ? new Date(customer.last_successful_sms_at).toLocaleDateString('en-GB')
            : 'Never'
        }`
      )
      const createdAt = new Date(customer.created_at)
      console.log(
        `    Created: ${createdAt.toLocaleDateString('en-GB')} at ${createdAt.toLocaleTimeString('en-GB')}`
      )
    })

    console.log('\n  Recommendation:')

    const hasBookings = customers.filter((c) => (c.bookings?.[0]?.count ?? 0) > 0)
    const hasTableBookings = customers.filter((c) => (c.table_booking_count ?? 0) > 0)
    const hasFullName = customers.filter((c) => !!c.last_name && c.last_name !== '.')
    const hasSuccessfulSMS = customers.filter((c) => !!c.last_successful_sms_at)

    if (hasBookings.length === 1) {
      const keep = hasBookings[0]
      const keepIdx = customers.indexOf(keep) + 1
      console.log(`    -> Keep Entry ${keepIdx} (has ${keep.bookings?.[0]?.count ?? 0} event bookings)`)
    } else if (hasBookings.length > 1) {
      const mostBookings = hasBookings.reduce((prev, current) =>
        (current.bookings?.[0]?.count ?? 0) > (prev.bookings?.[0]?.count ?? 0) ? current : prev
      )
      const keepIdx = customers.indexOf(mostBookings) + 1
      console.log(
        `    -> Keep Entry ${keepIdx} (has most event bookings: ${mostBookings.bookings?.[0]?.count ?? 0})`
      )
    } else if (hasTableBookings.length === 1) {
      const keep = hasTableBookings[0]
      const keepIdx = customers.indexOf(keep) + 1
      console.log(`    -> Keep Entry ${keepIdx} (has ${keep.table_booking_count ?? 0} table bookings)`)
    } else if (hasTableBookings.length > 1) {
      const mostTableBookings = hasTableBookings.reduce((prev, current) =>
        (current.table_booking_count ?? 0) > (prev.table_booking_count ?? 0) ? current : prev
      )
      const keepIdx = customers.indexOf(mostTableBookings) + 1
      console.log(
        `    -> Keep Entry ${keepIdx} (has most table bookings: ${mostTableBookings.table_booking_count ?? 0})`
      )
    } else if (hasSuccessfulSMS.length === 1) {
      const keep = hasSuccessfulSMS[0]
      const keepIdx = customers.indexOf(keep) + 1
      console.log(`    -> Keep Entry ${keepIdx} (has SMS history)`)
    } else if (hasFullName.length === 1) {
      const keep = hasFullName[0]
      const keepIdx = customers.indexOf(keep) + 1
      console.log(`    -> Keep Entry ${keepIdx} (has complete name)`)
    } else {
      console.log('    -> Keep Entry 1 (oldest entry)')
    }

    duplicateNumber += 1
  }

  console.log('\n' + '='.repeat(80))
  console.log('\nSUMMARY')
  console.log(`Total duplicate sets: ${duplicates.length}`)
  console.log(`Total duplicate records: ${duplicates.reduce((acc, d) => acc + d.customers.length - 1, 0)}`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
