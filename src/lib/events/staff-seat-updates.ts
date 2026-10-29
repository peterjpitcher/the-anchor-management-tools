import type { SupabaseClient } from '@supabase/supabase-js'
import { updateEventBookingSeatsById } from '@/lib/events/manage-booking'
import { sendEventBookingSeatUpdateSms } from '@/lib/events/event-payments'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { extractSmsSafetyInfo } from '@/lib/sms/safety-info'
import { logger } from '@/lib/logger'
import { CHRISTMAS_MAX_PARTY_SIZE, CHRISTMAS_MIN_PARTY_SIZE } from '@/lib/table-bookings/christmas'
import type { PreorderRemovedCover } from '@/lib/table-bookings/preorder'
import {
  getMoveTableAvailability,
  moveBookingAssignmentToTables,
} from '@/lib/table-bookings/move-table'

type SeatUpdateSmsMeta = {
  success: boolean
  code: string | null
  logFailure: boolean
}

export class ChristmasCourseValidationError extends Error {}

export const CHRISTMAS_LATE_MANAGER_MESSAGE =
  'The Christmas pre-order deadline has passed, so only a manager can change the numbers or courses on this booking now.'
export const CHRISTMAS_LATE_TIER_MESSAGE =
  'The Christmas pre-order deadline has passed. Guests can leave, or join on 1 course, but nobody can move up to more courses now.'
const CHRISTMAS_REMOVED_SEATS_MESSAGE =
  'Choose the guests who are leaving from the guests on this booking. Refresh and try again.'

/**
 * Where a Christmas date stands against its pre-order deadline: `open` before noon seven days out,
 * `closed` after it, `none` when the date has no Christmas course policy at all. A failed read is
 * refused rather than guessed, because guessing `open` would let a late change through unflagged.
 */
export async function readChristmasDeadline(
  supabase: SupabaseClient<any, 'public', any>,
  bookingDate: string | null | undefined,
): Promise<'open' | 'closed' | 'none'> {
  const { data: policy, error } = await supabase.rpc('christmas_course_policy_v01', { p_booking_date: bookingDate })
  if (error) {
    throw new ChristmasCourseValidationError('Could not check the Christmas pre-order deadline. Please try again.')
  }
  if (!policy) return 'none'
  return policy.multiple_courses_available === true ? 'open' : 'closed'
}

/**
 * New seat numbers (1-based) that a change after the deadline would put on more courses than the
 * guest had: a guest who stays moving up, or a guest joining on 2 or 3. The guests who stay are the
 * recorded seats minus `removedSeats`, in order, at the front of `next`; when nothing is named and
 * the party shrinks, the last seats go, as the trim from the end always did.
 */
export function christmasSeatsMovingUp(
  recorded: readonly number[] | null,
  next: readonly number[],
  removedSeats: readonly number[],
): number[] {
  const removed = new Set(removedSeats)
  const kept = (recorded ?? []).filter((_, index) => !removed.has(index + 1)).slice(0, next.length)
  return next
    .map((tier, index) => ({ seat: index + 1, tier, was: index < kept.length ? kept[index] : 1 }))
    .filter(({ tier, was }) => tier > was)
    .map(({ seat }) => seat)
}

export type UpdatedTableBookingRow = {
  id: string
  party_size: number | null
  committed_party_size: number | null
  updated_at: string | null
}

export type TableBookingSeatUpdateResult = {
  state: 'updated' | 'unchanged' | 'blocked'
  reason?: string
  table_booking_id: string
  event_booking_id: string | null
  old_party_size: number
  new_party_size: number
  delta: number
  sms_sent: boolean
  sms: SeatUpdateSmsMeta | null
  event_id: string | null
  auto_moved_table_ids?: string[] | null
  auto_moved_table_name?: string | null
  /** Row returned by the party-size UPDATE itself — callers should verify from this, not a re-read. */
  updated_booking?: UpdatedTableBookingRow | null
  /** A Christmas change made after the pre-order deadline by a manager (D21). */
  late_change?: boolean
  /** The Christmas guests removed by seat, with what they had chosen, so staff can tell the booker. */
  removed_covers?: PreorderRemovedCover[]
}

