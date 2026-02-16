#!/usr/bin/env tsx

import { config } from 'dotenv'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertDeleteTestBookingsCompletedWithoutFailures,
  assertDeleteTestBookingsForceAllowed,
  assertDeleteTestBookingsLimit,
  assertDeleteTestBookingsMutationAllowed,
  assertDeleteTestBookingsMutationSucceeded,
  isDeleteTestBookingsMutationRunEnabled,
  readDeleteTestBookingsLimit,
  resolveDeleteTestBookingsRows
} from '../../src/lib/delete-test-bookings-safety'

type BookingPaymentRow = {
  id: string
  status: string | null
}

type BookingItemRow = {
  id: string
}

type BookingRow = {
  id: string
  booking_reference: string
  booking_date: string | null
  booking_time: string | null
  status: string | null
  source: string | null
  special_requirements: string | null
  created_at: string | null
  table_booking_items: BookingItemRow[] | null
  table_booking_payments: BookingPaymentRow[] | null
}

type ListBookingRow = {
  booking_reference: string
  booking_date: string | null
  booking_time: string | null
  status: string | null
  source: string | null
  created_at: string | null
  customer:
    | {
      first_name: string | null
      last_name: string | null
    }
    | Array<{
      first_name: string | null
      last_name: string | null
    }>
    | null
}

config({ path: '.env.local' })

const supabase = createAdminClient()

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function formatCustomerName(customer: ListBookingRow['customer']): string {
  if (!customer) {
    return 'Unknown customer'
  }

  const entry = Array.isArray(customer) ? customer[0] : customer
  if (!entry) {
    return 'Unknown customer'
  }

  return `${entry.first_name ?? ''} ${entry.last_name ?? ''}`.trim() || 'Unknown customer'
}

function printUsage(): void {
  console.log('Usage:')
  console.log('  List test bookings:    tsx scripts/cleanup/delete-test-bookings.ts list')
  console.log('  Inspect delete plan:   tsx scripts/cleanup/delete-test-bookings.ts delete <booking-reference>')
  console.log(
    '  Mutate (requires multi-gating + cap): RUN_DELETE_TEST_BOOKINGS_MUTATION=true ALLOW_DELETE_TEST_BOOKINGS_MUTATION=true tsx scripts/cleanup/delete-test-bookings.ts delete <booking-reference> --confirm --limit 1'
  )
  console.log(
    '  Force delete:          RUN_DELETE_TEST_BOOKINGS_MUTATION=true ALLOW_DELETE_TEST_BOOKINGS_MUTATION=true tsx scripts/cleanup/delete-test-bookings.ts delete <booking-reference> --confirm --limit 1 --force'
  )
  console.log('  Force dry-run:         tsx scripts/cleanup/delete-test-bookings.ts delete <booking-reference> --dry-run')
  console.log('')
  console.log(
    'Notes: mutations require --confirm --limit=1 and the env vars RUN_DELETE_TEST_BOOKINGS_MUTATION=true and ALLOW_DELETE_TEST_BOOKINGS_MUTATION=true.'
  )
  console.log(
    '       --force is required for certain high-risk deletions (e.g. non-test bookings or confirmed bookings with completed payment).'
  )
}

