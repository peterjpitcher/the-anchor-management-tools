import { config } from 'dotenv'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertDeleteAllTableBookingsCompletedWithoutFailures,
  assertDeleteAllTableBookingsLimit,
  assertDeleteAllTableBookingsMutationAllowed,
  assertDeleteAllTableBookingsMutationSucceeded,
  isDeleteAllTableBookingsMutationRunEnabled,
  readDeleteAllTableBookingsLimit,
  resolveDeleteAllTableBookingsCount,
  resolveDeleteAllTableBookingsRows
} from '../../src/lib/delete-all-table-bookings-safety'

type BookingStatusRow = {
  status: string | null
}

type SampleBookingRow = {
  booking_reference: string | null
  booking_date: string | null
  status: string | null
  created_at: string | null
}

config({ path: '.env.local' })

const supabase = createAdminClient()

async function analyzeAndDeleteBookings(): Promise<void> {
  const HARD_CAP = 10000
  console.log('Inspecting table-booking data for optional cleanup.\n')

  const hasConfirmFlag = process.argv.includes('--confirm')
  const runMutations = isDeleteAllTableBookingsMutationRunEnabled()
  const mutationLimit = runMutations
    ? assertDeleteAllTableBookingsLimit(
      readDeleteAllTableBookingsLimit(process.argv, process.env),
      HARD_CAP
    )
    : null

  if (runMutations) {
    assertDeleteAllTableBookingsMutationAllowed()
    console.log(`Mutation mode enabled for delete-all-table-bookings (limit=${mutationLimit}).`)
  } else if (hasConfirmFlag) {
    throw new Error(
      'delete-all-table-bookings received --confirm but RUN_DELETE_ALL_TABLE_BOOKINGS_MUTATION is not enabled. Set RUN_DELETE_ALL_TABLE_BOOKINGS_MUTATION=true and ALLOW_DELETE_ALL_TABLE_BOOKINGS_MUTATION=true, and pass --limit, to apply deletions.'
    )
  } else {
    console.log(
      'Read-only analysis mode. Re-run with --confirm --limit <n> plus RUN_DELETE_ALL_TABLE_BOOKINGS_MUTATION=true and ALLOW_DELETE_ALL_TABLE_BOOKINGS_MUTATION=true to apply deletions.'
    )
  }

  const { count: totalBookingsRaw, error: totalBookingsError } = await supabase
    .from('table_bookings')
    .select('id', { count: 'exact', head: true })
  const totalBookings = resolveDeleteAllTableBookingsCount({
    operation: 'Count table bookings before delete-all-table-bookings cleanup',
    count: totalBookingsRaw,
    error: totalBookingsError
  })

  const { count: menuItemsRaw, error: menuItemsError } = await supabase
    .from('table_booking_items')
    .select('id', { count: 'exact', head: true })
  const menuItems = resolveDeleteAllTableBookingsCount({
    operation: 'Count table_booking_items before delete-all-table-bookings cleanup',
    count: menuItemsRaw,
    error: menuItemsError
  })

  const { count: paymentsRaw, error: paymentsError } = await supabase
    .from('table_booking_payments')
    .select('id', { count: 'exact', head: true })
  const payments = resolveDeleteAllTableBookingsCount({
    operation: 'Count table_booking_payments before delete-all-table-bookings cleanup',
    count: paymentsRaw,
    error: paymentsError
  })

  console.log(`📊 Total table bookings: ${totalBookings}`)
  console.log('📋 Related records:')
  console.log(`   - Menu items: ${menuItems}`)
  console.log(`   - Payments: ${payments}`)

  const { data: statusBreakdownData, error: statusBreakdownError } = await supabase
    .from('table_bookings')
    .select('status')
    .order('status', { ascending: true })
  const statusBreakdown = resolveDeleteAllTableBookingsRows<BookingStatusRow>({
    operation: 'Load table-booking status breakdown for delete-all-table-bookings analysis',
    rows: statusBreakdownData as BookingStatusRow[] | null,
    error: statusBreakdownError
  })

  const statusCounts: Record<string, number> = {}
  for (const booking of statusBreakdown) {
    const status = booking.status ?? 'unknown'
    statusCounts[status] = (statusCounts[status] || 0) + 1
  }

  console.log('\n📈 Bookings by status:')
  if (Object.keys(statusCounts).length === 0) {
    console.log('   - none')
  } else {
    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`   - ${status}: ${count}`)
    }
  }

  const { data: sampleBookingsData, error: sampleBookingsError } = await supabase
    .from('table_bookings')
    .select('booking_reference, booking_date, status, created_at')
    .order('created_at', { ascending: false })
    .limit(5)
  const sampleBookings = resolveDeleteAllTableBookingsRows<SampleBookingRow>({
    operation: 'Load sample table bookings for delete-all-table-bookings analysis',
    rows: sampleBookingsData as SampleBookingRow[] | null,
    error: sampleBookingsError
  })

  console.log('\n📝 Recent bookings (last 5):')
  if (sampleBookings.length === 0) {
    console.log('   - none')
  } else {
    sampleBookings.forEach((booking, index) => {
      console.log(
        `   ${index + 1}. ${booking.booking_reference ?? 'unknown'} - ${booking.booking_date ?? 'unknown'} (${booking.status ?? 'unknown'})`
      )
    })
  }

  const { data: smsJobsData, error: smsJobsError } = await supabase
    .from('jobs')
    .select('id')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .or('payload->template.like.%booking%,payload->template.like.%table%')
  const smsJobs = resolveDeleteAllTableBookingsRows<{ id: string }>({
    operation: 'Load pending booking-related SMS jobs for delete-all-table-bookings cleanup',
    rows: smsJobsData as Array<{ id: string }> | null,
    error: smsJobsError
  })
  console.log(`📨 Pending booking-related SMS jobs: ${smsJobs.length}`)

  console.log('\n⚠️ WARNING: This script can delete ALL table-booking data and pending booking SMS jobs.')

  if (!runMutations) {
    return
  }

  const plannedMutationRows = totalBookings + menuItems + payments + smsJobs.length
  if (mutationLimit !== null && plannedMutationRows > mutationLimit) {
    throw new Error(
      `delete-all-table-bookings blocked: planned ${plannedMutationRows} row mutation(s), exceeding --limit ${mutationLimit}.`
    )
  }

  console.log(`Mutation cap check passed: planned rows=${plannedMutationRows}, limit=${mutationLimit}`)

  console.log('\n🗑️ Running destructive cleanup...')

  if (menuItems > 0) {
    const { data: deletedItemRows, error: deleteItemsError } = await supabase
      .from('table_booking_items')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000')
      .select('id')
    const { updatedCount } = assertDeleteAllTableBookingsMutationSucceeded({
      operation: 'Delete table_booking_items rows',
      error: deleteItemsError,
      rows: deletedItemRows as Array<{ id?: string }> | null,
      expectedCount: menuItems
    })
    console.log(`✅ Deleted ${updatedCount} table_booking_items rows`)
  }

  if (payments > 0) {
    const { data: deletedPaymentRows, error: deletePaymentsError } = await supabase
      .from('table_booking_payments')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000')
      .select('id')
    const { updatedCount } = assertDeleteAllTableBookingsMutationSucceeded({
      operation: 'Delete table_booking_payments rows',
      error: deletePaymentsError,
      rows: deletedPaymentRows as Array<{ id?: string }> | null,
      expectedCount: payments
    })
    console.log(`✅ Deleted ${updatedCount} table_booking_payments rows`)
  }

  if (smsJobs.length > 0) {
    const { data: deletedSmsJobs, error: deleteSmsJobsError } = await supabase
      .from('jobs')
      .delete()
      .in(
        'id',
        smsJobs.map((job) => job.id)
      )
      .select('id')
    const { updatedCount } = assertDeleteAllTableBookingsMutationSucceeded({
      operation: 'Delete pending booking-related SMS jobs',
      error: deleteSmsJobsError,
      rows: deletedSmsJobs as Array<{ id?: string }> | null,
      expectedCount: smsJobs.length
    })
    console.log(`✅ Deleted ${updatedCount} pending booking-related SMS jobs`)
  } else {
    console.log('✅ No pending booking-related SMS jobs found')
  }

  if (totalBookings > 0) {
    const { data: deletedBookingRows, error: deleteBookingsError } = await supabase
      .from('table_bookings')
      .delete()
      .gte('id', '00000000-0000-0000-0000-000000000000')
      .select('id')
    const { updatedCount } = assertDeleteAllTableBookingsMutationSucceeded({
      operation: 'Delete table_bookings rows',
      error: deleteBookingsError,
      rows: deletedBookingRows as Array<{ id?: string }> | null,
      expectedCount: totalBookings
    })
    console.log(`✅ Deleted ${updatedCount} table_bookings rows`)
  }

  const { count: remainingBookingsRaw, error: remainingBookingsError } = await supabase
    .from('table_bookings')
    .select('id', { count: 'exact', head: true })
  const remainingBookings = resolveDeleteAllTableBookingsCount({
    operation: 'Count remaining table_bookings after delete-all-table-bookings cleanup',
    count: remainingBookingsRaw,
    error: remainingBookingsError
  })

  const { count: remainingItemsRaw, error: remainingItemsError } = await supabase
    .from('table_booking_items')
    .select('id', { count: 'exact', head: true })
  const remainingItems = resolveDeleteAllTableBookingsCount({
    operation: 'Count remaining table_booking_items after delete-all-table-bookings cleanup',
    count: remainingItemsRaw,
    error: remainingItemsError
  })

  const { count: remainingPaymentsRaw, error: remainingPaymentsError } = await supabase
    .from('table_booking_payments')
    .select('id', { count: 'exact', head: true })
  const remainingPayments = resolveDeleteAllTableBookingsCount({
    operation: 'Count remaining table_booking_payments after delete-all-table-bookings cleanup',
    count: remainingPaymentsRaw,
    error: remainingPaymentsError
  })

  const { data: remainingSmsJobsData, error: remainingSmsJobsError } = await supabase
    .from('jobs')
    .select('id')
    .eq('type', 'send_sms')
    .eq('status', 'pending')
    .or('payload->template.like.%booking%,payload->template.like.%table%')
  const remainingSmsJobs = resolveDeleteAllTableBookingsRows<{ id: string }>({
    operation: 'Load remaining pending booking-related SMS jobs after delete-all-table-bookings cleanup',
    rows: remainingSmsJobsData as Array<{ id: string }> | null,
    error: remainingSmsJobsError
  })

  const failures: string[] = []
  if (remainingBookings !== 0) {
    failures.push(`Expected 0 remaining table_bookings rows, found ${remainingBookings}`)
  }
  if (remainingItems !== 0) {
    failures.push(`Expected 0 remaining table_booking_items rows, found ${remainingItems}`)
  }
  if (remainingPayments !== 0) {
    failures.push(`Expected 0 remaining table_booking_payments rows, found ${remainingPayments}`)
  }
  if (remainingSmsJobs.length !== 0) {
    failures.push(
      `Expected 0 remaining pending booking-related SMS jobs, found ${remainingSmsJobs.length}`
    )
  }

  assertDeleteAllTableBookingsCompletedWithoutFailures({
    failureCount: failures.length,
    failures
  })

  console.log('\n✅ All targeted table-booking data and pending booking SMS jobs were deleted.')
}

analyzeAndDeleteBookings().catch((error) => {
  console.error('\ndelete-all-table-bookings script failed:', error)
  process.exitCode = 1
})
