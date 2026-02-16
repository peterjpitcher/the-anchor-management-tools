#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 50
const ITEMS_HARD_CAP = 200

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
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

async function checkSundayLunchOrders() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-sunday-lunch-orders is strictly read-only; do not pass --confirm.')
  }

  const limit = parseLimit(argv)
  const showNotes = argv.includes('--show-notes')

  console.log('🔍 Checking Sunday Lunch orders and menu items...\n')
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Item sample hard cap: ${ITEMS_HARD_CAP}`)
  console.log(`Show guest notes: ${showNotes ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()

  const { data: bookingsRows, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(
      `
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        status,
        created_at,
        customer:customers(
          first_name,
          last_name,
          mobile_number
        )
      `
    )
    .eq('booking_type', 'sunday_lunch')
    .order('created_at', { ascending: false })
    .limit(limit)

  const bookings = (assertScriptQuerySucceeded({
    operation: 'Load Sunday lunch bookings (sample)',
    error: bookingsError,
    data: bookingsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    booking_reference: string | null
    booking_date: string | null
    booking_time: string | null
    party_size: number | null
    status: string | null
    created_at: string | null
    customer: {
      first_name: string | null
      last_name: string | null
      mobile_number: string | null
    } | null
  }>

  console.log(`📋 Found ${bookings.length} Sunday Lunch booking(s) in sample\n`)

  for (const booking of bookings) {
    console.log(`\n📌 Booking: ${booking.booking_reference || booking.id}`)
    console.log(`   Date: ${booking.booking_date || 'unknown'} at ${booking.booking_time || 'unknown'}`)
    console.log(
      `   Customer: ${booking.customer ? `${booking.customer.first_name || ''} ${booking.customer.last_name || ''}`.trim() || 'unknown' : 'unknown'}`
    )
    console.log(`   Party Size: ${booking.party_size ?? 'unknown'}`)
    console.log(`   Status: ${booking.status || 'unknown'}`)

    const { data: itemsRows, error: itemsError } = await supabase
      .from('table_booking_items')
      .select(
        'id, item_type, quantity, price_at_booking, custom_item_name, menu_item_id, guest_name, special_requests, created_at'
      )
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: true })
      .limit(ITEMS_HARD_CAP)

    if (itemsError) {
      markFailure(`Error fetching menu items for booking ${booking.booking_reference || booking.id}.`, itemsError)
      continue
    }

    const items = (itemsRows ?? []) as Array<{
      id: string
      item_type: string | null
      quantity: number | null
      price_at_booking: number | null
      custom_item_name: string | null
      menu_item_id: string | null
      guest_name: string | null
      special_requests: string | null
      created_at: string | null
    }>

    if (items.length === 0) {
      console.log(`   ⚠️  No menu items found`)
    } else {
      console.log(`   ✅ Menu Items (${items.length}):`)
      let totalAmount = 0
      for (const item of items) {
        const qty = item.quantity ?? 0
        const price = item.price_at_booking ?? 0
        const itemTotal = price * qty
        totalAmount += itemTotal
        console.log(`      - ${qty}x ${item.custom_item_name || item.menu_item_id || 'Unknown Item'}`)
        console.log(`        Type: ${item.item_type || 'unknown'}`)
        console.log(`        Price: £${price} each (£${itemTotal.toFixed(2)} total)`)
        if (showNotes) {
          if (item.guest_name) console.log(`        For: ${item.guest_name}`)
          if (item.special_requests) console.log(`        Note: ${item.special_requests}`)
        }
      }
      console.log(`   💷 Total Order Value (sample): £${totalAmount.toFixed(2)}`)
    }

    const { data: paymentsRows, error: paymentsError } = await supabase
      .from('table_booking_payments')
      .select('amount, status, transaction_id, created_at')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (paymentsError) {
      markFailure(`Error fetching payment records for booking ${booking.booking_reference || booking.id}.`, paymentsError)
      continue
    }

    const payments = (paymentsRows ?? []) as Array<{
      amount: number | null
      status: string | null
      transaction_id: string | null
      created_at: string | null
    }>

    if (payments.length > 0) {
      console.log(`   💳 Payments (${payments.length}):`)
      payments.forEach((payment) => {
        console.log(`      - £${payment.amount ?? 0} (${payment.status || 'unknown'})`)
        if (payment.transaction_id) console.log(`        Transaction: ${payment.transaction_id}`)
      })
    }
  }

  console.log('\n\n📊 Summary (bookings without items):')
  const missingFilter = `(
    SELECT DISTINCT booking_id
    FROM table_booking_items
  )`

  const { count: missingCount, error: missingCountError } = await supabase
    .from('table_bookings')
    .select('*', { count: 'exact', head: true })
    .eq('booking_type', 'sunday_lunch')
    .not('id', 'in', missingFilter)

  if (missingCountError) {
    markFailure('Failed to count Sunday lunch bookings without menu items.', missingCountError)
    return
  }

  const totalMissing = missingCount ?? 0
  if (totalMissing === 0) {
    console.log('✅ All Sunday Lunch bookings have menu items (count query).')
    return
  }

  console.log(`⚠️  ${totalMissing} Sunday Lunch booking(s) have NO menu items.`)

  const { data: missingRows, error: missingRowsError } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, created_at')
    .eq('booking_type', 'sunday_lunch')
    .not('id', 'in', missingFilter)
    .order('created_at', { ascending: false })
    .limit(limit)

  const missingBookings = (assertScriptQuerySucceeded({
    operation: 'Load Sunday lunch bookings missing items (sample)',
    error: missingRowsError,
    data: missingRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ id: string; booking_reference: string | null; created_at: string | null }>

  if (missingBookings.length > 0) {
    console.log(`Showing ${missingBookings.length} booking(s) missing items (sample):`)
    missingBookings.forEach((row) => {
      console.log(`  - ${row.booking_reference || row.id}`)
    })
    if (totalMissing > missingBookings.length) {
      console.log(`  (sample limited to ${limit})`)
    }
  }
}

void checkSundayLunchOrders().catch((error) => {
  markFailure('check-sunday-lunch-orders failed.', error)
})

