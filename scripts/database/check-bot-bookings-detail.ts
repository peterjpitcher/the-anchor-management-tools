#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  const db = createAdminClient()

  // 1. Get ALL bookings from "Άλι" customers
  console.log('=== ALL "Άλι Άλι" BOOKINGS ===\n')
  const { data: aliCustomers, error: aliErr } = await db
    .from('customers')
    .select('id, first_name, last_name, mobile_number, mobile_e164, email, created_at')
    .ilike('first_name', '%Άλι%')

  if (aliErr) { console.error(aliErr); process.exit(1) }
  console.log(`Found ${aliCustomers.length} "Άλι" customer records:\n`)

  const aliIds = aliCustomers.map(c => c.id)

  for (const c of aliCustomers) {
    console.log(`  Customer: ${c.first_name} ${c.last_name} | ${c.mobile_number} | email: ${c.email || 'none'} | created: ${c.created_at}`)
  }

  // Get all their bookings
  const { data: aliBookings, error: aliBookErr } = await db
    .from('table_bookings')
    .select('id, booking_reference, booking_date, booking_time, party_size, status, source, created_at, customer_id, booking_purpose, special_requirements')
    .in('customer_id', aliIds)
    .order('created_at', { ascending: true })

  if (aliBookErr) { console.error(aliBookErr); process.exit(1) }
  console.log(`\nTotal "Άλι" bookings: ${aliBookings.length}\n`)

  const aliBookingIds: string[] = []
  for (const b of aliBookings) {
    const cust = aliCustomers.find(c => c.id === b.customer_id)
    console.log(`  ${b.booking_reference} | ${b.booking_date} ${b.booking_time} | party:${b.party_size} | ${b.status} | src:${b.source} | ${cust?.mobile_number} | created:${b.created_at}`)
    aliBookingIds.push(b.id)
  }

  // 2. Check July 19 bookings specifically (far future = likely bot)
  console.log('\n=== ALL BOOKINGS FOR JULY 19, 2026 (suspicious far-future date) ===\n')
  const { data: julyBookings, error: julyErr } = await db
    .from('table_bookings')
    .select(`
      id, booking_reference, booking_date, booking_time, party_size, status, source, created_at, customer_id,
      customers (first_name, last_name, mobile_number, email)
    `)
    .eq('booking_date', '2026-07-19')
    .order('booking_time', { ascending: true })

  if (julyErr) { console.error(julyErr); process.exit(1) }
  console.log(`Total July 19 bookings: ${julyBookings.length}\n`)
  for (const b of julyBookings) {
    const c = b.customers as any
    console.log(`  ${b.booking_reference} | ${b.booking_time} | party:${b.party_size} | ${b.status} | ${c?.first_name} ${c?.last_name} (${c?.mobile_number}) | created:${b.created_at}`)
  }

  // 3. Check for other far-future bookings (more than 60 days out)
  console.log('\n=== ALL FAR-FUTURE BOOKINGS (60+ days from now) ===\n')
  const sixtyDaysFromNow = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10)
  const { data: farFuture, error: ffErr } = await db
    .from('table_bookings')
    .select(`
      id, booking_reference, booking_date, booking_time, party_size, status, source, created_at, customer_id,
      customers (first_name, last_name, mobile_number, email)
    `)
    .gte('booking_date', sixtyDaysFromNow)
    .order('booking_date', { ascending: true })

  if (ffErr) { console.error(ffErr); process.exit(1) }
  console.log(`Total far-future bookings: ${farFuture.length}\n`)
  for (const b of farFuture) {
    const c = b.customers as any
    console.log(`  ${b.booking_reference} | ${b.booking_date} ${b.booking_time} | party:${b.party_size} | ${b.status} | ${c?.first_name} ${c?.last_name} (${c?.mobile_number}) | created:${b.created_at}`)
  }

  // 4. Check SMS sent to these bot numbers (cost impact)
  console.log('\n=== SMS SENT TO BOT CUSTOMERS ===\n')
  const { data: smsSent, error: smsErr } = await db
    .from('sms_messages')
    .select('id, to_number, message_type, status, created_at, cost')
    .in('to_number', aliCustomers.map(c => c.mobile_e164 || c.mobile_number))
    .order('created_at', { ascending: true })
    .limit(100)

  if (smsErr) {
    console.log('Could not query SMS messages:', smsErr.message)
  } else if (smsSent) {
    console.log(`SMS messages sent to bot numbers: ${smsSent.length}`)
    let totalCost = 0
    for (const s of smsSent) {
      console.log(`  ${s.to_number} | ${s.message_type} | ${s.status} | cost: ${s.cost || '?'} | ${s.created_at}`)
      totalCost += (s.cost || 0)
    }
    console.log(`\nEstimated SMS cost to bot numbers: £${totalCost.toFixed(2)}`)
  }

  // 5. Check table_booking_payments for any payment attempts
  console.log('\n=== PAYMENT RECORDS FOR BOT BOOKINGS ===\n')
  const { data: payments, error: payErr } = await db
    .from('table_booking_payments')
    .select('*')
    .in('table_booking_id', aliBookingIds)
    .limit(50)

  if (payErr) {
    console.log('Could not query payments:', payErr.message)
  } else if (payments) {
    console.log(`Payment records: ${payments.length}`)
    for (const p of payments) {
      console.log(`  ${JSON.stringify(p)}`)
    }
  }

  // 6. Summary of what to clean up
  console.log('\n\n========================================')
  console.log('CLEANUP RECOMMENDATIONS')
  console.log('========================================\n')

  const botBookingIds = aliBookings.map(b => b.id)
  const botCustomerIds = aliCustomers.map(c => c.id)

  console.log(`BOT BOOKINGS TO DELETE: ${botBookingIds.length}`)
  console.log(`BOT CUSTOMERS TO DELETE: ${botCustomerIds.length}`)
  console.log(`\nBooking IDs:\n${botBookingIds.map(id => `  '${id}'`).join(',\n')}`)
  console.log(`\nCustomer IDs:\n${botCustomerIds.map(id => `  '${id}'`).join(',\n')}`)
}

main().catch(console.error)
