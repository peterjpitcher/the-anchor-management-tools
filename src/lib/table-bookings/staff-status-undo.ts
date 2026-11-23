import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { checkNoShowCanComeBack, type ReinstateBooking } from '@/lib/table-bookings/reinstate-check'

/**
 * Undo for the three one-tap floor actions: Seated, Left and No-show (owner decision, 22 November
 * 2026). The floor iPad shows a 10 second Undo instead of a confirm box, so each action answers
 * with an undo ticket and this puts the booking back exactly as it was.
 *
 * Every undo is guarded on the stamp the action itself wrote (seated_at, left_at, no_show_at), so
 * an undo that arrives after somebody else has changed the booking does nothing and says so.
 *
 * Left is the one that needs care. Marking a party as left cuts the booking end and its table
 * times back to the moment of the tap, which frees the table. Re-seating never gave that time
 * back. The left route now reports the ends it replaced, and the undo restores them, but only if
 * nobody else has been given the table meanwhile: a clash is refused, never double-booked.
 */

const isoStamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid time')

export const staffStatusUndoSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('seated'), stamp: isoStamp }),
  z.object({
    action: z.literal('left'),
    stamp: isoStamp,
    restore: z.object({
      end_datetime: isoStamp.nullable(),
      assignments: z.array(z.object({ table_id: z.string().uuid(), end_datetime: isoStamp })).max(12),
    }),
  }),
  z.object({
    action: z.literal('no_show'),
    stamp: isoStamp.optional(),
    previous_status: z.enum(['confirmed', 'pending_payment']).optional(),
  }),
])

export type StaffStatusUndo = z.infer<typeof staffStatusUndoSchema>

export type LeftRestore = Extract<StaffStatusUndo, { action: 'left' }>['restore']

export type StaffStatusUndoResult =
  | { ok: true; booking: Record<string, unknown> }
  | { ok: false; status: 404 | 409 | 500; error: string }

const BOOKING_SNAPSHOT = 'id, status, seated_at, left_at, no_show_at, cancelled_at, end_datetime, updated_at'
const CLOSED_STATUSES = ['cancelled', 'no_show', 'completed']
/** A restored end further ahead than this is not a sitting, it is a mistake or a forged request. */
const MAX_RESTORE_AHEAD_MS = 12 * 60 * 60 * 1000

export const UNDO_CHANGED_ERROR = 'This booking has changed since then, so it was not undone. Check it on the timeline.'
export const UNDO_TABLE_TAKEN_ERROR_PREFIX = 'Could not undo:'

type Db = SupabaseClient<any, 'public', any>

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  const aMs = a ? Date.parse(a) : Number.NaN
  const bMs = b ? Date.parse(b) : Number.NaN
  return Number.isFinite(aMs) && aMs === bMs
}

function logFailure(message: string, error: unknown, bookingId: string): void {
  logger.error(message, {
    error: new Error(String((error as { message?: unknown } | null)?.message ?? error)),
    metadata: { bookingId },
  })
}

/**
 * The ends a 'left' is about to replace, read before anything is shortened. Only the table times
 * that the leave will actually cut (started, not yet ended) are listed, the same rows
 * shortenAssignmentsOnLeave touches. A failed read answers with no table times: the party still
 * leaves, and the undo then restores the booking end only.
 */
export async function readLeftRestore(
  supabase: Db,
  bookingId: string,
  plannedEndIso: string | null | undefined,
  nowIso: string
): Promise<LeftRestore> {
  const restore: LeftRestore = { end_datetime: plannedEndIso ?? null, assignments: [] }
  try {
    const { data, error } = await supabase
      .from('booking_table_assignments')
      .select('table_id, end_datetime')
      .eq('table_booking_id', bookingId)
      .lt('start_datetime', nowIso)
      .gt('end_datetime', nowIso)
    if (error) {
      logFailure('Could not read table times before marking a booking as left', error, bookingId)
      return restore
    }
    for (const row of (data ?? []) as Array<{ table_id?: unknown; end_datetime?: unknown }>) {
      if (typeof row.table_id === 'string' && typeof row.end_datetime === 'string') {
        restore.assignments.push({ table_id: row.table_id, end_datetime: new Date(row.end_datetime).toISOString() })
      }
    }
  } catch (error) {
    logFailure('Could not read table times before marking a booking as left', error, bookingId)
  }
  return restore
}

