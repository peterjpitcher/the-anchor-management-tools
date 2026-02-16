#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 25
const PAYMENT_SAMPLE_HARD_CAP = 50

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function parseLimit(argv: string[]): number {
  const idx = argv.indexOf('--limit')
  if (idx === -1) {
    return 5
  }

  const raw = argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--limit must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > HARD_CAP) {
    throw new Error(`--limit too high (got ${parsed}, hard cap ${HARD_CAP})`)
  }
  return parsed
}

function safePreview(value: unknown, maxChars: number): string {
  try {
    const asString = typeof value === 'string' ? value : JSON.stringify(value)
    if (typeof asString !== 'string') {
      return '[unprintable]'
    }
    if (asString.length <= maxChars) {
      return asString
    }
    return `${asString.substring(0, maxChars)}...`
  } catch {
    return '[unserializable]'
  }
}

async function checkRecentPayments() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-payment-status is strictly read-only; do not pass --confirm.')
  }

  const limit = parseLimit(argv)
  const includeAuditLogs = argv.includes('--include-audit')
  const showPaymentMetadata = argv.includes('--show-metadata')

  console.log('🔍 Checking recent payment attempts (Sunday lunch)\n')
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})`)
  console.log(`Include audit logs: ${includeAuditLogs ? 'yes' : 'no'}`)
  console.log(`Show payment metadata: ${showPaymentMetadata ? 'yes' : 'no'}\n`)

  const supabase = createAdminClient()

  const { data: bookingsRows, error: bookingsError } = await supabase
    .from('table_bookings')
    .select(
      `
        id,
        booking_reference,
        booking_date,
        booking_time,
        party_size,
        status,
        created_at,
        customer:customers(
          first_name,
          last_name,
          mobile_number
        )
      `
    )
    .eq('booking_type', 'sunday_lunch')
    .in('status', ['pending_payment', 'confirmed'])
    .order('created_at', { ascending: false })
    .limit(limit)

  const bookings = (assertScriptQuerySucceeded({
    operation: 'Load recent Sunday lunch bookings (pending_payment/confirmed)',
    error: bookingsError,
    data: bookingsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    booking_reference: string | null
    booking_date: string | null
    booking_time: string | null
    party_size: number | null
    status: string | null
    created_at: string | null
    customer: {
      first_name: string | null
      last_name: string | null
      mobile_number: string | null
    } | null
  }>

  if (bookings.length === 0) {
    console.log('No recent Sunday lunch bookings found in this sample.')
    return
  }

  console.log('📋 Recent Sunday Lunch Bookings (sample):')
  for (const booking of bookings) {
    console.log(`\n📌 Booking: ${booking.booking_reference || booking.id}`)
    console.log(`   Created: ${booking.created_at ? new Date(booking.created_at).toLocaleString() : 'unknown'}`)
    console.log(`   Date: ${booking.booking_date || 'unknown'} at ${booking.booking_time || 'unknown'}`)
    console.log(
      `   Customer: ${booking.customer ? `${booking.customer.first_name || ''} ${booking.customer.last_name || ''}`.trim() || 'unknown' : 'unknown'}`
    )
    console.log(`   Status: ${booking.status || 'unknown'}`)

    const { data: paymentsRows, error: paymentsError } = await supabase
      .from('table_booking_payments')
      .select('id, status, amount, created_at, transaction_id, paid_at, payment_metadata')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false })
      .limit(PAYMENT_SAMPLE_HARD_CAP)

    if (paymentsError) {
      markFailure(`Error fetching payment records for booking ${booking.booking_reference || booking.id}.`, paymentsError)
    } else {
      const payments = (paymentsRows ?? []) as Array<{
        id: string
        status: string | null
        amount: number | null
        created_at: string | null
        transaction_id: string | null
        paid_at: string | null
        payment_metadata: unknown
      }>

      if (payments.length === 0) {
        console.log('   ⚠️  No payment records found')
      } else {
        console.log(`   💳 Payment Records (${payments.length}):`)
        payments.forEach((payment) => {
          console.log(`      - Status: ${payment.status || 'unknown'}`)
          console.log(`        Amount: £${payment.amount ?? 0}`)
          console.log(`        Created: ${payment.created_at ? new Date(payment.created_at).toLocaleString() : 'unknown'}`)
          if (payment.transaction_id) {
            console.log(`        Transaction ID: ${payment.transaction_id}`)
          }
          if (payment.paid_at) {
            console.log(`        Paid At: ${new Date(payment.paid_at).toLocaleString()}`)
          }
          if (showPaymentMetadata && payment.payment_metadata) {
            console.log(`        Metadata: ${safePreview(payment.payment_metadata, 400)}`)
          }
        })
      }
    }

    if (includeAuditLogs) {
      const { data: auditRows, error: auditError } = await supabase
        .from('audit_logs')
        .select('id, operation_type, operation_status, created_at, additional_info')
        .eq('resource_type', 'table_booking')
        .eq('resource_id', booking.id)
        .order('created_at', { ascending: false })
        .limit(5)

      if (auditError) {
        markFailure(`Error fetching audit logs for booking ${booking.booking_reference || booking.id}.`, auditError)
      } else {
        const auditLogs = (auditRows ?? []) as Array<{
          id: string
          operation_type: string | null
          operation_status: string | null
          created_at: string | null
          additional_info: unknown
        }>
        if (auditLogs.length > 0) {
          console.log(`   🧾 Audit logs (sample ${auditLogs.length}):`)
          auditLogs.forEach((row) => {
            console.log(
              `      - ${row.operation_type || 'unknown'} (${row.operation_status || 'unknown'}) at ${row.created_at ? new Date(row.created_at).toLocaleString() : 'unknown'}`
            )
          })
        }
      }
    }
  }

  console.log('\n🔍 Checking for orphaned payment records (sample):')
  const { data: recentPaymentsRows, error: recentPaymentsError } = await supabase
    .from('table_booking_payments')
    .select('id, amount, status, created_at, booking_id, table_bookings(booking_reference, status)')
    .order('created_at', { ascending: false })
    .limit(Math.min(limit * 2, PAYMENT_SAMPLE_HARD_CAP))

  const recentPayments = (assertScriptQuerySucceeded({
    operation: 'Load recent payment records (with booking join)',
    error: recentPaymentsError,
    data: recentPaymentsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    amount: number | null
    status: string | null
    created_at: string | null
    booking_id: string | null
    table_bookings: { booking_reference: string | null; status: string | null } | null
  }>

  let orphanedCount = 0
  recentPayments.forEach((payment) => {
    if (!payment.table_bookings) {
      orphanedCount += 1
      console.log(`   ⚠️  Orphaned payment: ${payment.id}`)
      console.log(`      Booking ID: ${payment.booking_id || 'unknown'}`)
      console.log(`      Amount: £${payment.amount ?? 0}`)
      console.log(`      Status: ${payment.status || 'unknown'}`)
      console.log(
        `      Created: ${payment.created_at ? new Date(payment.created_at).toLocaleString() : 'unknown'}`
      )
    }
  })

  if (orphanedCount === 0) {
    console.log('   ✅ No orphaned payments found in sample')
  }

  const pendingCount = bookings.filter((b) => b.status === 'pending_payment').length
  const confirmedCount = bookings.filter((b) => b.status === 'confirmed').length

  console.log('\n📊 Summary (sample):')
  console.log(`   - ${pendingCount} booking(s) awaiting payment`)
  console.log(`   - ${confirmedCount} booking(s) confirmed`)
  console.log(`   - ${orphanedCount} orphaned payment record(s) (sample)`)
}

void checkRecentPayments().catch((error) => {
  markFailure('check-payment-status failed.', error)
})

