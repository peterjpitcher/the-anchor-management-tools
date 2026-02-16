#!/usr/bin/env tsx

/**
 * fix-pending-payment (safe by default)
 *
 * Intended use: manually reconcile a table booking that has a completed payment
 * but is stuck pending due to a return handler / webhook failure.
 *
 * Dry-run (default):
 *   tsx scripts/fixes/fix-pending-payment.ts TB-2025-0634
 *
 * Mutation mode (requires multi-gating):
 *   RUN_FIX_PENDING_PAYMENT_MUTATION=true \\
 *   ALLOW_FIX_PENDING_PAYMENT_MUTATION=true \\
 *     tsx scripts/fixes/fix-pending-payment.ts TB-2025-0634 --confirm --limit=1
 */

import { config } from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertFixPendingPaymentLimit,
  assertFixPendingPaymentMutationAllowed,
  assertFixPendingPaymentMutationSucceeded,
  readFixPendingPaymentLimit,
  resolveFixPendingPaymentRow
} from '../../src/lib/pending-payment-fix-safety'

config({ path: path.resolve(process.cwd(), '.env.local') })

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

type BookingRow = {
  id: string
  booking_reference: string
  status: string | null
  booking_date: string | null
  booking_time: string | null
  confirmed_at: string | null
  customer: {
    first_name: string | null
    last_name: string | null
  } | null
}

type PaymentRow = {
  id: string
  status: string | null
  amount: number | null
  transaction_id: string | null
  payment_metadata: Record<string, unknown> | null
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return TRUTHY.has(value.trim().toLowerCase())
}

function readArgValue(argv: string[], flag: string): string | null {
  const idx = argv.findIndex((arg) => arg === flag)
  if (idx !== -1) {
    const value = argv[idx + 1]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    const [, value] = eq.split('=', 2)
    return value && value.trim().length > 0 ? value.trim() : null
  }

  return null
}