async function undoSeated(supabase: Db, bookingId: string, stamp: string, nowIso: string): Promise<StaffStatusUndoResult> {
  const { data, error } = await supabase
    .from('table_bookings')
    .update({ seated_at: null, updated_at: nowIso })
    .eq('id', bookingId)
    .eq('seated_at', stamp)
    .is('left_at', null)
    .not('status', 'in', `(${CLOSED_STATUSES.map((status) => `"${status}"`).join(',')})`)
    .select(BOOKING_SNAPSHOT)
    .maybeSingle()

  if (error) {
    logFailure('Could not undo seating a booking', error, bookingId)
    return { ok: false, status: 500, error: 'Could not undo. The booking is still marked as seated.' }
  }
  if (!data) return { ok: false, status: 409, error: UNDO_CHANGED_ERROR }
  return { ok: true, booking: data }
}

type AssignmentRow = { table_id: string; start_datetime: string; end_datetime: string }

/** The booking now holding one of these tables in the time being given back, if there is one. */
async function findClash(
  supabase: Db,
  bookingId: string,
  extensions: Array<{ table_id: string; from: string; to: string }>
): Promise<{ clash: string | null; failed: boolean }> {
  if (extensions.length === 0) return { clash: null, failed: false }
  const earliest = extensions.reduce((min, slot) => (slot.from < min ? slot.from : min), extensions[0].from)
  const latest = extensions.reduce((max, slot) => (slot.to > max ? slot.to : max), extensions[0].to)

  const { data: others, error: othersError } = await supabase
    .from('booking_table_assignments')
    .select('table_id, table_booking_id, start_datetime, end_datetime')
    .in('table_id', Array.from(new Set(extensions.map((slot) => slot.table_id))))
    .neq('table_booking_id', bookingId)
    .lt('start_datetime', latest)
    .gt('end_datetime', earliest)
  if (othersError) {
    logFailure('Could not read other bookings on a table before undoing a leave', othersError, bookingId)
    return { clash: null, failed: true }
  }

  const overlapping = ((others ?? []) as Array<Record<string, unknown>>).filter((row) =>
    extensions.some(
      (slot) =>
        slot.table_id === row.table_id
        && Date.parse(String(row.start_datetime)) < Date.parse(slot.to)
        && Date.parse(String(row.end_datetime)) > Date.parse(slot.from)
    )
  )
  const otherIds = Array.from(
    new Set(overlapping.map((row) => row.table_booking_id).filter((id): id is string => typeof id === 'string'))
  )
  if (otherIds.length === 0) return { clash: null, failed: false }

  const { data: otherBookings, error: otherBookingsError } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, status, left_at')
    .in('id', otherIds)
  if (otherBookingsError) {
    logFailure('Could not read the bookings sharing a table before undoing a leave', otherBookingsError, bookingId)
    return { clash: null, failed: true }
  }

  const live = ((otherBookings ?? []) as Array<Record<string, unknown>>).find(
    (row) => !CLOSED_STATUSES.includes(String(row.status)) && !row.left_at
  )
  if (!live) return { clash: null, failed: false }
  const reference = typeof live.booking_reference === 'string' && live.booking_reference ? live.booking_reference : 'another booking'
  return { clash: reference, failed: false }
}

function tableTakenError(reference: string | null): string {
  // With no reference the database refused the time: another party, or a private hire.
  const why = reference
    ? `the table has been given to ${reference} since this party was marked as left`
    : 'the table is no longer free for the rest of that booking (another booking or a private hire has it)'
  return `${UNDO_TABLE_TAKEN_ERROR_PREFIX} ${why}. The booking is still marked as left. Move one of them first, then seat this party again.`
}

