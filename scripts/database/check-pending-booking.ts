#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

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

function resolveToken(argv: string[]): string | null {
  const idx = argv.indexOf('--token')
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

async function checkPendingBooking() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-pending-booking is strictly read-only; do not pass --confirm.')
  }

  const token = resolveToken(argv)
  if (!token) {
    throw new Error(
      'Missing required token. Usage: tsx scripts/database/check-pending-booking.ts --token <token> (or pass as first arg).'
    )
  }

  const showMetadata = argv.includes('--show-metadata')
  const showJson = argv.includes('--show-json')

  console.log(`Checking pending booking token: ${token.length > 8 ? `${token.substring(0, 8)}...` : token}\n`)
  console.log(`Show metadata: ${showMetadata ? 'yes' : 'no'}`)
  console.log(`Show raw JSON: ${showJson ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()

  const { data: pendingRow, error: pendingError } = await supabase
    .from('pending_bookings')
    .select('id, token, event_id, mobile_number, customer_id, expires_at, confirmed_at, created_at, metadata')
    .eq('token', token)
    .maybeSingle()

  if (pendingError) {
    markFailure('Failed to load pending_booking row.', pendingError)
    return
  }

  if (!pendingRow) {
    markFailure('No pending booking found with this token.')
    return
  }

  const pending = pendingRow as {
    id: string
    token: string | null
    event_id: string | null
    mobile_number: string | null
    customer_id: string | null
    expires_at: string | null
    confirmed_at: string | null
    created_at: string | null
    metadata: unknown
  }

  console.log('1) pending_bookings:')
  console.log(`   id: ${pending.id}`)
  console.log(`   token: ${pending.token || 'unknown'}`)
  console.log(`   event_id: ${pending.event_id || 'NULL'}`)
  console.log(`   customer_id: ${pending.customer_id || 'NULL'}`)
  console.log(`   phone: ${maskPhone(pending.mobile_number)}`)
  console.log(`   created_at: ${pending.created_at || 'unknown'}`)
  console.log(`   confirmed_at: ${pending.confirmed_at || 'NULL'}`)
  console.log(`   expires_at: ${pending.expires_at || 'unknown'}`)

  if (showMetadata && pending.metadata) {
    console.log(`   metadata: ${safePreview(pending.metadata, 600)}`)
  }

  if (showJson) {
    console.log('\nRaw pending_booking JSON:')
    console.log(JSON.stringify(pendingRow, null, 2))
  }

  console.log('\n2) event row:')
  if (!pending.event_id) {
    console.log('   (missing event_id on pending booking)')
  } else {
    const { data: eventRow, error: eventError } = await supabase
      .from('events')
      .select('id, name, date, time, capacity')
      .eq('id', pending.event_id)
      .maybeSingle()

    if (eventError) {
      markFailure('Error fetching event row.', eventError)
    } else if (!eventRow) {
      markFailure(`Event does not exist for id '${pending.event_id}'.`)
    } else {
      const event = eventRow as {
        id: string
        name: string | null
        date: string | null
        time: string | null
        capacity: number | null
      }
      console.log(`   id: ${event.id}`)
      console.log(`   name: ${event.name || 'unknown'}`)
      console.log(`   date: ${event.date || 'unknown'} ${event.time || ''}`.trim())
      console.log(`   capacity: ${event.capacity ?? 'unknown'}`)
    }
  }

  console.log('\n3) customer row:')
  if (!pending.customer_id) {
    console.log('   (no customer_id on pending booking)')
  } else {
    const { data: customerRow, error: customerError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, sms_opt_in, sms_opt_out')
      .eq('id', pending.customer_id)
      .maybeSingle()

    if (customerError) {
      markFailure('Error fetching customer row.', customerError)
    } else if (!customerRow) {
      markFailure(`Customer does not exist for id '${pending.customer_id}'.`)
    } else {
      const customer = customerRow as {
        id: string
        first_name: string | null
        last_name: string | null
        mobile_number: string | null
        sms_opt_in: boolean | null
        sms_opt_out: boolean | null
      }
      const name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'unknown'
      console.log(`   id: ${customer.id}`)
      console.log(`   name: ${name}`)
      console.log(`   phone: ${maskPhone(customer.mobile_number)}`)
      console.log(`   sms_opt_in: ${customer.sms_opt_in ? 'true' : 'false'}, sms_opt_out: ${customer.sms_opt_out ? 'true' : 'false'}`)
    }
  }

  console.log('\n4) expiry check:')
  const now = new Date()
  const expiresAt = pending.expires_at ? new Date(pending.expires_at) : null
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    markFailure('Pending booking expires_at is missing or invalid.')
    return
  }

  console.log(`   now: ${now.toISOString()}`)
  console.log(`   expires_at: ${expiresAt.toISOString()}`)
  if (expiresAt < now) {
    console.log('   status: EXPIRED')
  } else {
    console.log('   status: VALID')
  }

  console.log('\n5) confirmation-page query (single row):')
  const { data: fullRows, error: fullError } = await supabase
    .from('pending_bookings')
    .select(
      `
        id,
        token,
        event_id,
        mobile_number,
        customer_id,
        expires_at,
        confirmed_at,
        metadata,
        event:events(
          id,
          name,
          date,
          time,
          capacity
        ),
        customer:customers(
          id,
          first_name,
          last_name
        )
      `
    )
    .eq('token', token)
    .maybeSingle()

  const full = assertScriptQuerySucceeded({
    operation: 'Load pending booking confirmation-page join query',
    error: fullError,
    data: fullRows,
    allowMissing: true
  })

  if (!full) {
    markFailure('Confirmation-page join query returned no row.')
    return
  }

  if (showJson) {
    console.log(JSON.stringify(full, null, 2))
    return
  }

  console.log('   OK (use --show-json to print full payload)')
}

void checkPendingBooking().catch((error) => {
  markFailure('check-pending-booking failed.', error)
})

