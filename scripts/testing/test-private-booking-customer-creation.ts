#!/usr/bin/env tsx

import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  created_at: string | null
}

type PrivateBookingRow = {
  id: string
  customer_id: string | null
  customer_name: string | null
  contact_phone: string | null
  status: string | null
  created_at: string | null
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

async function testPrivateBookingCustomerCreation(): Promise<void> {
  const argv = process.argv.slice(2)

  if (argv.includes('--confirm') || argv.includes('--keep')) {
    throw new Error(
      'test-private-booking-customer-creation is now strictly read-only; use the UI flow to create private bookings.'
    )
  }

  const phone =
    (readOptionalFlagValue(argv, '--phone') ?? process.env.TEST_PRIVATE_BOOKING_CUSTOMER_CREATION_PHONE ?? '07700900123')
      .trim()

  const supabase = createAdminClient()

  console.log('🧪 Private Booking Customer Creation (Read-only)')
  console.log('Phone:', phone)
  console.log('')

  const phoneVariants = [
    phone,
    phone.startsWith('0') ? `+44${phone.substring(1)}` : phone,
    phone.startsWith('0') ? `44${phone.substring(1)}` : phone,
  ].filter((value, idx, arr) => arr.indexOf(value) === idx)

  console.log('1️⃣ Looking up customers by mobile number variants...')
  const { data: customersData, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number, created_at')
    .or(phoneVariants.map((value) => `mobile_number.eq.${value}`).join(','))
    .order('created_at', { ascending: false })
    .limit(5)

  const customers =
    (assertScriptQuerySucceeded({
      operation: 'Lookup customers by mobile number variants',
      error: customerError,
      data: customersData as CustomerRow[] | null,
      allowMissing: true,
    }) ?? []) as CustomerRow[]

  if (!customers || customers.length === 0) {
    console.log('❌ No matching customers found.')
  } else {
    console.log(`✅ Found ${customers.length} matching customer(s):`)
    for (const customer of customers) {
      console.log(
        `- id=${customer.id} name=${customer.first_name ?? ''} ${customer.last_name ?? ''} mobile=${customer.mobile_number} created_at=${customer.created_at}`
      )
    }
  }

  console.log('\n2️⃣ Looking up private bookings by contact_phone variants...')
  const { data: privateBookingsData, error: bookingError } = await supabase
    .from('private_bookings')
    .select('id, customer_id, customer_name, contact_phone, status, created_at')
    .or(phoneVariants.map((value) => `contact_phone.eq.${value}`).join(','))
    .order('created_at', { ascending: false })
    .limit(5)

  const privateBookings =
    (assertScriptQuerySucceeded({
      operation: 'Lookup private bookings by contact phone variants',
      error: bookingError,
      data: privateBookingsData as PrivateBookingRow[] | null,
      allowMissing: true,
    }) ?? []) as PrivateBookingRow[]

  if (!privateBookings || privateBookings.length === 0) {
    console.log('No matching private bookings found.')
  } else {
    console.log(`Found ${privateBookings.length} matching private booking(s):`)
    for (const booking of privateBookings) {
      console.log(
        `- id=${booking.id} customer_id=${booking.customer_id ?? 'null'} contact_phone=${booking.contact_phone ?? 'null'} status=${booking.status ?? 'null'} created_at=${booking.created_at}`
      )
    }
  }

  console.log('\n📝 Note: Customer creation/linking happens in the server action, not database triggers.')
  console.log('To fully test creation/linking, create a booking through the UI at /private-bookings/new.')
}

testPrivateBookingCustomerCreation().catch((error) => {
  console.error('❌ Unexpected error:', error)
  process.exitCode = 1
})
