import type { SupabaseClient } from '@supabase/supabase-js'
import { buildStaffStatusTransitionPlan, type StaffStatusBooking } from '@/lib/table-bookings/staff-status-actions'

/**
 * Marking a table booking a no-show: the one place it is written, for the floor's No-show button,
 * the 'Still open from earlier' strip and the end-of-day sweep (owner decision, 22 November 2026),
 * so an automatic no-show can never drift from one a person marks. The back-of-house status route
 * builds the same plan through buildStaffStatusTransitionPlan.
 *
 * What a no-show does, in full: the booking's status becomes no_show and the time and the person
 * are stamped (nobody, for the sweep). In the database, the customer's no-show tally goes up by
 * one. Nothing else: no refund, no charge, no message. A deposit already paid stays where it is
 * until a person refunds it from the booking.
 *
 * The write is guarded on the status the caller read, so a booking somebody changed in between is
 * reported as changed, not overwritten. The caller writes its own audit row: only it knows who
 * acted and from where.
 */

export type MarkNoShowResult<Row> =
  | { ok: true; row: Row }
  | { ok: false; kind: 'refused'; status: 409; error: string }
  | { ok: false; kind: 'write_failed'; message: string }
  | { ok: false; kind: 'changed' }

export async function markTableBookingNoShow<Row = Record<string, unknown>>(
  // `any` as in src/lib/foh/bookings.ts: the session and admin clients are typed differently.
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    booking: StaffStatusBooking & { id: string }
    nowIso: string
    /** The staff member, or null when no person did it (the end-of-day sweep). */
    markedBy: string | null
    /** Also refuse when an arrival or a no-show has been recorded since the booking was read. */
    requireNoOutcome?: boolean
  }
): Promise<MarkNoShowResult<Row>> {
  const { booking } = input
  const transition = buildStaffStatusTransitionPlan({
    action: 'no_show',
    booking,
    nowIso: input.nowIso,
    noShowMarkedBy: input.markedBy,
  })
  if (!transition.ok) {
    return { ok: false, kind: 'refused', status: transition.status, error: transition.error }
  }

  let query = supabase.from('table_bookings')
    .update(transition.plan.update)
    .eq('id', booking.id)
    .eq('status', booking.status)
  if (input.requireNoOutcome) {
    query = query.is('seated_at', null).is('no_show_at', null)
  }
  const { data, error } = await query
    .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
    .maybeSingle()

  if (error) {
    return { ok: false, kind: 'write_failed', message: String((error as { message?: unknown }).message ?? error) }
  }
  if (!data) {
    return { ok: false, kind: 'changed' }
  }
  return { ok: true, row: data as Row }
}