type ChangeChristmasPartyRow = {
  id?: string
  party_size?: number | null
  committed_party_size?: number | null
  updated_at?: string | null
  removed?: Array<{
    id: string
    ordinal: number
    guest_name: string | null
    courses?: Array<{ course: string; item_name: string }> | null
  }> | null
}

/**
 * Thrown when the party-size write fails AFTER an auto table move has already
 * committed. The message says whether the move was reverted so callers can
 * surface exactly what state the booking is in.
 */
export class PartySizeUpdateFailedAfterMoveError extends Error {
  readonly movedBack: boolean

  constructor(message: string, movedBack: boolean) {
    super(message)
    this.name = 'PartySizeUpdateFailedAfterMoveError'
    this.movedBack = movedBack
  }
}

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((id) => rightSet.has(id))
}

function normalizeThrownSmsSafety(error: unknown): { code: string; logFailure: boolean } {
  const { code: thrownCode, logFailure: thrownLogFailure } = extractSmsSafetyInfo(error)

  if (thrownLogFailure) {
    return {
      code: 'logging_failed',
      logFailure: true
    }
  }

  if (
    thrownCode === 'safety_unavailable'
    || thrownCode === 'idempotency_conflict'
  ) {
    return {
      code: thrownCode,
      logFailure: false
    }
  }

  return {
    code: 'safety_unavailable',
    logFailure: false
  }
}

async function getAssignedTableCapacity(
  supabase: SupabaseClient<any, 'public', any>,
  tableBookingId: string
): Promise<number | null> {
  const { data, error } = await supabase.from('booking_table_assignments')
    .select('table_id, tables(capacity)')
    .eq('table_booking_id', tableBookingId)

  if (error) {
    throw error
  }

  const rows = Array.isArray(data) ? data : []
  if (rows.length === 0) {
    return null
  }

  return rows.reduce((sum, row) => {
    const table = Array.isArray(row?.tables) ? row.tables[0] : row?.tables
    return sum + Math.max(0, Number(table?.capacity || 0))
  }, 0)
}

export function mapSeatUpdateBlockedReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'invalid_seats':
      return 'Party size must be at least 1.'
    case 'status_not_changeable':
      return 'This booking cannot be edited in its current status.'
    case 'event_started':
      return 'This event has already started.'
    case 'insufficient_capacity':
      return 'There are not enough seats available for that increase.'
    case 'table_capacity_insufficient':
      return 'No available table or joined-table setup can seat that party — tables in use for an event can’t be shared.'
    case 'table_move_unavailable':
      return 'The table setup changed. Refresh and try again.'
    case 'booking_not_found':
      return 'Booking was not found.'
    case 'event_not_found':
      return 'Event was not found.'
    case 'prepaid_paid_booking':
      // BK-023: point at what staff can actually do.
      return 'This booking has already been paid, so its size cannot be changed here. Open the booking on the event page and use Change tickets to add or remove guests.'
    case 'multi_ticket_type_booking':
      return 'This booking has more than one ticket type, so its size cannot be edited here. Open the booking on the event page and use Change tickets.'
    case 'guest_details_locked':
      return 'Each ticket on this booking has a named guest, so its size cannot be changed here. Open the booking on the event page and use Change tickets to add or remove a guest.'
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Booking could not be updated.'
  }
}

