#!/usr/bin/env tsx
/**
 * Backfill: align payment_status for cancelled parking bookings (dangerous).
 *
 * - pending  -> failed
 * - paid     -> refunded
 *
 * Updates the latest payment record to mirror the new status with cancellation metadata.
 *
 * Safety:
 * - Dry-run by default.
 * - Mutations require multi-gating + explicit caps.
 * - Fails closed (non-zero exit) on any env/query/update error.
 *
 * Usage:
 *   # Dry-run (default)
 *   scripts/backfill/cancelled-parking.ts [--limit 25] [--booking-id <uuid>]
 *
 *   # Mutation (dangerous)
 *   RUN_PARKING_CANCELLED_BACKFILL_MUTATION=true ALLOW_PARKING_CANCELLED_BACKFILL_SCRIPT=true \\
 *     scripts/backfill/cancelled-parking.ts --confirm --limit 50
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'cancelled-parking-backfill'
const RUN_MUTATION_ENV = 'RUN_PARKING_CANCELLED_BACKFILL_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_PARKING_CANCELLED_BACKFILL_SCRIPT'

const DEFAULT_LIMIT = 25
const HARD_CAP = 500

type ParkingPaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed' | 'expired'
type ParkingBookingRow = {
  id: string
  status: string
  payment_status: ParkingPaymentStatus
  cancelled_at: string | null
  created_at: string | null
}

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=').slice(1).join('=') || null
  }

  const idx = argv.findIndex((arg) => arg === flag)
  if (idx === -1) {
    return null
  }

  const value = argv[idx + 1]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
  bookingId: string | null
}

function parseArgs(argv: string[] = process.argv.slice(2)): Args {
  const confirm = argv.includes('--confirm')
  const dryRun = !confirm || argv.includes('--dry-run')

  const bookingId = readOptionalFlagValue(argv, '--booking-id')
  const limitRaw = readOptionalFlagValue(argv, '--limit')
  const limit = parsePositiveInt(limitRaw)

  if (limit !== null && limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }

  return { confirm, dryRun, limit, bookingId }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  dotenv.config({ path: path.resolve(process.cwd(), '.env') })

  const args = parseArgs(process.argv.slice(2))
  const mutationEnabled = !args.dryRun

  const queryLimit = Math.min(args.limit ?? (args.bookingId ? 1 : DEFAULT_LIMIT), HARD_CAP)

  console.log(`[${SCRIPT_NAME}] Mode: ${mutationEnabled ? 'MUTATION (dangerous)' : 'DRY RUN (safe)'}`)
  console.log(`[${SCRIPT_NAME}] bookingId: ${args.bookingId ?? '(none)'}`)
  console.log(`[${SCRIPT_NAME}] limit: ${queryLimit}${args.limit ? '' : ' (default)'} (hard cap ${HARD_CAP})`)

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  let query = supabase
    .from('parking_bookings')
    .select('id, status, payment_status, cancelled_at, created_at')
    .eq('status', 'cancelled')
    .in('payment_status', ['pending', 'paid'])
    .order('created_at', { ascending: false })
    .limit(queryLimit)

  if (args.bookingId) {
    query = query.eq('id', args.bookingId)
  }

  const { data: bookings, error: fetchError } = await query

  const resolvedBookings =
    assertScriptQuerySucceeded({
      operation: `[${SCRIPT_NAME}] Load cancelled parking bookings`,
      error: fetchError,
      data: (bookings ?? null) as ParkingBookingRow[] | null,
      allowMissing: true,
    }) ?? []

  if (args.bookingId && resolvedBookings.length === 0) {
    throw new Error(`[${SCRIPT_NAME}] booking not found: ${args.bookingId}`)
  }

  if (resolvedBookings.length === 0) {
    console.log(`[${SCRIPT_NAME}] No cancelled bookings with pending/paid payment status found.`)
    return
  }

  console.log(`[${SCRIPT_NAME}] Candidates: ${resolvedBookings.length}`)
  for (const booking of resolvedBookings.slice(0, 10)) {
    const target: ParkingPaymentStatus = booking.payment_status === 'paid' ? 'refunded' : 'failed'
    console.log(
      `- booking=${booking.id} status=${booking.status} payment_status=${booking.payment_status} -> ${target}`
    )
  }

  if (!mutationEnabled) {
    console.log(`\n[${SCRIPT_NAME}] DRY RUN complete. No rows updated.`)
    console.log(`[${SCRIPT_NAME}] To run mutations (dangerous), you must:`)
    console.log(`- Pass --confirm`)
    console.log(`- Set ${RUN_MUTATION_ENV}=true`)
    console.log(`- Set ${ALLOW_MUTATION_ENV}=true`)
    console.log(`- Provide an explicit cap via --limit <n> (hard cap ${HARD_CAP}) or --booking-id <uuid>`)
    return
  }

  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  }

  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: RUN_MUTATION_ENV })
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  if (!args.bookingId && !args.limit) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP}) or --booking-id <uuid>`)
  }

  const planned = args.bookingId ? resolvedBookings : resolvedBookings.slice(0, args.limit as number)

  let bookingUpdates = 0
  let paymentStatusUpdates = 0
  let paymentMetadataUpdates = 0
  const failures: string[] = []

  for (const booking of planned) {
    try {
      const targetPaymentStatus: ParkingPaymentStatus =
        booking.payment_status === 'paid' ? 'refunded' : 'failed'

      const bookingUpdate: Record<string, unknown> = {
        payment_status: targetPaymentStatus,
        cancelled_at: booking.cancelled_at ?? nowIso,
      }

      const { data: updatedBookingRows, error: bookingError } = await supabase
        .from('parking_bookings')
        .update(bookingUpdate)
        .eq('id', booking.id)
        .select('id')

      const { updatedCount: updatedBookingCount } = assertScriptMutationSucceeded({
        operation: `[${SCRIPT_NAME}] Update parking_bookings booking=${booking.id}`,
        error: bookingError,
        updatedRows: updatedBookingRows,
        allowZeroRows: false,
      })

      assertScriptExpectedRowCount({
        operation: `[${SCRIPT_NAME}] Update parking_bookings booking=${booking.id}`,
        expected: 1,
        actual: updatedBookingCount,
      })

      bookingUpdates += 1

      const { data: payment, error: paymentLookupError } = await supabase
        .from('parking_booking_payments')
        .select('id, status, metadata, created_at')
        .eq('booking_id', booking.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const resolvedPayment = assertScriptQuerySucceeded<{
        id: string
        status: ParkingPaymentStatus
        metadata: Record<string, unknown> | null
      }>({
        operation: `[${SCRIPT_NAME}] Load latest parking payment for booking=${booking.id}`,
        error: paymentLookupError,
        data: payment as { id: string; status: ParkingPaymentStatus; metadata: Record<string, unknown> | null } | null,
      })

      if (!resolvedPayment) {
        throw new Error(`No payment row found for booking ${booking.id}`)
      }

      const paymentUpdate: Record<string, unknown> = {
        metadata: {
          ...(resolvedPayment.metadata || {}),
          cancelled_booking: true,
          cancelled_at: nowIso,
        },
      }

      if (targetPaymentStatus === 'failed' && resolvedPayment.status === 'pending') {
        paymentUpdate.status = 'failed'
        paymentUpdate.updated_at = nowIso
      }

      if (targetPaymentStatus === 'refunded' && resolvedPayment.status === 'paid') {
        paymentUpdate.status = 'refunded'
        paymentUpdate.refunded_at = nowIso
      }

      const { data: updatedPaymentRows, error: payError } = await supabase
        .from('parking_booking_payments')
        .update(paymentUpdate)
        .eq('id', resolvedPayment.id)
        .select('id')

      const { updatedCount: updatedPaymentCount } = assertScriptMutationSucceeded({
        operation: `[${SCRIPT_NAME}] Update parking payment=${resolvedPayment.id} booking=${booking.id}`,
        error: payError,
        updatedRows: updatedPaymentRows,
        allowZeroRows: false,
      })

      assertScriptExpectedRowCount({
        operation: `[${SCRIPT_NAME}] Update parking payment=${resolvedPayment.id} booking=${booking.id}`,
        expected: 1,
        actual: updatedPaymentCount,
      })

      if (paymentUpdate.status) {
        paymentStatusUpdates += updatedPaymentCount
      } else {
        paymentMetadataUpdates += updatedPaymentCount
      }
    } catch (bookingError) {
      const message = bookingError instanceof Error ? bookingError.message : String(bookingError)
      failures.push(`booking ${booking.id}: ${message}`)
      console.error(`[${SCRIPT_NAME}] Failed booking=${booking.id}`, bookingError)
    }
  }

  console.log(`[${SCRIPT_NAME}] Bookings updated: ${bookingUpdates}`)
  console.log(`[${SCRIPT_NAME}] Payments updated: ${paymentStatusUpdates} (status changes)`)
  console.log(`[${SCRIPT_NAME}] Payments metadata-tagged: ${paymentMetadataUpdates}`)

  assertScriptCompletedWithoutFailures({
    scriptName: SCRIPT_NAME,
    failureCount: failures.length,
    failures,
  })
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

