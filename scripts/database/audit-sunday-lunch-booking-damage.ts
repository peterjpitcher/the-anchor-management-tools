#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const CAPTURE_BUG_START = '2026-03-15'
const TODAY = new Date().toISOString().split('T')[0]

function formatCountLine(label: string, count: number, total?: number): string {
  if (total === undefined) return `  ${label}: ${count}`
  const pct = total === 0 ? 0 : Math.round((count / total) * 100)
  return `  ${label}: ${count} / ${total} (${pct}%)`
}

async function group1StrandedBookings(db: ReturnType<typeof createAdminClient>) {
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('GROUP 1 — Stranded bookings (Problem B, since 2026-03-15)')
  console.log('═══════════════════════════════════════════════════════════')

  // All cancelled-by-cron bookings where a PayPal order was created but never captured
  const { data: stranded, error } = await db
    .from('table_bookings')
    .select(`
      id,
      booking_reference,
      booking_date,
      booking_time,
      party_size,
      booking_type,
      source,
      status,
      cancellation_reason,
      cancelled_at,
      created_at,
      paypal_deposit_order_id,
      paypal_deposit_capture_id,
      customer_id,
      customers ( id, first_name, last_name, mobile_number, email )
    `)
    .gte('created_at', CAPTURE_BUG_START)
    .not('paypal_deposit_order_id', 'is', null)
    .is('paypal_deposit_capture_id', null)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) {
    console.error('Error fetching stranded bookings:', error)
    return
  }

  const rows = stranded ?? []
  const total = rows.length
  const cancelledByCron = rows.filter(r => r.cancellation_reason === 'payment_hold_expired').length
  const stillPending = rows.filter(r => r.status === 'pending_payment').length
  const otherStatus = total - cancelledByCron - stillPending
  const sundayLunch = rows.filter(r => r.booking_type === 'sunday_lunch').length
  const websiteSource = rows.filter(r => r.source === 'brand_site' || r.source === 'website').length

  const customers = rows
    .map(r => r.customers as any)
    .filter(Boolean)
  const uniqueCustomerIds = new Set(customers.map((c: any) => c.id).filter(Boolean))
  const withEmail = customers.filter((c: any) => c?.email && c.email.trim().length > 0)
  const withPhone = customers.filter((c: any) => c?.mobile_number && c.mobile_number.trim().length > 0)
  const withName = customers.filter((c: any) => (c?.first_name || c?.last_name))

  console.log(formatCountLine('Total stranded bookings (PayPal order created but never captured)', total))
  console.log(formatCountLine('  → Cancelled by cron (payment_hold_expired)', cancelledByCron, total))
  console.log(formatCountLine('  → Still stuck in pending_payment', stillPending, total))
  console.log(formatCountLine('  → Other status', otherStatus, total))
  console.log(formatCountLine('  Sunday lunch bookings', sundayLunch, total))
  console.log(formatCountLine('  Website-sourced', websiteSource, total))
  console.log(formatCountLine('  Unique customers', uniqueCustomerIds.size))
  console.log(formatCountLine('  Customers with email on file', withEmail.length, uniqueCustomerIds.size))
  console.log(formatCountLine('  Customers with phone on file', withPhone.length, uniqueCustomerIds.size))
  console.log(formatCountLine('  Customers with name on file', withName.length, uniqueCustomerIds.size))

  // Date distribution
  const futureBookings = rows.filter(r => r.booking_date >= TODAY).length
  const pastBookings = total - futureBookings
  console.log(formatCountLine('  Booking date in the future', futureBookings, total))
  console.log(formatCountLine('  Booking date in the past', pastBookings, total))

  // Show 5 most recent
  console.log('\n  Most recent 5 stranded bookings:')
  for (const row of rows.slice(0, 5)) {
    const c = row.customers as any
    const name = c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '(no name)' : '(no customer)'
    const contact = c?.email || c?.mobile_number || '(no contact)'
    const createdAt = row.created_at?.slice(0, 16).replace('T', ' ')
    console.log(`    ${row.booking_reference ?? row.id.slice(0, 8)} | ${row.booking_date} ${row.booking_time} | party ${row.party_size} | ${row.booking_type} | ${name} | ${contact} | created ${createdAt} | status=${row.status}`)
  }
}

