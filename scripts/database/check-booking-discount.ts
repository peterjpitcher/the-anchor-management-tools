#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
}

function resolveBookingId(argv: string[]): string | null {
  const idx = argv.indexOf('--booking-id')
  if (idx !== -1) {
    return argv[idx + 1] || null
  }

  const positional = argv[2]
  if (positional && !positional.startsWith('-')) {
    return positional
  }

  return null
}

async function checkBookingDiscount() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-booking-discount is strictly read-only; do not pass --confirm.')
  }

  const bookingId = resolveBookingId(argv)
  if (!bookingId) {
    throw new Error(
      'Missing booking id. Usage: tsx scripts/database/check-booking-discount.ts --booking-id <uuid> (or pass as first arg).'
    )
  }

  const showCustomer = argv.includes('--show-customer')
  const showItems = argv.includes('--show-items')

  console.log('Checking private booking discount fields...\n')
  console.log(`Booking ID: ${bookingId}`)
  console.log(`Show customer name: ${showCustomer ? 'yes' : 'no'}`)
  console.log(`Show items: ${showItems ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()

  const { data: bookingRow, error: bookingError } = await supabase
    .from('private_bookings')
    .select(
      `
        id,
        status,
        customer_full_name,
        discount_type,
        discount_amount,
        discount_reason,
        total_amount,
        items:private_booking_items(
          description,
          line_total
        )
      `
    )
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingError) {
    markFailure('Error fetching private booking row.', bookingError)
    return
  }

  if (!bookingRow) {
    markFailure(`No private booking found for id '${bookingId}'.`)
    return
  }

  const booking = bookingRow as {
    id: string
    status: string | null
    customer_full_name: string | null
    discount_type: string | null
    discount_amount: unknown
    discount_reason: string | null
    total_amount: unknown
    items: Array<{ description: string | null; line_total: unknown }> | null
  }

  console.log('Booking:')
  console.log(`  id: ${booking.id}`)
  console.log(`  status: ${booking.status || 'unknown'}`)
  if (showCustomer) {
    console.log(`  customer: ${booking.customer_full_name || 'unknown'}`)
  }

  console.log('\nDiscount:')
  console.log(`  type: ${booking.discount_type || 'NULL'}`)
  console.log(`  amount: ${booking.discount_amount ?? 'NULL'}`)
  console.log(`  reason: ${booking.discount_reason || 'NULL'}`)

  const rawTotal = typeof booking.total_amount === 'string' ? Number.parseFloat(booking.total_amount) : booking.total_amount
  const total = typeof rawTotal === 'number' && Number.isFinite(rawTotal) ? rawTotal : 0

  const items = Array.isArray(booking.items) ? booking.items : []
  const subtotal = items.reduce((sum, item) => {
    const raw = typeof item.line_total === 'string' ? Number.parseFloat(item.line_total) : item.line_total
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
    return sum + value
  }, 0)

  console.log('\nFinancial summary:')
  console.log(`  items subtotal: £${subtotal.toFixed(2)}`)
  console.log(`  total_amount: £${total.toFixed(2)}`)

  if (showItems) {
    console.log('\nItems:')
    items.forEach((item) => {
      const raw = typeof item.line_total === 'string' ? Number.parseFloat(item.line_total) : item.line_total
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
      console.log(`  - ${item.description || 'unknown'}: £${value.toFixed(2)}`)
    })
  }
}

void checkBookingDiscount().catch((error) => {
  markFailure('check-booking-discount failed.', error)
})

