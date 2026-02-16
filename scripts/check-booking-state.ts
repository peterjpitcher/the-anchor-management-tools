#!/usr/bin/env tsx
/**
 * Inspect a pending booking token and any linked booking row (read-only).
 *
 * Safety:
 * - Strictly read-only; blocks `--confirm`.
 * - Requires explicit `--token` (no hard-coded production identifiers).
 * - Fails closed on env/query errors via `process.exitCode = 1`.
 *
 * Usage:
 *   tsx scripts/check-booking-state.ts --token <pending_booking_token_uuid>
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

const SCRIPT_NAME = 'check-booking-state'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=').slice(1).join('=') || null
  }

  const idx = argv.findIndex((arg) => arg === flag)
  if (idx === -1) {
    return null
  }

  const value = argv[idx + 1]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function assertReadOnly(argv: string[] = process.argv.slice(2)) {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm.`)
  }
}

async function main() {
  const argv = process.argv.slice(2)
  assertReadOnly(argv)

  const token = readOptionalFlagValue(argv, '--token')
  if (!token) {
    throw new Error(`[${SCRIPT_NAME}] Missing required --token`)
  }

  const supabase = createAdminClient()

  console.log(`Checking pending booking for token: ${token}`)

  const { data: pending, error: pendingError } = await supabase
    .from('pending_bookings')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (pendingError) {
    throw new Error(`[${SCRIPT_NAME}] Error fetching pending booking: ${pendingError.message || 'unknown error'}`)
  }

  if (!pending) {
    throw new Error(`[${SCRIPT_NAME}] No pending booking found for token=${token}`)
  }

  console.log('Pending booking:', JSON.stringify(pending, null, 2))

  if (!pending.booking_id) {
    console.log('Pending booking has no booking_id associated yet.')

    if (pending.customer_id && pending.event_id) {
      console.log('Checking for disconnected bookings for this customer/event...')
      const { data: disconnected, error: discError } = await supabase
        .from('bookings')
        .select('*')
        .eq('event_id', pending.event_id)
        .eq('customer_id', pending.customer_id)

      if (discError) {
        throw new Error(`[${SCRIPT_NAME}] Error fetching disconnected bookings: ${discError.message || 'unknown error'}`)
      }

      console.log('Disconnected bookings:', JSON.stringify(disconnected ?? [], null, 2))
    }

    return
  }

  console.log(`\nFetching booking id=${pending.booking_id}`)
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', pending.booking_id)
    .maybeSingle()

  if (bookingError) {
    throw new Error(`[${SCRIPT_NAME}] Error fetching booking: ${bookingError.message || 'unknown error'}`)
  }

  if (!booking) {
    throw new Error(`[${SCRIPT_NAME}] Booking not found for id=${pending.booking_id}`)
  }

  console.log('Booking:', JSON.stringify(booking, null, 2))
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})

