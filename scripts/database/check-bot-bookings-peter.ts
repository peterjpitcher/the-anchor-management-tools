#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  const db = createAdminClient()

  // Find Peter Pitcher bookings
  const { data: peterCustomers, error: pcErr } = await db
    .from('customers')
    .select('id, first_name, last_name, mobile_number, email, created_at')
    .ilike('last_name', '%Pitcher%')

  if (pcErr) { console.error(pcErr); process.exit(1) }
  console.log(`Peter Pitcher customer records: ${peterCustomers.length}`)
  for (const c of peterCustomers) {
    console.log(`  ${c.first_name} ${c.last_name} | ${c.mobile_number} | ${c.email} | created: ${c.created_at}`)
  }

  if (peterCustomers.length > 0) {
    const peterIds = peterCustomers.map(c => c.id)
    const { data: peterBookings, error: pbErr } = await db
      .from('table_bookings')
      .select('id, booking_reference, booking_date, booking_time, party_size, status, source, created_at, customer_id')
      .in('customer_id', peterIds)
      .order('created_at', { ascending: false })

    if (pbErr) { console.error(pbErr); process.exit(1) }
    console.log(`\nPeter Pitcher bookings: ${peterBookings.length}`)
    for (const b of peterBookings) {
      console.log(`  ${b.booking_reference} | ${b.booking_date} ${b.booking_time} | party:${b.party_size} | ${b.status} | src:${b.source} | created:${b.created_at}`)
    }
  }

  // Check for related records that need cleanup: table_booking_items, table_booking_modifications, table_booking_reminder_history
  console.log('\n=== CHECKING RELATED TABLES FOR BOT/TEST BOOKINGS ===\n')

  // Get all bot + peter booking IDs
  const aliCustomerIds = await db.from('customers').select('id').ilike('first_name', '%Άλι%')
  const aliBookings = await db.from('table_bookings').select('id').in('customer_id', aliCustomerIds.data?.map(c => c.id) || [])
  const peterBookings2 = peterCustomers.length > 0
    ? await db.from('table_bookings').select('id').in('customer_id', peterCustomers.map(c => c.id))
    : { data: [] }

  const allBadIds = [
    ...(aliBookings.data?.map(b => b.id) || []),
    ...(peterBookings2.data?.map(b => b.id) || [])
  ]

  console.log(`Total bookings to check for related records: ${allBadIds.length}`)

  // Check table_booking_items
  const { data: items, error: itemsErr } = await db
    .from('table_booking_items')
    .select('id, table_booking_id')
    .in('table_booking_id', allBadIds)
  console.log(`table_booking_items: ${itemsErr ? itemsErr.message : (items?.length || 0)} records`)

  // Check table_booking_modifications
  const { data: mods, error: modsErr } = await db
    .from('table_booking_modifications')
    .select('id, table_booking_id')
    .in('table_booking_id', allBadIds)
  console.log(`table_booking_modifications: ${modsErr ? modsErr.message : (mods?.length || 0)} records`)

  // Check table_booking_reminder_history
  const { data: reminders, error: remErr } = await db
    .from('table_booking_reminder_history')
    .select('id, table_booking_id')
    .in('table_booking_id', allBadIds)
  console.log(`table_booking_reminder_history: ${remErr ? remErr.message : (reminders?.length || 0)} records`)

  // Check audit_logs
  const { data: audits, error: audErr } = await db
    .from('audit_logs')
    .select('id, resource_type, resource_id')
    .eq('resource_type', 'table_booking')
    .in('resource_id', allBadIds)
  console.log(`audit_logs (table_booking): ${audErr ? audErr.message : (audits?.length || 0)} records`)

  // Check idempotency keys
  const { data: idempotency, error: idempErr } = await db
    .from('table_booking_idempotency')
    .select('id, table_booking_id')
    .in('table_booking_id', allBadIds)
  console.log(`table_booking_idempotency: ${idempErr ? idempErr.message : (idempotency?.length || 0)} records`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