function readBookingReference(argv: string[]): string | null {
  const fromFlag = readArgValue(argv, '--booking-ref') ?? readArgValue(argv, '--booking-reference')
  if (fromFlag) {
    return fromFlag
  }

  for (const arg of argv) {
    if (typeof arg === 'string' && !arg.startsWith('--')) {
      const trimmed = arg.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }

  return null
}

async function fixPendingPayment(
  bookingReference: string,
  params: { mutationEnabled: boolean }
): Promise<void> {
  const supabase = createAdminClient()
  const modeLabel = params.mutationEnabled ? 'MUTATION' : 'DRY-RUN'

  console.log(`🔧 fix-pending-payment (${modeLabel})`)
  console.log(`Booking reference: ${bookingReference}\n`)
  console.log('='.repeat(60))

  const { data: bookingData, error: bookingError } = await supabase
    .from('table_bookings')
    .select(`
      id,
      booking_reference,
      status,
      booking_date,
      booking_time,
      confirmed_at,
      customer:customers!table_bookings_customer_id_fkey(first_name, last_name)
    `)
    .eq('booking_reference', bookingReference)
    .maybeSingle()

  const booking = resolveFixPendingPaymentRow<BookingRow>({
    operation: `Load table booking by reference ${bookingReference}`,
    row: bookingData as BookingRow | null,
    error: bookingError
  })

  console.log('📌 Booking Details:')
  console.log(`   Reference: ${booking.booking_reference}`)
  console.log(`   Customer: ${booking.customer?.first_name || 'Unknown'} ${booking.customer?.last_name || ''}`.trim())
  console.log(`   Current Status: ${booking.status || 'unknown'}`)
  console.log(`   Date: ${booking.booking_date || '<unknown>'} at ${booking.booking_time || '<unknown>'}`)

  const { data: paymentData, error: paymentError } = await supabase
    .from('table_booking_payments')
    .select('id, status, amount, transaction_id, payment_metadata')
    .eq('booking_id', booking.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const payment = resolveFixPendingPaymentRow<PaymentRow>({
    operation: `Load latest payment for booking ${booking.id}`,
    row: paymentData as PaymentRow | null,
    error: paymentError
  })

  console.log('\n💳 Payment Record:')
  console.log(`   Status: ${payment.status || 'unknown'}`)
  console.log(`   Amount: £${payment.amount ?? 'unknown'}`)
  console.log(
    `   PayPal Order ID: ${
      (payment.payment_metadata as { paypal_order_id?: string } | null)?.paypal_order_id ||
      payment.transaction_id ||
      '<unknown>'
    }`
  )

  const paymentNeedsUpdate = payment.status !== 'completed'
  const bookingNeedsUpdate = booking.status !== 'confirmed'

  if (!paymentNeedsUpdate && !bookingNeedsUpdate) {
    console.log('\n✅ Booking is already confirmed and payment is completed')
    return
  }

  console.log('\n🔎 Proposed changes:')
  console.log(`   - Payment status -> completed: ${paymentNeedsUpdate}`)
  console.log(`   - Booking status -> confirmed: ${bookingNeedsUpdate}`)

  if (!params.mutationEnabled) {
    console.log(
      '\nDry-run mode: no rows updated. Re-run with --confirm --limit=1 RUN_FIX_PENDING_PAYMENT_MUTATION=true ALLOW_FIX_PENDING_PAYMENT_MUTATION=true to apply.'
    )
    return
  }

  assertFixPendingPaymentMutationAllowed()

  console.log('\n🔄 Applying booking/payment fix...')
  const mutationTimestamp = new Date().toISOString()

  if (paymentNeedsUpdate) {
    const { data: updatedPayment, error: paymentUpdateError } = await supabase
      .from('table_booking_payments')
      .update({
        status: 'completed',
        paid_at: mutationTimestamp,
        payment_metadata: {
          ...(payment.payment_metadata || {}),
          manually_confirmed: true,
          confirmed_at: mutationTimestamp,
          confirmed_reason: 'Manual fix - payment completed on PayPal'
        }
      })
      .eq('id', payment.id)
      .select('id')
      .maybeSingle()

    assertFixPendingPaymentMutationSucceeded({
      operation: `Mark payment ${payment.id} as completed`,
      error: paymentUpdateError,
      row: updatedPayment as { id?: string } | null
    })
    console.log('   ✅ Payment marked as completed')
  } else {
    console.log('   ℹ️ Payment already completed; skipping payment status mutation')
  }

  if (bookingNeedsUpdate) {
    const { data: updatedBooking, error: bookingUpdateError } = await supabase
      .from('table_bookings')
      .update({
        status: 'confirmed',
        confirmed_at: booking.confirmed_at || mutationTimestamp
      })
      .eq('id', booking.id)
      .select('id')
      .maybeSingle()

    assertFixPendingPaymentMutationSucceeded({
      operation: `Mark booking ${booking.id} as confirmed`,
      error: bookingUpdateError,
      row: updatedBooking as { id?: string } | null
    })
    console.log('   ✅ Booking marked as confirmed')
  } else {
    console.log('   ℹ️ Booking already confirmed; skipping booking status mutation')
  }

  const { data: auditRow, error: auditError } = await supabase
    .from('audit_logs')
    .insert({
      action: 'payment_confirmed',
      entity_type: 'table_booking',
      entity_id: booking.id,
      metadata: {
        booking_reference: booking.booking_reference,
        transaction_id: payment.transaction_id,
        amount: payment.amount,
        source: 'manual_fix',
        reason: 'Payment completed on PayPal but return handler failed',
        mutation_flags: {
          payment_status_updated: paymentNeedsUpdate,
          booking_status_updated: bookingNeedsUpdate
        }
      }
    })
    .select('id')
    .maybeSingle()

  assertFixPendingPaymentMutationSucceeded({
    operation: `Insert audit log for pending-payment fix on booking ${booking.id}`,
    error: auditError,
    row: auditRow as { id?: string } | null
  })

  console.log('   ✅ Audit log created')
  console.log('\n✅ Successfully fixed booking and payment')
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2)
  const bookingRef = readBookingReference(argv)
  const confirm = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const mutationEnabled =
    !dryRunOverride && confirm && isTruthyEnv(process.env.RUN_FIX_PENDING_PAYMENT_MUTATION)

  if (argv.includes('--help')) {
    console.log(`
fix-pending-payment (safe by default)

Dry-run (default):
  tsx scripts/fixes/fix-pending-payment.ts TB-2025-0634

Mutation mode (requires multi-gating):
  RUN_FIX_PENDING_PAYMENT_MUTATION=true \\
  ALLOW_FIX_PENDING_PAYMENT_MUTATION=true \\
    tsx scripts/fixes/fix-pending-payment.ts TB-2025-0634 --confirm --limit=1

Notes:
  - You can also pass --booking-ref=<ref> instead of a positional argument.
`)
    return
  }

  if (!bookingRef) {
    console.error(
      'Usage: tsx scripts/fixes/fix-pending-payment.ts <booking-reference> [--confirm --limit=1]'
    )
    console.error('Example: tsx scripts/fixes/fix-pending-payment.ts TB-2025-0634')
    process.exitCode = 1
    return
  }

  if (confirm && !mutationEnabled && !dryRunOverride) {
    throw new Error(
      'fix-pending-payment blocked: --confirm requires RUN_FIX_PENDING_PAYMENT_MUTATION=true and ALLOW_FIX_PENDING_PAYMENT_MUTATION=true.'
    )
  }

  if (mutationEnabled) {
    assertFixPendingPaymentLimit(readFixPendingPaymentLimit(argv, process.env))
  }

  if (!mutationEnabled) {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `Read-only mode${extra}. Re-run with --confirm --limit=1 RUN_FIX_PENDING_PAYMENT_MUTATION=true ALLOW_FIX_PENDING_PAYMENT_MUTATION=true to apply changes.`
    )
  } else {
    console.log('Mutation mode enabled for fix-pending-payment.')
  }

  await fixPendingPayment(bookingRef, { mutationEnabled })
}

run().catch((error) => {
  console.error('❌ fix-pending-payment script failed:', error)
  process.exitCode = 1
})
