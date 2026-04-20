#!/usr/bin/env tsx

/**
 * One-off cleanup: remove the two stranded test rows created while validating
 * the PayPal capture-order 404 bug (Sunday lunch / debit card flow).
 *
 * Both were created by peter.pitcher@outlook.com on 2026-04-18 while the bug
 * was live. They have a PayPal order but no capture, so nothing was charged.
 * Safe to hard-delete: they're fixtures, not real business data.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const REFERENCES = ['TB-86FF5EAA', 'TB-6D37CF7A'] as const
const EXPECTED_EMAIL = 'peter.pitcher@outlook.com'

async function main() {
  const db = createAdminClient()

  const { data: bookings, error } = await db
    .from('table_bookings')
    .select(`
      id, booking_reference, status, payment_status,
      paypal_deposit_order_id, paypal_deposit_capture_id, created_at,
      customer_id, customers ( email )
    `)
    .in('booking_reference', REFERENCES as unknown as string[])

  if (error) {
    throw error
  }

  if (!bookings || bookings.length === 0) {
    console.log('No matching rows found — already cleaned up.')
    return
  }

  console.log('Matched rows:')
  for (const row of bookings) {
    const email = (row.customers as any)?.email ?? '(no email)'
    console.log(`  ${row.booking_reference} | ${row.id} | status=${row.status} | order=${row.paypal_deposit_order_id ?? 'none'} | capture=${row.paypal_deposit_capture_id ?? 'none'} | email=${email}`)
  }

  // Safety check: every row must belong to Peter's email and have no capture
  for (const row of bookings) {
    const email = (row.customers as any)?.email
    if (email !== EXPECTED_EMAIL) {
      throw new Error(`Abort: row ${row.booking_reference} belongs to ${email}, not ${EXPECTED_EMAIL}`)
    }
    if (row.paypal_deposit_capture_id) {
      throw new Error(`Abort: row ${row.booking_reference} has a PayPal capture — do not delete`)
    }
  }

  const bookingIds = bookings.map(b => b.id)

  // Delete child rows first to respect any FK constraints.
  const { error: holdsErr, count: holdsDeleted } = await db
    .from('booking_holds')
    .delete({ count: 'exact' })
    .in('table_booking_id', bookingIds)
  if (holdsErr) throw holdsErr
  console.log(`Deleted ${holdsDeleted ?? 0} booking_holds rows`)

  const { error: paymentsErr, count: paymentsDeleted } = await db
    .from('payments')
    .delete({ count: 'exact' })
    .in('table_booking_id', bookingIds)
  if (paymentsErr) throw paymentsErr
  console.log(`Deleted ${paymentsDeleted ?? 0} payments rows`)

  const { error: assignmentsErr, count: assignmentsDeleted } = await db
    .from('booking_table_assignments')
    .delete({ count: 'exact' })
    .in('table_booking_id', bookingIds)
  if (assignmentsErr) throw assignmentsErr
  console.log(`Deleted ${assignmentsDeleted ?? 0} booking_table_assignments rows`)

  const { error: itemsErr, count: itemsDeleted } = await db
    .from('table_booking_items')
    .delete({ count: 'exact' })
    .in('booking_id', bookingIds)
  if (itemsErr) throw itemsErr
  console.log(`Deleted ${itemsDeleted ?? 0} table_booking_items rows`)

  const { error: bookingsErr, count: bookingsDeleted } = await db
    .from('table_bookings')
    .delete({ count: 'exact' })
    .in('id', bookingIds)
  if (bookingsErr) throw bookingsErr
  console.log(`Deleted ${bookingsDeleted ?? 0} table_bookings rows`)

  // Verify
  const { data: check } = await db
    .from('table_bookings')
    .select('id, booking_reference')
    .in('booking_reference', REFERENCES as unknown as string[])
  console.log(`Verification: ${check?.length ?? 0} rows remaining for refs ${REFERENCES.join(', ')} (expected 0)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
