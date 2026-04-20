#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  const db = createAdminClient()

  // === BOOKINGS TO DELETE ===

  // 23 Άλι Άλι bot bookings
  const aliBookingRefs = [
    'TB-2957EF95', 'TB-10A7FD7B', 'TB-E5F3A19E', 'TB-8333ECA2', 'TB-7166282A',
    'TB-EA0C0DA3', 'TB-76557F23', 'TB-D58D1CFC', 'TB-E8FBD996', 'TB-2407BC8B',
    'TB-690EF40A', 'TB-6E1CB786', 'TB-AE1AA552', 'TB-C26C688E', 'TB-FF2C998A',
    'TB-6AF5D705', 'TB-66FE4CB6', 'TB-1706C09C', 'TB-7CB73FBE', 'TB-76BEE7C8',
    'TB-B4295886', 'TB-4C792EE6', 'TB-7C43281F',
  ]

  // 3 Peter Pitcher test bookings
  const peterBookingRefs = ['TB-C108CD71', 'TB-FE47547C', 'TB-5CA1805C']

  // 2 Chris Fletcher duplicates (keep most recent: TB-FBDBCFAD)
  const chrisBookingRefs = ['TB-027720B0', 'TB-6A26193C']

  // 1 Tudor Thomas duplicate (keep most recent: TB-8909D14C)
  const tudorBookingRefs = ['TB-F49764B4']

  const allBookingRefs = [...aliBookingRefs, ...peterBookingRefs, ...chrisBookingRefs, ...tudorBookingRefs]

  console.log(`\nBookings to delete: ${allBookingRefs.length}`)
  console.log(`  Άλι Άλι bot: ${aliBookingRefs.length}`)
  console.log(`  Peter Pitcher test: ${peterBookingRefs.length}`)
  console.log(`  Chris Fletcher duplicates: ${chrisBookingRefs.length}`)
  console.log(`  Tudor Thomas duplicate: ${tudorBookingRefs.length}`)

  // Step 1: Get booking IDs from refs
  const { data: bookingsToDelete, error: fetchErr } = await db
    .from('table_bookings')
    .select('id, booking_reference')
    .in('booking_reference', allBookingRefs)

  if (fetchErr) { console.error('Failed to fetch bookings:', fetchErr); process.exit(1) }
  if (!bookingsToDelete || bookingsToDelete.length !== allBookingRefs.length) {
    console.error(`Expected ${allBookingRefs.length} bookings, found ${bookingsToDelete?.length || 0}`)
    const foundRefs = new Set(bookingsToDelete?.map(b => b.booking_reference) || [])
    const missing = allBookingRefs.filter(r => !foundRefs.has(r))
    if (missing.length > 0) console.error('Missing refs:', missing)
    process.exit(1)
  }

  const bookingIds = bookingsToDelete.map(b => b.id)
  console.log(`\nResolved ${bookingIds.length} booking IDs`)

  // Step 2: Delete related records (child tables first)
  console.log('\n--- Deleting related records ---')

  const { count: itemCount, error: itemErr } = await db
    .from('table_booking_items')
    .delete({ count: 'exact' })
    .in('booking_id', bookingIds)
  console.log(`  table_booking_items: ${itemErr ? `ERROR: ${itemErr.message}` : `${itemCount} deleted`}`)

  const { count: modCount, error: modErr } = await db
    .from('table_booking_modifications')
    .delete({ count: 'exact' })
    .in('booking_id', bookingIds)
  console.log(`  table_booking_modifications: ${modErr ? `ERROR: ${modErr.message}` : `${modCount} deleted`}`)

  const { count: remCount, error: remErr } = await db
    .from('table_booking_reminder_history')
    .delete({ count: 'exact' })
    .in('booking_id', bookingIds)
  console.log(`  table_booking_reminder_history: ${remErr ? `ERROR: ${remErr.message}` : `${remCount} deleted`}`)

  const { count: auditCount, error: auditErr } = await db
    .from('audit_logs')
    .delete({ count: 'exact' })
    .eq('resource_type', 'table_booking')
    .in('resource_id', bookingIds)
  console.log(`  audit_logs: ${auditErr ? `ERROR: ${auditErr.message}` : `${auditCount} deleted`}`)

  // Step 3: Delete the bookings themselves
  console.log('\n--- Deleting bookings ---')
  const { count: bookingCount, error: bookingErr } = await db
    .from('table_bookings')
    .delete({ count: 'exact' })
    .in('id', bookingIds)

  if (bookingErr) {
    console.error('ERROR deleting bookings:', bookingErr)
    process.exit(1)
  }
  console.log(`  table_bookings: ${bookingCount} deleted`)

  // Step 4: Delete bot customer records (17 Άλι Άλι customers only)
  console.log('\n--- Deleting bot customer records ---')

  // First verify these customers have no remaining bookings
  const { data: aliCustomers, error: aliCustErr } = await db
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .ilike('first_name', '%Άλι%')

  if (aliCustErr) { console.error('Failed to fetch Άλι customers:', aliCustErr); process.exit(1) }

  const aliCustIds = aliCustomers.map(c => c.id)

  // Check for any remaining bookings
  const { data: remainingBookings, error: remBookErr } = await db
    .from('table_bookings')
    .select('id, customer_id')
    .in('customer_id', aliCustIds)

  if (remBookErr) { console.error('Failed to check remaining bookings:', remBookErr); process.exit(1) }
  if (remainingBookings && remainingBookings.length > 0) {
    console.error(`WARNING: ${remainingBookings.length} remaining bookings for Άλι customers — aborting customer deletion`)
    process.exit(1)
  }

  // Safe to delete — also clean up any audit logs for these customers
  const { count: custAuditCount, error: custAuditErr } = await db
    .from('audit_logs')
    .delete({ count: 'exact' })
    .eq('resource_type', 'customer')
    .in('resource_id', aliCustIds)
  console.log(`  audit_logs (customer): ${custAuditErr ? `ERROR: ${custAuditErr.message}` : `${custAuditCount} deleted`}`)

  const { count: custCount, error: custErr } = await db
    .from('customers')
    .delete({ count: 'exact' })
    .in('id', aliCustIds)

  if (custErr) {
    console.error('ERROR deleting customers:', custErr)
    process.exit(1)
  }
  console.log(`  customers: ${custCount} deleted`)

  // Step 5: Verify
  console.log('\n\n========================================')
  console.log('CLEANUP COMPLETE — VERIFICATION')
  console.log('========================================\n')

  const { count: aliRemaining } = await db
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .ilike('first_name', '%Άλι%')
  console.log(`Remaining Άλι customers: ${aliRemaining}`)

  const { count: julyRemaining } = await db
    .from('table_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('booking_date', '2026-07-19')
  console.log(`Remaining July 19 bookings: ${julyRemaining}`)

  const { count: peterRemaining } = await db
    .from('table_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('booking_reference', 'TB-C108CD71')
  console.log(`Remaining Peter test bookings: ${peterRemaining}`)

  // Confirm Chris and Tudor kept bookings still exist
  const { data: chrisKept } = await db
    .from('table_bookings')
    .select('booking_reference, status')
    .eq('booking_reference', 'TB-FBDBCFAD')
    .single()
  console.log(`Chris Fletcher kept booking (TB-FBDBCFAD): ${chrisKept ? `${chrisKept.status} ✓` : 'MISSING ✗'}`)

  const { data: tudorKept } = await db
    .from('table_bookings')
    .select('booking_reference, status')
    .eq('booking_reference', 'TB-8909D14C')
    .single()
  console.log(`Tudor Thomas kept booking (TB-8909D14C): ${tudorKept ? `${tudorKept.status} ✓` : 'MISSING ✗'}`)
}

main().catch(console.error)