export async function updateTableBookingPartySizeWithLinkedEventSeats(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    tableBookingId: string
    partySize: number
    christmasCourseCounts?: number[]
    /**
     * Seats (1-based, as numbered now) of the Christmas guests who are leaving, so their own seat and
     * dishes go rather than the last guest's (BK-054). The guests who stay keep their order at the
     * front of `christmasCourseCounts`; anyone joining follows. Left out, a smaller party drops its
     * last seats, as it always did.
     */
    christmasRemovedSeats?: number[]
    /**
     * The course list the person saw when they chose who was leaving (an empty list when none was
     * recorded). Seat numbers only name the same guests while it still holds, so a change made against
     * guests that have changed since (another tab, another member of staff) is refused before anyone
     * is removed. Left out, the list read here is used, which still catches a change racing this one.
     */
    christmasExpectedCourses?: number[] | null
    /**
     * Asked only when a Christmas change lands after the pre-order deadline: may this person make a
     * late change (owner decision D21: a manager, table_bookings 'manage')? Left out means no.
     */
    canMakeLateChristmasChange?: () => Promise<boolean>
    actor?: string
    sendSms?: boolean
    appBaseUrl?: string
    autoMoveTable?: boolean
    /**
     * Optional staff-picked table setup for the auto-move (single-step
     * grow+move). Used when it matches an available option; otherwise the
     * smallest sufficient setup is chosen as before.
     */
    preferredTableIds?: string[]
  }
): Promise<TableBookingSeatUpdateResult> {
  const { data: tableBooking, error: tableBookingError } = await supabase.from('table_bookings')
    .select('*')
    .eq('id', input.tableBookingId)
    .maybeSingle()

  if (tableBookingError || !tableBooking?.id) {
    return {
      state: 'blocked',
      reason: 'booking_not_found',
      table_booking_id: input.tableBookingId,
      event_booking_id: null,
      old_party_size: 0,
      new_party_size: input.partySize,
      delta: 0,
      sms_sent: false,
      sms: null,
      event_id: null
    }
  }

  if (['cancelled', 'no_show'].includes(String(tableBooking.status || ''))) {
    return {
      state: 'blocked',
      reason: 'status_not_changeable',
      table_booking_id: tableBooking.id,
      event_booking_id: tableBooking.event_booking_id || null,
      old_party_size: Math.max(1, Number(tableBooking.party_size || 1)),
      new_party_size: Math.max(1, Number(tableBooking.party_size || 1)),
      delta: 0,
      sms_sent: false,
      sms: null,
      event_id: tableBooking.event_id || null
    }
  }

  const oldPartySize = Math.max(1, Number(tableBooking.party_size || 1))
  const newPartySize = Math.max(1, Number(input.partySize || 1))
  const recordedCourses: number[] | null = tableBooking.christmas_course_counts ?? null
  if (
    input.christmasExpectedCourses !== undefined &&
    JSON.stringify(input.christmasExpectedCourses ?? []) !== JSON.stringify(recordedCourses ?? [])
  ) {
    throw new ChristmasCourseValidationError('Christmas booking changed while you were editing it. Reload it and try again.')
  }
  const isChristmasBooking = String(tableBooking.booking_type || '') === 'christmas' || Boolean(recordedCourses)
  // A Christmas booking taken with no courses (a staff booking before BK-057) may have them set
  // ONCE, here, so its guests stop being chased for a main they may not owe. The same checks apply
  // as to a change, and the database trigger repeats them on the write.
  const recordingFirstCourses =
    !recordedCourses &&
    Boolean(input.christmasCourseCounts) &&
    String(tableBooking.booking_type || '') === 'christmas' &&
    tableBooking.booking_period_answer === true
  const nextCourses = recordedCourses
    ? (input.christmasCourseCounts ?? recordedCourses)
    : recordingFirstCourses
      ? input.christmasCourseCounts ?? null
      : null
  const removedSeats = Array.from(new Set(input.christmasRemovedSeats ?? [])).sort((a, b) => a - b)
  const coursesChanged = JSON.stringify(recordedCourses) !== JSON.stringify(nextCourses)
  const christmasChanged = isChristmasBooking && (oldPartySize !== newPartySize || coursesChanged || removedSeats.length > 0)
  let lateChristmasChange = false
  if (isChristmasBooking && christmasChanged) {
    // Before looking for or moving tables. The database repeats these checks on the final write.
    // Every Christmas amendment, with or without recorded courses, keeps to the 4 to 20 rule (BK-053).
    if (newPartySize < CHRISTMAS_MIN_PARTY_SIZE || newPartySize > CHRISTMAS_MAX_PARTY_SIZE) {
      throw new ChristmasCourseValidationError(`Christmas bookings are for ${CHRISTMAS_MIN_PARTY_SIZE} to ${CHRISTMAS_MAX_PARTY_SIZE} guests.`)
    }
  }
  if (nextCourses) {
    if (recordedCourses && !input.christmasCourseCounts && newPartySize < recordedCourses.length) {
      throw new ChristmasCourseValidationError('Tick the guests who are not coming before making a Christmas party smaller.')
    }
    if (nextCourses?.length !== newPartySize
        || nextCourses.some(course => !Number.isInteger(course) || course < 1 || course > 3)) {
      throw new ChristmasCourseValidationError('Choose one, two or three courses for every Christmas guest before changing the party size.')
    }
  } else if (input.christmasCourseCounts) {
    throw new ChristmasCourseValidationError('This booking retains its original course policy. Refresh before making changes.')
  }
  if (removedSeats.length > 0) {
    const seatCount = recordedCourses?.length ?? 0
    if (!recordedCourses || !nextCourses
        || removedSeats.some(seat => !Number.isInteger(seat) || seat < 1 || seat > seatCount)
        || nextCourses.length < seatCount - removedSeats.length) {
      throw new ChristmasCourseValidationError(CHRISTMAS_REMOVED_SEATS_MESSAGE)
    }
  }
  if (isChristmasBooking && christmasChanged) {
    const deadline = await readChristmasDeadline(supabase, tableBooking.booking_date)
    // Guest by guest after the deadline (D21): a guest may leave or join on 1 course, but nobody who
    // stays moves up and nobody joins on more than 1. No policy at all keeps the old rule that 2 or 3
    // courses cannot be chosen. change_christmas_party_v01 repeats this on the write.
    if (nextCourses && deadline !== 'open'
        && christmasSeatsMovingUp(recordedCourses, nextCourses, removedSeats).length > 0) {
      throw new ChristmasCourseValidationError(CHRISTMAS_LATE_TIER_MESSAGE)
    }
    // After the deadline the numbers are a manager's to change, and the change is flagged as late.
    if (deadline === 'closed') {
      const allowed = input.canMakeLateChristmasChange ? await input.canMakeLateChristmasChange() : false
      if (!allowed) {
        throw new ChristmasCourseValidationError(CHRISTMAS_LATE_MANAGER_MESSAGE)
      }
      lateChristmasChange = true
    }
  }
  let autoMovedTableIds: string[] | null = null
  let autoMovedTableName: string | null = null
  let autoMovedFromTableIds: string[] | null = null
  let autoMoveWindow: { startIso: string; endIso: string } | null = null

  if (!tableBooking.event_booking_id) {
    if (oldPartySize === newPartySize && !coursesChanged && removedSeats.length === 0) {
      return {
        state: 'unchanged',
        table_booking_id: tableBooking.id,
        event_booking_id: null,
        old_party_size: oldPartySize,
        new_party_size: oldPartySize,
        delta: 0,
        sms_sent: false,
        sms: null,
        event_id: tableBooking.event_id || null
      }
    }

    if (newPartySize > oldPartySize) {
      const assignedCapacity = await getAssignedTableCapacity(supabase, tableBooking.id)
      if (assignedCapacity !== null && assignedCapacity < newPartySize) {
        if (!input.autoMoveTable) {
          return {
            state: 'blocked',
            reason: 'table_capacity_insufficient',
            table_booking_id: tableBooking.id,
            event_booking_id: null,
            old_party_size: oldPartySize,
            new_party_size: oldPartySize,
            delta: 0,
            sms_sent: false,
            sms: null,
            event_id: tableBooking.event_id || null
          }
        }

        const availability = await getMoveTableAvailability(supabase, {
          id: tableBooking.id,
          booking_date: tableBooking.booking_date,
          booking_time: tableBooking.booking_time,
          start_datetime: tableBooking.start_datetime || null,
          end_datetime: tableBooking.end_datetime || null,
          duration_minutes: tableBooking.duration_minutes ?? null,
          party_size: newPartySize,
        })

        // Honour a staff-picked table setup when it is still available;
        // otherwise fall back to the smallest sufficient option as before.
        const preferredIds = Array.from(new Set(input.preferredTableIds || [])).filter(Boolean)
        const preferredTarget = preferredIds.length > 0
          ? availability.tables.find((table) => sameIdSet(table.table_ids, preferredIds)) || null
          : null
        const target = preferredTarget || availability.tables[0] || null

        if (!target) {
          return {
            state: 'blocked',
            reason: 'table_capacity_insufficient',
            table_booking_id: tableBooking.id,
            event_booking_id: null,
            old_party_size: oldPartySize,
            new_party_size: oldPartySize,
            delta: 0,
            sms_sent: false,
            sms: null,
            event_id: tableBooking.event_id || null
          }
        }

        const moveResult = await moveBookingAssignmentToTables(supabase, {
          bookingId: tableBooking.id,
          targetTableIds: target.table_ids,
          startIso: availability.startIso,
          endIso: availability.endIso,
          nowIso: new Date().toISOString(),
        })

        if (!moveResult.ok) {
          return {
            state: 'blocked',
            reason: moveResult.status === 409 ? 'table_move_unavailable' : 'table_capacity_insufficient',
            table_booking_id: tableBooking.id,
            event_booking_id: null,
            old_party_size: oldPartySize,
            new_party_size: oldPartySize,
            delta: 0,
            sms_sent: false,
            sms: null,
            event_id: tableBooking.event_id || null
          }
        }

        autoMovedTableIds = target.table_ids
        autoMovedTableName = target.name || null
        autoMovedFromTableIds = availability.assignedTableIds
        autoMoveWindow = { startIso: availability.startIso, endIso: availability.endIso }
      }
    }

    let updatedTableBooking: UpdatedTableBookingRow | null = null
    let tableUpdateError: unknown = null
    let removedCovers: PreorderRemovedCover[] = []
    if (nextCourses) {
      // One transaction for a Christmas party: the leaving guests' seats and dishes go, the guests who
      // stay close up their seat numbers, and the size and course list are saved, so dishes never
      // land on the wrong guest.
      const { data, error } = await supabase.rpc('change_christmas_party_v01', {
        p_booking_id: tableBooking.id,
        p_course_counts: nextCourses,
        p_removed_ordinals: removedSeats,
        // What this change was worked out against; the function refuses it if the guests moved since.
        p_expected_course_counts: recordedCourses ?? [],
      })
      tableUpdateError = error
      const row = (data ?? null) as ChangeChristmasPartyRow | null
      if (!error && row?.id) {
        updatedTableBooking = {
          id: String(row.id),
          party_size: row.party_size ?? null,
          committed_party_size: row.committed_party_size ?? null,
          updated_at: row.updated_at ?? null,
        }
        removedCovers = (row.removed ?? []).map((cover) => ({
          id: cover.id,
          ordinal: cover.ordinal,
          guestName: cover.guest_name,
          courses: (cover.courses ?? []).map((entry) => ({ course: entry.course, itemName: entry.item_name })),
        }))
      }
    } else {
      const nowIso = new Date().toISOString()
      const { data, error } = await supabase.from('table_bookings')
        .update({
          party_size: newPartySize,
          committed_party_size: newPartySize,
          updated_at: nowIso
        })
        .eq('id', tableBooking.id)
        .select('id, party_size, committed_party_size, updated_at')
        .maybeSingle()
      tableUpdateError = error
      updatedTableBooking = (data ?? null) as UpdatedTableBookingRow | null
    }

    if (tableUpdateError || !updatedTableBooking) {
      // The size write failed after an auto-move already committed: try to
      // move the booking back to its original tables so it is not left on a
      // bigger setup with the old party size, and say what happened.
      if (autoMovedTableIds && autoMovedFromTableIds && autoMovedFromTableIds.length > 0 && autoMoveWindow) {
        let movedBack = false
        try {
          const compensation = await moveBookingAssignmentToTables(supabase, {
            bookingId: tableBooking.id,
            targetTableIds: autoMovedFromTableIds,
            startIso: autoMoveWindow.startIso,
            endIso: autoMoveWindow.endIso,
            nowIso: new Date().toISOString(),
          })
          movedBack = compensation.ok
          if (!compensation.ok) {
            logger.warn('Failed to revert auto table move after party-size update failure', {
              metadata: {
                tableBookingId: tableBooking.id,
                movedToTableIds: autoMovedTableIds,
                originalTableIds: autoMovedFromTableIds,
                error: compensation.error,
              },
            })
          }
        } catch (compensationError) {
          logger.warn('Reverting auto table move threw after party-size update failure', {
            metadata: {
              tableBookingId: tableBooking.id,
              movedToTableIds: autoMovedTableIds,
              originalTableIds: autoMovedFromTableIds,
              error: compensationError instanceof Error ? compensationError.message : String(compensationError),
            },
          })
        }

        throw new PartySizeUpdateFailedAfterMoveError(
          movedBack
            ? 'The party size could not be saved, so the table move has been reverted. Please try again.'
            : 'The party size could not be saved, but the booking has already moved to the new tables. Please check the table assignment and try again.',
          movedBack
        )
      }

      if (tableUpdateError) {
        // The database's own Christmas refusals are written for the person making the change.
        const message = (tableUpdateError as { code?: string; message?: string }).message ?? ''
        if ((tableUpdateError as { code?: string }).code === '22023' && /^(Christmas|Choose the guests)/.test(message)) {
          throw new ChristmasCourseValidationError(message)
        }
        throw tableUpdateError
      }

      return {
        state: 'blocked',
        reason: 'booking_not_found',
        table_booking_id: tableBooking.id,
        event_booking_id: null,
        old_party_size: oldPartySize,
        new_party_size: oldPartySize,
        delta: 0,
        sms_sent: false,
        sms: null,
        event_id: tableBooking.event_id || null
      }
    }

    if (recordingFirstCourses && nextCourses) {
      // The courses are saved by now, so a failure here must not report the change as failed.
      try {
        await clearChoicesThatNoLongerFit(supabase, tableBooking.id, nextCourses)
      } catch (error) {
        logger.error('Christmas courses were recorded but earlier food choices that no longer fit were not cleared', {
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: { tableBookingId: tableBooking.id }
        })
      }
    }

    return {
      state: 'updated',
      table_booking_id: tableBooking.id,
      event_booking_id: null,
      old_party_size: oldPartySize,
      new_party_size: newPartySize,
      delta: newPartySize - oldPartySize,
      sms_sent: false,
      sms: null,
      event_id: tableBooking.event_id || null,
      auto_moved_table_ids: autoMovedTableIds,
      auto_moved_table_name: autoMovedTableName,
      updated_booking: {
        id: String(updatedTableBooking.id),
        party_size: updatedTableBooking.party_size ?? null,
        committed_party_size: updatedTableBooking.committed_party_size ?? null,
        updated_at: updatedTableBooking.updated_at ?? null
      },
      ...(lateChristmasChange ? { late_change: true } : {}),
      ...(removedCovers.length > 0 ? { removed_covers: removedCovers } : {})
    }
  }

  const bookingUpdate = await updateEventBookingSeatsById(supabase, {
    bookingId: tableBooking.event_booking_id,
    newSeats: newPartySize,
    actor: input.actor || 'staff'
  })

  if (bookingUpdate.state === 'blocked') {
    return {
      state: 'blocked',
      reason: bookingUpdate.reason || 'unavailable',
      table_booking_id: tableBooking.id,
      event_booking_id: tableBooking.event_booking_id,
      old_party_size: Math.max(1, Number(bookingUpdate.old_seats ?? oldPartySize)),
      new_party_size: Math.max(1, Number(bookingUpdate.new_seats ?? oldPartySize)),
      delta: Number(bookingUpdate.delta ?? 0),
      sms_sent: false,
      sms: null,
      event_id: bookingUpdate.event_id || tableBooking.event_id || null
    }
  }

  const oldSeats = Math.max(1, Number(bookingUpdate.old_seats ?? oldPartySize))
  const updatedSeats = Math.max(1, Number(bookingUpdate.new_seats ?? newPartySize))
  const delta = Number(bookingUpdate.delta ?? (updatedSeats - oldSeats))

  let syncedBookingRow: UpdatedTableBookingRow | null = null
  if (delta !== 0 || oldPartySize !== updatedSeats) {
    const nowIso = new Date().toISOString()
    const { data: syncedTableRows, error: tableUpdateError } = await supabase.from('table_bookings')
      .update({
        party_size: updatedSeats,
        committed_party_size: updatedSeats,
        updated_at: nowIso
      })
      .eq('event_booking_id', tableBooking.event_booking_id)
      .not('status', 'in', '(cancelled,no_show)')
      .select('id, party_size, committed_party_size, updated_at')

    if (tableUpdateError) {
      throw tableUpdateError
    }

    if (!Array.isArray(syncedTableRows) || syncedTableRows.length === 0) {
      throw new Error('Linked table-booking seat sync affected no rows')
    }

    const matchedRow = syncedTableRows.find((row) => row?.id === tableBooking.id) || null
    if (matchedRow) {
      syncedBookingRow = {
        id: String(matchedRow.id),
        party_size: matchedRow.party_size ?? null,
        committed_party_size: matchedRow.committed_party_size ?? null,
        updated_at: matchedRow.updated_at ?? null
      }
    }
  }

  let smsSent = false
  let sms: SeatUpdateSmsMeta | null = null
  if (input.sendSms !== false && delta !== 0 && bookingUpdate.booking_id) {
    try {
      const smsResult = await sendEventBookingSeatUpdateSms(supabase, {
        bookingId: bookingUpdate.booking_id,
        eventName: bookingUpdate.event_name || null,
        oldSeats,
        newSeats: updatedSeats,
        appBaseUrl: input.appBaseUrl
      })
      const smsCode = typeof smsResult.code === 'string' ? smsResult.code : null
      const smsLogFailure = smsResult.logFailure === true || smsCode === 'logging_failed'
      smsSent = smsResult.success === true
      sms = {
        success: smsResult.success === true,
        code: smsCode,
        logFailure: smsLogFailure
      }
    } catch (error: unknown) {
      const normalizedSmsSafety = normalizeThrownSmsSafety(error)
      smsSent = false
      sms = {
        success: false,
        code: normalizedSmsSafety.code,
        logFailure: normalizedSmsSafety.logFailure
      }
    }
  }

  const eventId = bookingUpdate.event_id || tableBooking.event_id || null
  if (eventId) {
    await syncPubOpsEventCalendarByEventId(supabase, eventId, {
      bookingId: bookingUpdate.booking_id ?? tableBooking.event_booking_id,
      tableBookingId: tableBooking.id,
      context: 'linked_table_booking_party_size_updated',
    })
  }

  return {
    state: bookingUpdate.state,
    table_booking_id: tableBooking.id,
    event_booking_id: tableBooking.event_booking_id,
    old_party_size: oldSeats,
    new_party_size: updatedSeats,
    delta,
    sms_sent: smsSent,
    sms,
    event_id: bookingUpdate.event_id || tableBooking.event_id || null,
    updated_booking: syncedBookingRow
  }
}