async function undoLeft(
  supabase: Db,
  bookingId: string,
  undo: Extract<StaffStatusUndo, { action: 'left' }>,
  nowIso: string
): Promise<StaffStatusUndoResult> {
  const { data: booking, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id, status, left_at, end_datetime')
    .eq('id', bookingId)
    .maybeSingle()
  if (bookingError) {
    logFailure('Could not read a booking before undoing a leave', bookingError, bookingId)
    return { ok: false, status: 500, error: 'Could not undo. The booking is still marked as left.' }
  }
  if (!booking) return { ok: false, status: 404, error: 'Booking not found' }
  if (!sameInstant(booking.left_at, undo.stamp) || CLOSED_STATUSES.includes(String(booking.status))) {
    return { ok: false, status: 409, error: UNDO_CHANGED_ERROR }
  }

  const nowMs = Date.parse(nowIso)
  // Only ever lengthen, and never further than a sitting could run: the ends come back from the
  // screen, so they are checked rather than trusted.
  const restorable = (candidateIso: string | null | undefined, currentIso: string | null | undefined): string | null => {
    const candidateMs = candidateIso ? Date.parse(candidateIso) : Number.NaN
    const currentMs = currentIso ? Date.parse(currentIso) : Number.NaN
    if (!Number.isFinite(candidateMs) || !Number.isFinite(currentMs)) return null
    if (candidateMs <= currentMs || candidateMs > nowMs + MAX_RESTORE_AHEAD_MS) return null
    return new Date(candidateMs).toISOString()
  }

  const { data: mine, error: mineError } = await supabase
    .from('booking_table_assignments')
    .select('table_id, start_datetime, end_datetime')
    .eq('table_booking_id', bookingId)
  if (mineError) {
    logFailure('Could not read table times before undoing a leave', mineError, bookingId)
    return { ok: false, status: 500, error: 'Could not check the table is still free, so nothing was undone. The booking is still marked as left.' }
  }

  const current = ((mine ?? []) as AssignmentRow[]).filter(
    (row) => typeof row?.table_id === 'string' && typeof row?.end_datetime === 'string'
  )
  const extensions: Array<{ table_id: string; from: string; to: string }> = []
  for (const row of current) {
    const wanted = undo.restore.assignments.find((entry) => entry.table_id === row.table_id)
    const to = restorable(wanted?.end_datetime, row.end_datetime)
    if (to) extensions.push({ table_id: row.table_id, from: new Date(row.end_datetime).toISOString(), to })
  }

  const { clash, failed } = await findClash(supabase, bookingId, extensions)
  if (failed) {
    return { ok: false, status: 500, error: 'Could not check the table is still free, so nothing was undone. The booking is still marked as left.' }
  }
  if (clash) return { ok: false, status: 409, error: tableTakenError(clash) }

  const applied: typeof extensions = []
  const rollBack = async () => {
    for (const slot of applied) {
      const { error } = await supabase
        .from('booking_table_assignments')
        .update({ end_datetime: slot.from })
        .eq('table_booking_id', bookingId)
        .eq('table_id', slot.table_id)
      if (error) logFailure('Could not put a table time back after a failed undo of a leave', error, bookingId)
    }
  }

  for (const slot of extensions) {
    const { error } = await supabase
      .from('booking_table_assignments')
      .update({ end_datetime: slot.to })
      .eq('table_booking_id', bookingId)
      .eq('table_id', slot.table_id)
    if (error) {
      // The database refuses an overlap with another party or a private hire. Nothing is left
      // half restored.
      logFailure('The table times could not be restored when undoing a leave', error, bookingId)
      await rollBack()
      return { ok: false, status: 409, error: tableTakenError(null) }
    }
    applied.push(slot)
  }

  const restoredEnd = restorable(undo.restore.end_datetime, booking.end_datetime)
  const { data, error } = await supabase
    .from('table_bookings')
    .update({ left_at: null, ...(restoredEnd ? { end_datetime: restoredEnd } : {}), updated_at: nowIso })
    .eq('id', bookingId)
    .eq('left_at', undo.stamp)
    .eq('status', booking.status)
    .select(BOOKING_SNAPSHOT)
    .maybeSingle()

  if (error || !data) {
    if (error) logFailure('Could not undo marking a booking as left', error, bookingId)
    await rollBack()
    return error
      ? { ok: false, status: 500, error: 'Could not undo. The booking is still marked as left.' }
      : { ok: false, status: 409, error: UNDO_CHANGED_ERROR }
  }
  return { ok: true, booking: data }
}

/**
 * What a no-show goes back to. Worked out from the booking itself, not from what the screen sent:
 * only the Undo bar right after the tap still knows the earlier status, and the day's no-show list
 * and the booking panel do not. A booking still waiting for its deposit carries payment_status
 * 'pending' (a confirmed one never does), and it must go back to pending_payment so the deposit
 * timeout job still sees it (Codex review on PR 400).
 */
export function statusBeforeNoShow(booking: { payment_status?: string | null; deposit_waived?: boolean | null }): 'confirmed' | 'pending_payment' {
  return booking.payment_status === 'pending' && booking.deposit_waived !== true ? 'pending_payment' : 'confirmed'
}

async function undoNoShow(
  supabase: Db,
  bookingId: string,
  undo: Extract<StaffStatusUndo, { action: 'no_show' }>,
  nowIso: string
): Promise<StaffStatusUndoResult> {
  const { data: booking, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id, status, payment_status, deposit_waived, party_size, committed_party_size, booking_type, no_show_at, event_booking_id')
    .eq('id', bookingId)
    .maybeSingle()
  if (bookingError) {
    logFailure('Could not read a booking before undoing a no-show', bookingError, bookingId)
    return { ok: false, status: 500, error: 'Could not undo. The booking is still a no-show.' }
  }
  if (!booking) return { ok: false, status: 404, error: 'Booking not found' }
  if (booking.status !== 'no_show' || (undo.stamp && !sameInstant(booking.no_show_at, undo.stamp))) {
    return { ok: false, status: 409, error: UNDO_CHANGED_ERROR }
  }

  // An event guest's ticket and table are marked together, from the event (BK-074).
  if (booking.event_booking_id) {
    return { ok: false, status: 409, error: 'This table is tied to an event booking. Put it back from the event.' }
  }

  // The same checks as putting any no-show back: its table still free, its deposit still held.
  const problem = await checkNoShowCanComeBack(supabase, booking as ReinstateBooking)
  if (problem) return { ok: false, status: 409, error: problem }

  const { data, error } = await supabase
    .from('table_bookings')
    .update({
      status: statusBeforeNoShow(booking),
      no_show_at: null,
      no_show_marked_at: null,
      no_show_marked_by: null,
      updated_at: nowIso,
    })
    .eq('id', bookingId)
    .eq('status', 'no_show')
    .select(BOOKING_SNAPSHOT)
    .maybeSingle()

  if (error) {
    logFailure('Could not undo a no-show', error, bookingId)
    return { ok: false, status: 500, error: 'Could not undo. The booking is still a no-show.' }
  }
  if (!data) return { ok: false, status: 409, error: UNDO_CHANGED_ERROR }
  return { ok: true, booking: data }
}

export async function undoStaffStatusAction(
  supabase: Db,
  bookingId: string,
  undo: StaffStatusUndo,
  nowIso: string
): Promise<StaffStatusUndoResult> {
  if (undo.action === 'seated') return undoSeated(supabase, bookingId, undo.stamp, nowIso)
  if (undo.action === 'left') return undoLeft(supabase, bookingId, undo, nowIso)
  return undoNoShow(supabase, bookingId, undo, nowIso)
}
