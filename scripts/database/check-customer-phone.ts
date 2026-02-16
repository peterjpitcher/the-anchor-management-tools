#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { generatePhoneVariants } from '../../src/lib/utils'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 50

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
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

function resolvePhone(argv: string[]): string | null {
  const idx = argv.indexOf('--phone')
  if (idx !== -1) {
    return argv[idx + 1] || null
  }

  const positional = argv[2]
  if (positional && !positional.startsWith('-')) {
    return positional
  }

  return null
}

async function checkCustomerPhone() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-customer-phone is strictly read-only; do not pass --confirm.')
  }

  const phone = resolvePhone(argv)
  if (!phone) {
    throw new Error(
      'Missing required phone. Usage: tsx scripts/database/check-customer-phone.ts --phone +447700900123 (or pass as first arg).'
    )
  }

  const limit = parseLimit(argv)
  const showVariants = argv.includes('--show-variants')

  console.log(`Checking customer + pending booking context for phone: ${maskPhone(phone)}\n`)
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Show variants: ${showVariants ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()
  const variants = generatePhoneVariants(phone)

  if (variants.length === 0) {
    markFailure('No phone variants generated; cannot run lookup.')
    return
  }

  if (showVariants) {
    console.log('Phone variants:')
    variants.forEach((variant) => {
      console.log(`  - ${maskPhone(variant)}`)
    })
    console.log('')
  }

  console.log('1) customers table:')
  const { data: customersRows, error: customersError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number, sms_opt_in, sms_opt_out')
    .in('mobile_number', variants)
    .order('created_at', { ascending: false })
    .limit(limit)

  const customers = (assertScriptQuerySucceeded({
    operation: 'Load customers by mobile_number variants',
    error: customersError,
    data: customersRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
    sms_opt_in: boolean | null
    sms_opt_out: boolean | null
  }>

  console.log(`Found ${customers.length} customer(s):`)
  customers.forEach((customer) => {
    const name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'unknown'
    console.log(`  - ${name} (id: ${customer.id}, phone: ${maskPhone(customer.mobile_number)})`)
    console.log(`    sms_opt_in: ${customer.sms_opt_in ? 'true' : 'false'}, sms_opt_out: ${customer.sms_opt_out ? 'true' : 'false'}`)
  })

  console.log('\n2) pending_bookings (by mobile_number variants):')
  const { data: pendingRows, error: pendingError } = await supabase
    .from('pending_bookings')
    .select('id, token, customer_id, mobile_number, created_at, confirmed_at, expires_at')
    .in('mobile_number', variants)
    .order('created_at', { ascending: false })
    .limit(limit)

  const pendingBookings = (assertScriptQuerySucceeded({
    operation: 'Load pending bookings for phone variants',
    error: pendingError,
    data: pendingRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    token: string | null
    customer_id: string | null
    mobile_number: string | null
    created_at: string | null
    confirmed_at: string | null
    expires_at: string | null
  }>

  console.log(`Found ${pendingBookings.length} pending booking(s):`)
  pendingBookings.forEach((row) => {
    console.log(`  - token: ${row.token ? `${row.token.substring(0, 8)}...` : 'unknown'}`)
    console.log(`    customer_id: ${row.customer_id || 'NULL'}, phone: ${maskPhone(row.mobile_number)}`)
    console.log(`    created_at: ${row.created_at || 'unknown'}, confirmed_at: ${row.confirmed_at || 'NULL'}`)
  })
}

void checkCustomerPhone().catch((error) => {
  markFailure('check-customer-phone failed.', error)
})

