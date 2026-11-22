import type { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { AuditService } from '@/services/audit'
import { resolveTradingDayNow, type TradingDayInForce } from '@/lib/business-hours/trading-day'
import { hasUnpaidRequiredDeposit } from '@/lib/foh/bookings'
import { isEventLinkedTableBooking } from '@/lib/table-bookings/event-link'
import { markTableBookingNoShow } from '@/lib/table-bookings/no-show'
import { openOutcomeWindow } from '@/lib/table-bookings/open-outcomes'

/**
 * The end-of-day no-show sweep (owner decision, 22 November 2026: "Those at the top should drop
 * off at the end of the day. If people didn't show up, we just assume they didn't show up").
 *
 * Once a trading day has ended, every table booking for it that is still confirmed with no
 * outcome (nobody seated, nobody left, no no-show, not cancelled, not completed) is marked a
 * no-show, through the same code as the floor's No-show button (no-show.ts). It reverses the
 * 6 August 2026 decision against an overnight sweep.
 *
 * "Ended" is the trading-day rule, not midnight: on a night that runs past midnight the day in
 * force is still yesterday until its close, and its bookings are left alone until then. The job
 * runs every hour, so a day is swept within the hour after it ends, and a missed run is caught by
 * the next: it looks back the same seven days as the 'Still open from earlier' strip.
 *
 * Left alone:
 *  - a booking still waiting for its deposit (status pending_payment or pending_card_capture, or
 *    a confirmed booking whose required deposit is unpaid): the deposit timeout handles those;
 *  - the table half of an event booking: who came to an event is recorded on the event;
 *  - anything with an outcome, and anything a person changed while the sweep was running.
 *
 * When the opening hours cannot be read the sweep does nothing: the calendar date would sweep a
 * late night that is still running. Running it twice is safe: a booking it marked is no longer
 * confirmed, so the second run does not see it.
 */

type Db = ReturnType<typeof createAdminClient>

/** A ceiling on one run. The strip itself never lists more than this. */
export const NO_SHOW_SWEEP_MAX_PER_RUN = 200

export type NoShowSweepSkipReason = 'awaiting_deposit' | 'not_started' | 'changed'

export type NoShowSweepResult =
  | { state: 'held'; reason: 'hours_unreadable' }
  | {
      state: 'ran'
      tradingDay: string
      considered: number
      marked: number
      skipped: Partial<Record<NoShowSweepSkipReason, number>>
      /** Bookings that could not be marked, or were marked without an audit row. */
      errors: number
    }

export type NoShowSweepDeps = {
  db: Db
  now?: Date
  /** Defaults to the real opening hours; tests pass their own. */
  tradingDay?: (db: Db, now: Date) => Promise<TradingDayInForce & { unreadable?: true }>
}

type SweepRow = {
  id: string
  booking_reference: string | null
  customer_id: string | null
  status: string
  booking_date: string
  booking_time: string
  start_datetime: string | null
  end_datetime: string | null
  seated_at: string | null
  left_at: string | null
  no_show_at: string | null
  event_booking_id: string | null
  payment_status: string | null
  deposit_waived: boolean
  party_size: number | null
  committed_party_size: number | null
  paypal_deposit_capture_id: string | null
  booking_type: string | null
}

export async function runNoShowSweep(deps: NoShowSweepDeps): Promise<NoShowSweepResult> {
  const now = deps.now ?? new Date()
  const db = deps.db
  const inForce = await (deps.tradingDay ?? resolveTradingDayNow)(db, now)
  if (inForce.unreadable) {
    return { state: 'held', reason: 'hours_unreadable' }
  }

  const { fromIso, beforeIso } = openOutcomeWindow(inForce.date)
  const { data, error } = await db
    .from('table_bookings')
    .select(
      'id, booking_reference, customer_id, status, booking_date, booking_time, start_datetime, end_datetime, seated_at, left_at, no_show_at, event_booking_id, payment_status, deposit_waived, party_size, committed_party_size, paypal_deposit_capture_id, booking_type'
    )
    .eq('status', 'confirmed')
    .is('seated_at', null)
    .is('left_at', null)
    .is('no_show_at', null)
    .is('event_booking_id', null)
    .gte('booking_date', fromIso)
    .lt('booking_date', beforeIso)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(NO_SHOW_SWEEP_MAX_PER_RUN)
  if (error) throw new Error(`Could not read the bookings still open from earlier days: ${error.message}`)

  const rows = (data ?? []) as SweepRow[]
  const result: Extract<NoShowSweepResult, { state: 'ran' }> = {
    state: 'ran',
    tradingDay: inForce.date,
    considered: rows.length,
    marked: 0,
    skipped: {},
    errors: 0,
  }
  const skip = (reason: NoShowSweepSkipReason) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1
  }
  const nowIso = now.toISOString()

  for (const booking of rows) {
    // The query already leaves these out; checked again so the rule is stated in one place.
    if (isEventLinkedTableBooking(booking)) continue
    if (hasUnpaidRequiredDeposit(booking)) {
      skip('awaiting_deposit')
      continue
    }

    const marked = await markTableBookingNoShow(db, {
      booking,
      nowIso,
      markedBy: null,
      requireNoOutcome: true,
    })
    if (!marked.ok) {
      if (marked.kind === 'refused') {
        skip('not_started')
      } else if (marked.kind === 'changed') {
        skip('changed')
      } else {
        result.errors += 1
        logger.error('End-of-day sweep could not mark a table booking as a no-show', {
          error: new Error(marked.message),
          metadata: { tableBookingId: booking.id },
        })
      }
      continue
    }
    result.marked += 1

    try {
      await AuditService.logAuditEventOrThrow({
        // No user: nobody pressed anything. (The nil system id is refused by the audit log's
        // foreign key to auth.users.)
        operation_type: 'table_booking.no_show',
        resource_type: 'table_booking',
        resource_id: booking.id,
        operation_status: 'success',
        additional_info: {
          source: 'end_of_day_sweep',
          automatic: true,
          booking_date: booking.booking_date,
          trading_day: inForce.date,
          status_from: 'confirmed',
          status_to: 'no_show',
        },
      })
    } catch (auditError) {
      result.errors += 1
      logger.error('End-of-day sweep marked a no-show but could not write its audit row', {
        error: auditError instanceof Error ? auditError : new Error(String(auditError)),
        metadata: { tableBookingId: booking.id },
      })
    }
  }

  return result
}
