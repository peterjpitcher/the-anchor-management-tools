#!/usr/bin/env tsx

import { config } from 'dotenv'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertDeletePeterTestBookingsCompletedWithoutFailures,
  assertDeletePeterTestBookingsLimit,
  assertDeletePeterTestBookingsMutationAllowed,
  assertDeletePeterTestBookingsMutationSucceeded,
  isDeletePeterTestBookingsMutationRunEnabled,
  readDeletePeterTestBookingsLimit,
  resolveDeletePeterTestBookingsRows
} from '../../src/lib/delete-peter-test-bookings-safety'

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
}

type BookingRow = {
  id: string
  booking_reference: string | null
  booking_date: string | null
  booking_time: string | null
  party_size: number | null
  status: string | null
  special_requirements: string | null
}

config({ path: '.env.local' })

async function deletePeterTestBookings(): Promise<void> {
  const HARD_CAP = 200
  const supabase = createAdminClient()
  const customerId = 'ba19868e-5e0d-4fa0-a992-e54207e1c8c7'

  const hasConfirmFlag = process.argv.includes('--confirm')
  const runMutations = isDeletePeterTestBookingsMutationRunEnabled(process.argv)
  const mutationLimit = runMutations
    ? assertDeletePeterTestBookingsLimit(
      readDeletePeterTestBookingsLimit(process.argv, process.env),
      HARD_CAP
    )
    : null

  if (runMutations) {
    assertDeletePeterTestBookingsMutationAllowed()
    console.log(`Mutation mode enabled for delete-peter-test-bookings (limit=${mutationLimit}).`)
  } else if (hasConfirmFlag) {
    throw new Error(
      'delete-peter-test-bookings received --confirm but RUN_DELETE_PETER_TEST_BOOKINGS_MUTATION is not enabled. Set RUN_DELETE_PETER_TEST_BOOKINGS_MUTATION=true and ALLOW_DELETE_PETER_TEST_BOOKINGS_MUTATION=true, and pass --limit, to apply deletions.'
    )
  } else {
    console.log(
      'Read-only mode. Re-run with --confirm --limit <n> plus RUN_DELETE_PETER_TEST_BOOKINGS_MUTATION=true and ALLOW_DELETE_PETER_TEST_BOOKINGS_MUTATION=true to apply deletions.'
    )
  }

  console.log(`Inspecting table bookings for customer id ${customerId}.\n`)

  const { data: customerRowsRaw, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .eq('id', customerId)

  const customerRows = resolveDeletePeterTestBookingsRows<CustomerRow>({
    operation: 'Load Peter customer row',
    rows: customerRowsRaw as CustomerRow[] | null,
    error: customerError
  })

  if (customerRows.length === 0) {
    console.log('No matching customer found for configured customer id.')
    return
  }

  const customer = customerRows[0]
  const customerName = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'Unknown'
  console.log(`Customer: ${customerName} (${customer.mobile_number ?? 'no phone'})\n`)

  const { data: bookingsRaw, error: bookingsError } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, booking_date, booking_time, party_size, status, special_requirements')
    .eq('customer_id', customerId)
    .order('booking_date', { ascending: false })

  const bookings = resolveDeletePeterTestBookingsRows<BookingRow>({
    operation: 'Load table bookings for Peter customer',
    rows: bookingsRaw as BookingRow[] | null,
    error: bookingsError
  })

  if (bookings.length === 0) {
    console.log('No table bookings found for the configured customer.')
    return
  }

  if (runMutations && mutationLimit !== null && bookings.length > mutationLimit) {
    throw new Error(
      `delete-peter-test-bookings blocked: matched ${bookings.length} booking(s), exceeding --limit ${mutationLimit}.`
    )
  }

  console.log(`Found ${bookings.length} table booking(s):`)
  bookings.forEach((booking) => {
    console.log(
      `  - Ref: ${booking.booking_reference ?? 'unknown'} | ${booking.booking_date ?? 'unknown'} ${booking.booking_time ?? 'unknown'} | Party ${booking.party_size ?? 'unknown'} | Status: ${booking.status ?? 'unknown'}`
    )
    if (booking.special_requirements) {
      console.log(`    Notes: ${booking.special_requirements}`)
    }
  })
  console.log()

  if (!runMutations) {
    return
  }

  const bookingIds = bookings.map((booking) => booking.id)
  const failures: string[] = []

  const { data: deletedBookingRows, error: deleteBookingsError } = await supabase
    .from('table_bookings')
    .delete()
    .in('id', bookingIds)
    .select('id')

  try {
    const { updatedCount } = assertDeletePeterTestBookingsMutationSucceeded({
      operation: 'Delete Peter test booking rows',
      error: deleteBookingsError,
      rows: deletedBookingRows as Array<{ id?: string }> | null,
      expectedCount: bookingIds.length
    })
    console.log(`✅ Deleted ${updatedCount} booking row(s)`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(message)
    console.error(`❌ Booking deletion failed: ${message}`)
  }

  const { data: auditRows, error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'bulk_delete',
      entity_type: 'table_bookings',
      metadata: {
        reason: 'Deleted test bookings for Peter Pitcher (direct customer id target)',
        customer_id: customerId,
        customer_name: customerName,
        booking_ids: bookingIds,
        count: bookingIds.length
      }
    })
    .select('id')

  try {
    assertDeletePeterTestBookingsMutationSucceeded({
      operation: 'Insert delete-peter-test-bookings audit log row',
      error: auditError,
      rows: auditRows as Array<{ id?: string }> | null,
      expectedCount: 1
    })
    console.log('📝 Audit log created')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(message)
    console.error(`❌ Audit log insert failed: ${message}`)
  }

  const { data: remainingRowsRaw, error: remainingRowsError } = await supabase
    .from('table_bookings')
    .select('id')
    .in('id', bookingIds)

  const remainingRows = resolveDeletePeterTestBookingsRows<{ id: string }>({
    operation: 'Verify no targeted Peter booking rows remain after deletion',
    rows: remainingRowsRaw as Array<{ id: string }> | null,
    error: remainingRowsError
  })

  if (remainingRows.length > 0) {
    failures.push(
      `Expected 0 remaining targeted Peter booking rows after deletion, found ${remainingRows.length}`
    )
  }

  assertDeletePeterTestBookingsCompletedWithoutFailures({
    failureCount: failures.length,
    failures
  })

  console.log('\n✅ delete-peter-test-bookings completed without unresolved failures.')
}

deletePeterTestBookings().catch((error) => {
  console.error('delete-peter-test-bookings script failed:', error)
  process.exitCode = 1
})
