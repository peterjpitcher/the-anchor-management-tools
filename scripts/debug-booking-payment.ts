#!/usr/bin/env tsx
/**
 * Debug a specific table booking row by booking reference (read-only).
 *
 * Safety:
 * - Strictly read-only; blocks `--confirm`.
 * - Requires explicit `--booking-ref` (no hard-coded production identifiers).
 * - Fails closed on env/query errors via `process.exitCode = 1`.
 *
 * Usage:
 *   tsx scripts/debug-booking-payment.ts --booking-ref TB-2025-0001
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

const SCRIPT_NAME = 'debug-booking-payment'

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

  const bookingRef = readOptionalFlagValue(argv, '--booking-ref')
  if (!bookingRef) {
    throw new Error(`[${SCRIPT_NAME}] Missing required --booking-ref`)
  }

  const supabase = createAdminClient()

  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select('*')
    .eq('booking_reference', bookingRef)
    .maybeSingle()

  if (error) {
    throw new Error(`[${SCRIPT_NAME}] Error fetching booking: ${error.message || 'unknown error'}`)
  }

  if (!booking) {
    throw new Error(`[${SCRIPT_NAME}] Booking not found for booking_reference=${bookingRef}`)
  }

  console.log('Booking Details:')
  console.log(JSON.stringify(booking, null, 2))
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})

