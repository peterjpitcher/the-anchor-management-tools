#!/usr/bin/env tsx

import { config } from 'dotenv'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertDeletePeterPitcherBookingsCompletedWithoutFailures,
  assertDeletePeterPitcherBookingsLimit,
  assertDeletePeterPitcherBookingsMutationAllowed,
  assertDeletePeterPitcherBookingsMutationSucceeded,
  isDeletePeterPitcherBookingsMutationRunEnabled,
  readDeletePeterPitcherBookingsLimit,
  resolveDeletePeterPitcherBookingsRows
} from '../../src/lib/delete-peter-pitcher-bookings-safety'

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
}

config({ path: '.env.local' })

async function deletePeterPitcherBookings(): Promise<void> {
  const HARD_CAP = 200
  const supabase = createAdminClient()
  console.log('Inspecting table bookings for customer names matching Peter Pitcher.\n')

  const hasConfirmFlag = process.argv.includes('--confirm')
  const runMutations = isDeletePeterPitcherBookingsMutationRunEnabled()
  const mutationLimit = runMutations
    ? assertDeletePeterPitcherBookingsLimit(
      readDeletePeterPitcherBookingsLimit(process.argv, process.env),
      HARD_CAP
    )
    : null

  if (runMutations) {
    assertDeletePeterPitcherBookingsMutationAllowed()
    console.log(`Mutation mode enabled for delete-peter-pitcher-bookings (limit=${mutationLimit}).`)
  } else if (hasConfirmFlag) {
    throw new Error(
      'delete-peter-pitcher-bookings received --confirm but RUN_DELETE_PETER_PITCHER_BOOKINGS_MUTATION is not enabled. Set RUN_DELETE_PETER_PITCHER_BOOKINGS_MUTATION=true and ALLOW_DELETE_PETER_PITCHER_BOOKINGS_MUTATION=true, and pass --limit, to apply deletions.'
    )
  } else {
    console.log(
      'Read-only mode. Re-run with --confirm --limit <n> plus RUN_DELETE_PETER_PITCHER_BOOKINGS_MUTATION=true and ALLOW_DELETE_PETER_PITCHER_BOOKINGS_MUTATION=true to apply deletions.'
    )
  }

  const { data: customersData, error: customersError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .or('first_name.ilike.%peter%,last_name.ilike.%pitcher%')

  const customers = resolveDeletePeterPitcherBookingsRows<CustomerRow>({
    operation: 'Load customers matching Peter/Pitcher filter',
    rows: customersData as CustomerRow[] | null,
    error: customersError
  })

  if (customers.length === 0) {
    console.log('No matching customers found.')
    return
  }

  console.log(`Found ${customers.length} matching customer(s):`)
  customers.forEach((customer) => {
    const name = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'Unknown'
    console.log(`  - ${name} (${customer.mobile_number ?? 'no phone'}) [${customer.id}]`)
  })

  const customerIds = customers.map((customer) => customer.id)
  const { data: bookingsData, error: bookingsError } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, booking_date, booking_time, party_size, status')
    .in('customer_id', customerIds)
    .order('booking_date', { ascending: false })

  const bookings = resolveDeletePeterPitcherBookingsRows<BookingRow>({
    operation: 'Load table bookings for matching customers',
    rows: bookingsData as BookingRow[] | null,
    error: bookingsError
  })

  if (bookings.length === 0) {
    console.log('No table bookings found for matching customers.')
    return
  }

  if (runMutations && mutationLimit !== null && bookings.length > mutationLimit) {
    throw new Error(
      `delete-peter-pitcher-bookings blocked: matched ${bookings.length} booking(s), exceeding --limit ${mutationLimit}.`
    )
  }

  console.log(`\nFound ${bookings.length} table booking(s):`)
  bookings.forEach((booking) => {
    console.log(
      `  - ${booking.booking_reference ?? 'unknown'} | ${booking.booking_date ?? 'unknown'} ${booking.booking_time ?? 'unknown'} | Party ${booking.party_size ?? 'unknown'} | ${booking.status ?? 'unknown'}`
    )
  })

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
    const { updatedCount } = assertDeletePeterPitcherBookingsMutationSucceeded({
      operation: 'Delete Peter Pitcher booking rows',
      error: deleteBookingsError,
      rows: deletedBookingRows as Array<{ id?: string }> | null,
      expectedCount: bookingIds.length
    })
    if (updatedCount !== bookingIds.length) {
      failures.push(`Expected to delete ${bookingIds.length} bookings, deleted ${updatedCount}`)
    }
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
        reason: 'Deleted test bookings for Peter Pitcher',
        booking_ids: bookingIds,
        count: bookingIds.length
      }
    })
    .select('id')

  try {
    assertDeletePeterPitcherBookingsMutationSucceeded({
      operation: 'Insert delete-peter-pitcher-bookings audit log row',
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

  const { data: remainingBookingsData, error: remainingBookingsError } = await supabase
    .from('table_bookings')
    .select('id')
    .in('id', bookingIds)

  const remainingBookings = resolveDeletePeterPitcherBookingsRows<{ id: string }>({
    operation: 'Verify no targeted booking rows remain after deletion',
    rows: remainingBookingsData as Array<{ id: string }> | null,
    error: remainingBookingsError
  })

  if (remainingBookings.length > 0) {
    failures.push(
      `Expected 0 remaining targeted bookings after deletion, found ${remainingBookings.length}`
    )
  }

  assertDeletePeterPitcherBookingsCompletedWithoutFailures({
    failureCount: failures.length,
    failures
  })

  console.log('\n✅ delete-peter-pitcher-bookings completed without unresolved failures.')
}

deletePeterPitcherBookings().catch((error) => {
  console.error('delete-peter-pitcher-bookings script failed:', error)
  process.exitCode = 1
})
