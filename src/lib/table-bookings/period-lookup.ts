/**
 * Loading the seasonal period that applies to a date, once, for the routes that create bookings.
 *
 * The money is decided in the database, inside the create transaction, by
 * `resolve_table_booking_deposit`. This exists for the decisions a route has to make BEFORE it gets
 * there, chiefly whether to make a member of staff choose how the deposit is being taken. Those
 * decisions used to be made by a local copy of the rule that knew nothing about periods, so a
 * per-booking Mother's Day deposit would have been charged by the database while the front-of-house
 * screen believed no deposit was due and never asked for a payment method.
 *
 * It deliberately runs the SAME `resolveTableBookingDeposit` the settings preview and the website
 * endpoint run, so a difference between what staff are shown and what the guest is charged can only
 * come from the period row changing between the two reads, not from two implementations of a rule.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mapBookingPeriodRow,
  type BookingPeriod,
  type BookingPeriodRow,
} from './periods'
import { resolveTableBookingDeposit, type ResolvedDeposit } from './period-deposit'

const PERIOD_COLUMNS =
  'id, code, period_kind, name, starts_on, ends_on, guest_question, guest_blurb, ' +
  'requires_preorder, preorder_cutoff_days, deposit_basis, deposit_amount, refund_cutoff_days, ' +
  'min_party_size, max_party_size, min_notice_hours, legacy_booking_type, is_active, archived_at'

export type BookingPeriodContext = {
  /** The single live period covering the date, or null. Never an inactive or archived one. */
  period: BookingPeriod | null
  /** The `booking_period_deposits_enabled` kill switch. */
  collectPeriodDeposits: boolean
}

/**
 * Reads the kill switch. Defaults to ON, which is what the owner asked for.
 *
 * IT ALSO DEFAULTS TO ON WHEN THE READ FAILS, deliberately, because the database does. The SQL
 * resolver calls `get_setting_bool('booking_period_deposits_enabled', true)` and will charge. If
 * this returned false on a failed read, front of house would be told no deposit was due, would not
 * ask for cash or a payment link, and neither payment branch would run: the booking would sit in
 * pending_payment with no way to pay it until the 24-hour hold quietly expired and the table went
 * back. Guessing "off" is not the safe side when the layer that takes the money guesses "on".
 */
async function readDepositCollectionSwitch(supabase: SupabaseClient<any, any, any>): Promise<boolean> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'booking_period_deposits_enabled')
    .maybeSingle()

  if (error) {
    console.warn(
      '[periods] Could not read booking_period_deposits_enabled; assuming collection is ON, which is what the database assumes',
    )
    return true
  }

  // Stored wrapped, as {"value": true}. A bare boolean is honoured too, because a switch someone
  // has turned OFF must never read as ON just because the row was written in an older shape.
  const stored = data?.value ?? null
  if (typeof stored === 'boolean') return stored
  if (stored && typeof stored === 'object' && typeof (stored as { value?: unknown }).value === 'boolean') {
    return (stored as { value: boolean }).value
  }
  return true
}

/**
 * The live period covering `date`, plus the kill switch. Only ACTIVE, unarchived periods are ever
 * returned: an inactive period is completely inert, which is what makes the seeded but unpublished
 * Christmas period safe to ship.
 *
 * The database exclusion constraint guarantees at most one live period covers any date, so this is
 * a single row by construction rather than by optimism.
 */
export async function loadBookingPeriodContext(
  supabase: SupabaseClient<any, any, any>,
  date: string,
): Promise<BookingPeriodContext> {
  const [{ data: periodRow, error: periodError }, collectPeriodDeposits] = await Promise.all([
    supabase
      .from('booking_periods')
      .select(PERIOD_COLUMNS)
      .eq('is_active', true)
      .is('archived_at', null)
      .lte('starts_on', date)
      .gte('ends_on', date)
      .maybeSingle(),
    readDepositCollectionSwitch(supabase),
  ])

  if (periodError) throw periodError
  if (!periodRow) return { period: null, collectPeriodDeposits }

  const raw = periodRow as unknown as BookingPeriodRow

  const { data: menuRows, error: menuError } = await supabase
    .from('booking_period_menu_items')
    .select('id, course, name, description, price_gbp, allergens, sort_order, is_active')
    .eq('period_id', raw.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (menuError) throw menuError

  return {
    period: mapBookingPeriodRow({ ...raw, menu_items: menuRows ?? [] }),
    collectPeriodDeposits,
  }
}

/**
 * What the database is about to charge, worked out from the same inputs and the same rule.
 *
 * Returns null when the resolver refuses the request, which a route should treat as "do not
 * pre-judge this one", because the create RPC will refuse it too and with a better reason than a
 * route can invent.
 */
export function expectedDepositForCreate(input: {
  context: BookingPeriodContext
  partySize: number
  bookingDate: string
  periodAccepted: boolean
  depositWaived: boolean
}): ResolvedDeposit | null {
  const resolution = resolveTableBookingDeposit({
    partySize: input.partySize,
    bookingDate: input.bookingDate,
    period: input.periodAccepted ? input.context.period : null,
    periodAccepted: input.periodAccepted,
    depositWaived: input.depositWaived,
    collectPeriodDeposits: input.context.collectPeriodDeposits,
  })

  return resolution.ok ? resolution.deposit : null
}