/**
 * Recording a booking's Christmas courses for the first time is a NULL-to-array change, which the
 * database snapshot trigger does not reconcile: it clears a seat's dishes only when an existing
 * tier changes. So dishes chosen before the tiers existed that a seat's tier no longer allows go
 * here, the way the trigger treats a changed seat: every dish on a 1-course seat, and all of a
 * 2-course seat's dishes when it holds both a starter and a dessert (that guest chooses again).
 * A 3-course seat keeps its dishes.
 */
async function clearChoicesThatNoLongerFit(
  supabase: SupabaseClient<any, 'public', any>,
  tableBookingId: string,
  courses: number[]
): Promise<void> {
  const { data: coverRows, error: coverError } = await supabase.from('booking_preorder_covers')
    .select('id, ordinal')
    .eq('table_booking_id', tableBookingId)
  if (coverError) throw coverError
  const covers = (coverRows ?? []) as Array<{ id: string; ordinal: number }>
  if (covers.length === 0) return

  const { data: selectionRows, error: selectionError } = await supabase.from('booking_preorder_selections')
    .select('id, cover_id, course')
    .in('cover_id', covers.map((cover) => cover.id))
  if (selectionError) throw selectionError
  const selections = (selectionRows ?? []) as Array<{ id: string; cover_id: string; course: string }>

  const staleIds: string[] = []
  for (const cover of covers) {
    const seatSelections = selections.filter((selection) => selection.cover_id === cover.id)
    const tier = courses[cover.ordinal - 1]
    const holdsStarterAndDessert =
      seatSelections.some((selection) => selection.course === 'starter') &&
      seatSelections.some((selection) => selection.course === 'dessert')
    if (tier === 1 || (tier === 2 && holdsStarterAndDessert)) {
      staleIds.push(...seatSelections.map((selection) => selection.id))
    }
  }
  if (staleIds.length === 0) return

  const { error: deleteError } = await supabase.from('booking_preorder_selections').delete().in('id', staleIds)
  if (deleteError) throw deleteError
}