async function group2MisStoredBookings(db: ReturnType<typeof createAdminClient>) {
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('GROUP 2 — Completed bookings with pre-order data in notes')
  console.log('═══════════════════════════════════════════════════════════')

  // Confirmed / completed Sunday lunch bookings whose table_booking_items rows are missing
  // but whose special_requirements contains pre-order text
  const { data: bookings, error } = await db
    .from('table_bookings')
    .select(`
      id,
      booking_reference,
      booking_date,
      booking_time,
      party_size,
      booking_type,
      source,
      status,
      special_requirements,
      dietary_requirements,
      allergies,
      created_at,
      customer_id,
      customers ( id, first_name, last_name, mobile_number, email )
    `)
    .eq('booking_type', 'sunday_lunch')
    .in('status', ['confirmed', 'completed'])
    .order('booking_date', { ascending: false })
    .limit(2000)

  if (error) {
    console.error('Error fetching Sunday lunch bookings:', error)
    return
  }

  const rows = bookings ?? []
  const total = rows.length

  // Count how many have pre-order items in the items table
  const bookingIds = rows.map(r => r.id)
  const itemCountsByBooking = new Map<string, number>()
  const CHUNK = 200
  for (let i = 0; i < bookingIds.length; i += CHUNK) {
    const slice = bookingIds.slice(i, i + CHUNK)
    const { data: items } = await db
      .from('table_booking_items')
      .select('booking_id')
      .in('booking_id', slice)
    for (const it of items ?? []) {
      const id = (it as any).booking_id as string
      itemCountsByBooking.set(id, (itemCountsByBooking.get(id) ?? 0) + 1)
    }
  }

  const withItems = rows.filter(r => (itemCountsByBooking.get(r.id) ?? 0) > 0).length
  const withoutItems = total - withItems
  const notesLooksPreorder = rows.filter(r =>
    !(itemCountsByBooking.get(r.id) ?? 0) &&
    r.special_requirements &&
    /Sunday lunch pre-?order|Guest \d+:/i.test(r.special_requirements)
  ).length
  const notesOnlyNoItems = rows.filter(r =>
    !(itemCountsByBooking.get(r.id) ?? 0) &&
    r.special_requirements &&
    r.special_requirements.trim().length > 0
  ).length
  const websiteSource = rows.filter(r => r.source === 'brand_site' || r.source === 'website').length
  const futureSundays = rows.filter(r => r.booking_date >= TODAY).length
  const futureSundaysMisStored = rows.filter(r =>
    r.booking_date >= TODAY && !(itemCountsByBooking.get(r.id) ?? 0) && r.special_requirements
  ).length

  console.log(formatCountLine('Total confirmed/completed Sunday lunch bookings', total))
  console.log(formatCountLine('  → With structured pre-order items (table_booking_items)', withItems, total))
  console.log(formatCountLine('  → WITHOUT structured pre-order items', withoutItems, total))
  console.log(formatCountLine('  → Without items AND notes look like pre-order text', notesLooksPreorder, total))
  console.log(formatCountLine('  → Without items AND any non-empty notes', notesOnlyNoItems, total))
  console.log(formatCountLine('  Website-sourced', websiteSource, total))
  console.log(formatCountLine('  Booking date today or later', futureSundays, total))
  console.log(formatCountLine('  FUTURE Sundays affected by the disconnect', futureSundaysMisStored, total))

  console.log('\n  Next 5 upcoming mis-stored Sunday bookings (highest kitchen impact):')
  const upcoming = rows
    .filter(r => r.booking_date >= TODAY && !(itemCountsByBooking.get(r.id) ?? 0) && r.special_requirements)
    .sort((a, b) => a.booking_date.localeCompare(b.booking_date))
    .slice(0, 5)
  for (const row of upcoming) {
    const c = row.customers as any
    const name = c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '(no name)' : '(no customer)'
    const srSnippet = row.special_requirements?.slice(0, 80).replace(/\n/g, ' | ')
    console.log(`    ${row.booking_reference} | ${row.booking_date} ${row.booking_time} | party ${row.party_size} | ${name} | special_requirements: "${srSnippet}"`)
  }
}

async function main() {
  const db = createAdminClient()
  console.log(`Audit run at ${new Date().toISOString()}`)
  console.log(`Capture bug start: ${CAPTURE_BUG_START}  |  Today: ${TODAY}`)
  await group1StrandedBookings(db)
  await group2MisStoredBookings(db)
  console.log('\nDone.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
