#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 200

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function parseBoundedInt(params: {
  argv: string[]
  flag: string
  defaultValue: number
  hardCap: number
}): number {
  const idx = params.argv.indexOf(params.flag)
  if (idx === -1) {
    return params.defaultValue
  }

  const raw = params.argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${params.flag} must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > params.hardCap) {
    throw new Error(`${params.flag} too high (got ${parsed}, hard cap ${params.hardCap})`)
  }
  return parsed
}

function resolveBookingReference(argv: string[]): string | null {
  const idx = argv.indexOf('--booking-ref')
  if (idx !== -1) {
    return argv[idx + 1] || null
  }

  const positional = argv[2]
  if (positional && !positional.startsWith('-')) {
    return positional
  }

  return null
}

async function checkLatestBookingDetails() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-latest-booking-details is strictly read-only; do not pass --confirm.')
  }

  const bookingReference = resolveBookingReference(argv)
  const useLatest = argv.includes('--latest')
  if (!bookingReference && !useLatest) {
    throw new Error(
      'Missing booking target. Provide --booking-ref TB-YYYY-XXXX (or pass as first arg) OR pass --latest.'
    )
  }

  const showNotes = argv.includes('--show-notes')
  const itemsLimit = parseBoundedInt({ argv, flag: '--items-limit', defaultValue: 50, hardCap: HARD_CAP })
  const paymentsLimit = parseBoundedInt({ argv, flag: '--payments-limit', defaultValue: 10, hardCap: HARD_CAP })

  console.log('🔍 Checking Sunday Lunch booking details...\n')
  console.log(`Target: ${bookingReference ? bookingReference : 'latest sunday_lunch booking'}`)
  console.log(`Items limit: ${itemsLimit} (hard cap ${HARD_CAP})`)
  console.log(`Payments limit: ${paymentsLimit} (hard cap ${HARD_CAP})`)
  console.log(`Show guest notes: ${showNotes ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()

  const bookingQuery = supabase
    .from('table_bookings')
    .select(
      `
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        status,
        booking_type,
        created_at,
        customer:customers(
          first_name,
          last_name,
          mobile_number
        )
      `
    )
    .eq('booking_type', 'sunday_lunch')

  const { data: bookingRow, error: bookingError } = bookingReference
    ? await bookingQuery.eq('booking_reference', bookingReference).maybeSingle()
    : await bookingQuery.order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (bookingError) {
    markFailure('Failed to load booking details.', bookingError)
    return
  }

  if (!bookingRow) {
    markFailure(bookingReference ? `Booking not found for reference '${bookingReference}'.` : 'No Sunday lunch bookings found.')
    return
  }

  const booking = bookingRow as {
    id: string
    booking_reference: string | null
    booking_date: string | null
    booking_time: string | null
    party_size: number | null
    status: string | null
    booking_type: string | null
    created_at: string | null
    customer: { first_name: string | null; last_name: string | null; mobile_number: string | null } | null
  }

  console.log('📋 Booking:')
  console.log(`   Reference: ${booking.booking_reference || 'unknown'}`)
  console.log(`   Created: ${booking.created_at ? new Date(booking.created_at).toLocaleString() : 'unknown'}`)
  console.log(
    `   Customer: ${booking.customer ? `${booking.customer.first_name || ''} ${booking.customer.last_name || ''}`.trim() || 'unknown' : 'unknown'}`
  )
  console.log(`   Date: ${booking.booking_date || 'unknown'} at ${booking.booking_time || 'unknown'}`)
  console.log(`   Party Size: ${booking.party_size ?? 'unknown'}`)
  console.log(`   Status: ${booking.status || 'unknown'}`)

  console.log('\n📦 Order Details (table_booking_items):')
  const { data: itemsRows, error: itemsError } = await supabase
    .from('table_booking_items')
    .select(
      'id, menu_item_id, custom_item_name, item_type, quantity, price_at_booking, guest_name, special_requests, created_at'
    )
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: true })
    .limit(itemsLimit)

  if (itemsError) {
    markFailure('Error fetching booking items.', itemsError)
    return
  }

  const items = (itemsRows ?? []) as Array<{
    id: string
    menu_item_id: string | null
    custom_item_name: string | null
    item_type: string | null
    quantity: number | null
    price_at_booking: number | null
    guest_name: string | null
    special_requests: string | null
    created_at: string | null
  }>

  if (items.length === 0) {
    markFailure('No menu items found in database for this booking.')
    return
  }

  let totalAmount = 0
  items.forEach((item, index) => {
    const qty = item.quantity ?? 0
    const price = item.price_at_booking ?? 0
    const itemTotal = qty * price
    totalAmount += itemTotal

    console.log(`\nItem ${index + 1}:`)
    console.log(`   ID: ${item.id}`)
    console.log(`   Menu Item ID: ${item.menu_item_id || 'NULL'}`)
    console.log(`   Custom Item Name: ${item.custom_item_name || 'NULL'}`)
    console.log(`   Item Type: ${item.item_type || 'unknown'}`)
    console.log(`   Quantity: ${qty}`)
    console.log(`   Price: £${price} each`)
    console.log(`   Subtotal: £${itemTotal.toFixed(2)}`)
    if (showNotes) {
      console.log(`   Guest Name: ${item.guest_name || 'Not specified'}`)
      console.log(`   Special Requests: ${item.special_requests || 'None'}`)
    }
  })

  console.log(`\n💷 Total Order Value (sample): £${totalAmount.toFixed(2)}`)
  if (typeof booking.party_size === 'number') {
    console.log(`💰 Deposit Required (rule-of-thumb): £${(booking.party_size * 5).toFixed(2)}`)
  }

  const menuItemIds = items.map((item) => item.menu_item_id).filter((id): id is string => Boolean(id))
  if (menuItemIds.length > 0) {
    const uniqueIds = Array.from(new Set(menuItemIds)).slice(0, HARD_CAP)
    const { data: menuItemsRows, error: menuItemsError } = await supabase
      .from('sunday_lunch_menu_items')
      .select('id, name, category, price')
      .in('id', uniqueIds)

    if (menuItemsError) {
      markFailure('Error looking up sunday_lunch_menu_items.', menuItemsError)
    } else {
      const menuItems = (menuItemsRows ?? []) as Array<{
        id: string
        name: string | null
        category: string | null
        price: number | null
      }>

      if (menuItems.length > 0) {
        console.log('\n🍽️  Menu Items Lookup:')
        menuItems.forEach((row) => {
          console.log(`   - ${row.name || row.id} (${row.category || 'unknown'}) - £${row.price ?? 0}`)
        })
      }
    }
  }

  const { data: paymentsRows, error: paymentsError } = await supabase
    .from('table_booking_payments')
    .select('amount, status, payment_method, transaction_id, created_at')
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: false })
    .limit(paymentsLimit)

  const payments = (assertScriptQuerySucceeded({
    operation: 'Load payment records',
    error: paymentsError,
    data: paymentsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    amount: number | null
    status: string | null
    payment_method: string | null
    transaction_id: string | null
    created_at: string | null
  }>

  if (payments.length > 0) {
    console.log('\n💳 Payment Records:')
    payments.forEach((payment) => {
      console.log(`   - Amount: £${payment.amount ?? 0}`)
      console.log(`     Status: ${payment.status || 'unknown'}`)
      console.log(`     Method: ${payment.payment_method || 'unknown'}`)
      if (payment.transaction_id) {
        console.log(`     Transaction ID: ${payment.transaction_id}`)
      }
    })
  }
}

void checkLatestBookingDetails().catch((error) => {
  markFailure('check-latest-booking-details failed.', error)
})