async function listTestBookings(): Promise<void> {
  console.log('📋 Recent Test Bookings:\n')

  const { data: bookingsData, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(
      `
      booking_reference,
      booking_date,
      booking_time,
      status,
      created_at,
      source,
      customer:customers(first_name, last_name)
    `
    )
    .or('source.eq.api_test,source.eq.phone,special_requirements.ilike.%test%')
    .order('created_at', { ascending: false })
    .limit(10)

  const bookings = resolveDeleteTestBookingsRows<ListBookingRow>({
    operation: 'Load test bookings list',
    rows: bookingsData as ListBookingRow[] | null,
    error: bookingsError
  })

  if (bookings.length === 0) {
    console.log('No test bookings found')
    return
  }

  for (const booking of bookings) {
    console.log(`${booking.booking_reference} - ${formatCustomerName(booking.customer)}`)
    console.log(`   Date: ${booking.booking_date ?? 'unknown'} at ${booking.booking_time ?? 'unknown'}`)
    console.log(`   Status: ${booking.status ?? 'unknown'}`)
    console.log(`   Source: ${booking.source ?? 'unknown'}`)
    console.log(`   Created: ${booking.created_at ? new Date(booking.created_at).toLocaleString() : 'unknown'}`)
    console.log('')
  }
}

async function deleteBooking(
  bookingReference: string,
  options: { mutationEnabled: boolean; forceDelete: boolean; mutationLimit: number | null }
): Promise<void> {
  console.log(
    `🗑️ ${options.mutationEnabled ? 'Deleting' : 'Inspecting delete plan for'} booking ${bookingReference}`
  )
  console.log('='.repeat(60))

  const { data: bookingRowsData, error: bookingRowsError } = await supabase
    .from('table_bookings')
    .select(
      `
      id,
      booking_reference,
      booking_date,
      booking_time,
      status,
      source,
      special_requirements,
      created_at,
      table_booking_items(id),
      table_booking_payments(id, status)
    `
    )
    .eq('booking_reference', bookingReference)
    .limit(2)

  const bookingRows = resolveDeleteTestBookingsRows<BookingRow>({
    operation: `Load booking ${bookingReference} for deletion`,
    rows: bookingRowsData as BookingRow[] | null,
    error: bookingRowsError
  })

  if (bookingRows.length !== 1) {
    throw new Error(
      `Expected exactly one booking for reference ${bookingReference}, found ${bookingRows.length}`
    )
  }

  if (options.mutationEnabled && options.mutationLimit !== null && bookingRows.length > options.mutationLimit) {
    throw new Error(
      `delete-test-bookings blocked: matched ${bookingRows.length} booking row(s), exceeding --limit ${options.mutationLimit}.`
    )
  }

  const booking = bookingRows[0]
  const paymentRows = Array.isArray(booking.table_booking_payments) ? booking.table_booking_payments : []
  const itemRows = Array.isArray(booking.table_booking_items) ? booking.table_booking_items : []
  const hasCompletedPayment = paymentRows.some((payment) => payment.status === 'completed')

  const specialRequirements =
    typeof booking.special_requirements === 'string' ? booking.special_requirements : ''
  const isLikelyTestBooking =
    booking.source === 'api_test' ||
    (specialRequirements.trim().length > 0 &&
      specialRequirements.toLowerCase().includes('test'))

  console.log('📌 Booking Details:')
  console.log(`   Reference: ${booking.booking_reference}`)
  console.log(`   Date: ${booking.booking_date ?? 'unknown'} at ${booking.booking_time ?? 'unknown'}`)
  console.log(`   Status: ${booking.status ?? 'unknown'}`)
  console.log(`   Source: ${booking.source ?? 'unknown'}`)
  if (specialRequirements.trim().length > 0) {
    console.log(`   Special requirements: ${specialRequirements}`)
  }
  console.log(`   Looks like test booking: ${isLikelyTestBooking ? 'yes' : 'NO'}`)
  console.log(`   Menu Items: ${itemRows.length}`)
  console.log(`   Payments: ${paymentRows.length}`)

  const { data: jobsData, error: jobsLookupError } = await supabase
    .from('jobs')
    .select('id')
    .or(`payload->booking_id.eq.${booking.id},payload->variables->reference.eq.${bookingReference}`)

  const jobs = resolveDeleteTestBookingsRows<{ id: string }>({
    operation: `Load jobs linked to booking ${booking.id}`,
    rows: jobsData as Array<{ id: string }> | null,
    error: jobsLookupError
  })

  if (!options.mutationEnabled) {
    console.log('\nDRY RUN: no rows deleted.')
    console.log('Would delete:')
    console.log(`- table_booking_payments: ${paymentRows.length}`)
    console.log(`- table_booking_items: ${itemRows.length}`)
    console.log(`- jobs: ${jobs.length}`)
    console.log(`- table_bookings: 1`)

    const forceReasons: string[] = []
    if (!isLikelyTestBooking) {
      forceReasons.push('booking does not look like a test booking')
    }
    if (booking.status === 'confirmed' && hasCompletedPayment) {
      forceReasons.push('booking is confirmed with completed payment')
    }
    if (forceReasons.length > 0 && !options.forceDelete) {
      console.log('\nMutation would be blocked without --force because:')
      forceReasons.forEach((reason) => console.log(`- ${reason}`))
    }

    console.log(
      '\nTo mutate, set RUN_DELETE_TEST_BOOKINGS_MUTATION=true and ALLOW_DELETE_TEST_BOOKINGS_MUTATION=true, then re-run with --confirm --limit 1.'
    )
    return
  }

  assertDeleteTestBookingsMutationAllowed()

  if (!isLikelyTestBooking && !options.forceDelete) {
    throw new Error('Refusing to delete non-test booking without --force.')
  }

  assertDeleteTestBookingsForceAllowed({
    status: booking.status,
    hasCompletedPayment,
    forceEnabled: options.forceDelete
  })

  console.log('\n🔄 Deleting related records...')

  if (paymentRows.length > 0) {
    const { data: deletedPayments, error: paymentDeleteError } = await supabase
      .from('table_booking_payments')
      .delete()
      .eq('booking_id', booking.id)
      .select('id')

    const { updatedCount } = assertDeleteTestBookingsMutationSucceeded({
      operation: `Delete payment rows for booking ${booking.id}`,
      error: paymentDeleteError,
      rows: deletedPayments as Array<{ id?: string }> | null,
      expectedCount: paymentRows.length
    })
    console.log(`   ✅ Deleted ${updatedCount} payment record(s)`)
  }

  if (itemRows.length > 0) {
    const { data: deletedItems, error: itemDeleteError } = await supabase
      .from('table_booking_items')
      .delete()
      .eq('booking_id', booking.id)
      .select('id')

    const { updatedCount } = assertDeleteTestBookingsMutationSucceeded({
      operation: `Delete item rows for booking ${booking.id}`,
      error: itemDeleteError,
      rows: deletedItems as Array<{ id?: string }> | null,
      expectedCount: itemRows.length
    })
    console.log(`   ✅ Deleted ${updatedCount} menu item(s)`)
  }

  if (jobs.length > 0) {
    const { data: deletedJobs, error: jobsDeleteError } = await supabase
      .from('jobs')
      .delete()
      .in(
        'id',
        jobs.map((job) => job.id)
      )
      .select('id')

    const { updatedCount } = assertDeleteTestBookingsMutationSucceeded({
      operation: `Delete jobs linked to booking ${booking.id}`,
      error: jobsDeleteError,
      rows: deletedJobs as Array<{ id?: string }> | null,
      expectedCount: jobs.length
    })
    console.log(`   ✅ Deleted ${updatedCount} related job(s)`)
  }

  const { data: deletedBookings, error: bookingDeleteError } = await supabase
    .from('table_bookings')
    .delete()
    .eq('id', booking.id)
    .select('id')

  assertDeleteTestBookingsMutationSucceeded({
    operation: `Delete booking row ${booking.id}`,
    error: bookingDeleteError,
    rows: deletedBookings as Array<{ id?: string }> | null,
    expectedCount: 1
  })
  console.log(`   ✅ Deleted booking ${booking.booking_reference}`)

  const { data: auditRows, error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'delete',
      entity_type: 'table_booking',
      entity_id: booking.id,
      metadata: {
        booking_reference: booking.booking_reference,
        reason: 'Manual deletion via script',
        deleted_at: new Date().toISOString()
      }
    })
    .select('id')

  assertDeleteTestBookingsMutationSucceeded({
    operation: `Insert delete audit row for booking ${booking.id}`,
    error: auditError,
    rows: auditRows as Array<{ id?: string }> | null,
    expectedCount: 1
  })
  console.log('   ✅ Audit log created')

  const { data: remainingRowsData, error: remainingRowsError } = await supabase
    .from('table_bookings')
    .select('id')
    .eq('id', booking.id)

  const remainingRows = resolveDeleteTestBookingsRows<{ id: string }>({
    operation: `Verify booking ${booking.id} was deleted`,
    rows: remainingRowsData as Array<{ id: string }> | null,
    error: remainingRowsError
  })

  const failures: string[] = []
  if (remainingRows.length !== 0) {
    failures.push(`Booking ${booking.id} still exists after deletion attempt`)
  }

  assertDeleteTestBookingsCompletedWithoutFailures({
    failureCount: failures.length,
    failures
  })

  console.log('\n✅ Successfully deleted booking and related records.')
}

async function main(): Promise<void> {
  const HARD_CAP = 1
  const argv = process.argv.slice(2)
  const forceDelete = argv.includes('--force')
  const hasConfirmFlag = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  const command = positional[0]
  const bookingRef = positional[1]

  if (command === 'list') {
    await listTestBookings()
    return
  }

  if (command === 'delete' && bookingRef) {
    const mutationEnabled =
      !dryRunOverride &&
      hasConfirmFlag &&
      isDeleteTestBookingsMutationRunEnabled()
    const mutationLimit = mutationEnabled
      ? assertDeleteTestBookingsLimit(readDeleteTestBookingsLimit(process.argv, process.env), HARD_CAP)
      : null

    if (hasConfirmFlag && !dryRunOverride && !mutationEnabled) {
      throw new Error(
        'delete-test-bookings blocked: --confirm requires RUN_DELETE_TEST_BOOKINGS_MUTATION=true and explicit --limit=1.'
      )
    }

    await deleteBooking(bookingRef, { mutationEnabled, forceDelete, mutationLimit })
    return
  }

  printUsage()
  throw new Error('Invalid command for delete-test-bookings')
}

main().catch((error) => {
  markFailure('delete-test-bookings failed.', error)
})
