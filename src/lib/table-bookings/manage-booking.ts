import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'
import { formatCancellationReason } from './cancellation-reasons'

export type TableManagePreviewResult = {
  state: 'ready' | 'blocked'
  reason?: string
  table_booking_id?: string
  customer_id?: string
  booking_reference?: string
  status?: string
  party_size?: number
  committed_party_size?: number
  special_requirements?: string | null
  booking_type?: string
  booking_purpose?: string
  start_datetime?: string | null
  end_datetime?: string | null
  table_id?: string | null
  table_ids?: string[]
  table_name?: string | null
  table_capacity?: number | null
  is_outside_seating?: boolean
  can_cancel?: boolean
  can_edit?: boolean
}

export type TableManageUpdateResult = {
  state: 'updated' | 'cancelled' | 'blocked'
  reason?: string
  table_booking_id?: string
  customer_id?: string
  status?: string
  old_party_size?: number
  new_party_size?: number
  committed_party_size?: number
  charge_request_id?: string | null
  charge_amount?: number | null
}

function resolveAppBaseUrl(appBaseUrl?: string): string {
  return (appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

function computeManageTokenExpiry(bookingStartIso?: string | null): string {
  const now = Date.now()
  const capMs = now + 30 * 24 * 60 * 60 * 1000
  const bookingPlus48Ms = bookingStartIso ? Date.parse(bookingStartIso) + 48 * 60 * 60 * 1000 : Number.NaN
  const fallbackMs = now + 14 * 24 * 60 * 60 * 1000

  const resolvedMs = Number.isFinite(bookingPlus48Ms)
    ? Math.min(Math.max(bookingPlus48Ms, now + 60 * 60 * 1000), capMs)
    : Math.min(fallbackMs, capMs)

  return new Date(resolvedMs).toISOString()
}

function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function getThreeDayCommitTime(startAt: Date): Date {
  return new Date(startAt.getTime() - 3 * 24 * 60 * 60 * 1000)
}

async function findTableAssignment(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string
): Promise<{ table_id: string; table_ids: string[]; table_name: string | null; table_capacity: number | null } | null> {
  const { data: assignments } = await supabase.from('booking_table_assignments')
    .select('table_id, table:tables!booking_table_assignments_table_id_fkey(id, table_number, name, capacity)')
    .eq('table_booking_id', bookingId)

  const rows = (assignments || [])
  if (rows.length === 0) return null

  const tables = rows
    .map((row) => {
      const t = Array.isArray(row.table) ? row.table[0] : row.table
      return t ? { id: t.id as string, name: (t.name || t.table_number || null) as string | null, capacity: Number(t.capacity || 0) } : null
    })
    .filter((t): t is { id: string; name: string | null; capacity: number } => t !== null)

  if (tables.length === 0) return null

  const totalCapacity = tables.reduce((sum, t) => sum + t.capacity, 0)
  const names = tables.map((t) => t.name).filter(Boolean)

  return {
    table_id: tables[0].id,
    table_ids: tables.map((t) => t.id),
    table_name: names.length > 0 ? names.join(' + ') : null,
    table_capacity: totalCapacity > 0 ? totalCapacity : null
  }
}

async function getTableManageTokenRow(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<{ customer_id: string; table_booking_id: string } | null> {
  const tokenHash = hashGuestToken(rawToken)

  const { data: tokenRow } = await supabase.from('guest_tokens')
    .select('customer_id, table_booking_id, expires_at, consumed_at')
    .eq('hashed_token', tokenHash)
    .eq('action_type', 'manage')
    .maybeSingle()

  if (!tokenRow || !tokenRow.table_booking_id || !tokenRow.customer_id) {
    return null
  }

  if (tokenRow.consumed_at) {
    return null
  }

  const expiresAtMs = Date.parse(tokenRow.expires_at || '')
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null
  }

  return {
    customer_id: tokenRow.customer_id,
    table_booking_id: tokenRow.table_booking_id
  }
}

async function maybeMoveTableForPartySizeIncrease(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    currentTableIds?: string[]
    currentTableId?: string | null
    startIso: string
    endIso: string
    requiredPartySize: number
    isOutsideSeating?: boolean
  }
): Promise<{ moved: boolean; tableId: string | null }> {
  const { bookingId, currentTableIds, currentTableId, startIso, endIso, requiredPartySize } = input

  // Defence in depth: an outside booking holds no table and must never be given an
  // assignment row here. The caller already skips this function for outside bookings;
  // this guard ensures the INSERT branch below can never fire for one.
  if (input.isOutsideSeating === true) {
    return { moved: false, tableId: currentTableId || null }
  }
  const currentIds = new Set([
    ...(currentTableIds || []),
    ...(currentTableId ? [currentTableId] : [])
  ])

  const { data: candidateTables } = await supabase.from('tables')
    .select('id, capacity, is_bookable')
    .eq('is_bookable', true)
    .gte('capacity', requiredPartySize)
    .order('capacity', { ascending: true })

  const tableRows = (candidateTables || []) as Array<{ id: string; capacity: number; is_bookable: boolean }>

  for (const table of tableRows) {
    if (!table?.id) continue
    if (currentIds.has(table.id)) {
      // Current tables already accommodate the new size (caller checked capacity).
      // Return the first current table ID as the representative.
      return {
        moved: false,
        tableId: currentTableId || table.id
      }
    }

    const { data: overlappingAssignments } = await supabase.from('booking_table_assignments')
      .select('table_booking_id')
      .eq('table_id', table.id)
      .neq('table_booking_id', bookingId)
      .lt('start_datetime', endIso)
      .gt('end_datetime', startIso)

    const overlapIds = Array.from(
      new Set((overlappingAssignments || []).map((row) => row.table_booking_id))
    )

    if (overlapIds.length > 0) {
      const { data: overlappingBookings } = await supabase.from('table_bookings')
        .select('id, status, left_at')
        .in('id', overlapIds)

      // A table is only truly blocked by bookings that are still active:
      // - not cancelled, not a no-show, and the party hasn't left yet.
      // This matches the DB trigger logic in enforce_booking_table_assignment_integrity_v05.
      const hasActiveOverlap = (overlappingBookings || []).some(
        (row) => row.status !== 'cancelled' && row.status !== 'no_show' && !row.left_at
      )
      if (hasActiveOverlap) {
        continue
      }
    }

    const { data: currentAssignment } = await supabase.from('booking_table_assignments')
      .select('table_booking_id')
      .eq('table_booking_id', bookingId)
      .maybeSingle()

    if (currentAssignment) {
      const { data: updatedAssignment, error: updateError } = await supabase.from('booking_table_assignments')
        .update({
          table_id: table.id,
          start_datetime: startIso,
          end_datetime: endIso
        })
        .eq('table_booking_id', bookingId)
        .select('table_booking_id')
        .maybeSingle()

      if (updateError || !updatedAssignment) {
        continue
      }
    } else {
      const { error: insertError } = await supabase.from('booking_table_assignments')
        .insert({
          table_booking_id: bookingId,
          table_id: table.id,
          start_datetime: startIso,
          end_datetime: endIso,
          created_at: new Date().toISOString()
        })

      if (insertError) {
        continue
      }
    }

    return {
      moved: true,
      tableId: table.id
    }
  }

  return {
    moved: false,
    tableId: currentTableId || null
  }
}

export async function createTableManageToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    customerId: string
    tableBookingId: string
    bookingStartIso?: string | null
    appBaseUrl?: string
  }
): Promise<{ rawToken: string; url: string; expiresAt: string }> {
  const expiresAt = computeManageTokenExpiry(input.bookingStartIso)
  const token = await createGuestToken(supabase, {
    customerId: input.customerId,
    actionType: 'manage',
    tableBookingId: input.tableBookingId,
    expiresAt
  })

  const baseUrl = resolveAppBaseUrl(input.appBaseUrl)
  return {
    rawToken: token.rawToken,
    url: `${baseUrl}/g/${token.rawToken}/table-manage`,
    expiresAt
  }
}

export async function getTableManagePreviewByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<TableManagePreviewResult> {
  const tokenRow = await getTableManageTokenRow(supabase, rawToken)
  if (!tokenRow) {
    return { state: 'blocked', reason: 'invalid_token' }
  }

  const { data: booking } = await supabase.from('table_bookings')
    .select(
      'id, customer_id, booking_reference, status, party_size, committed_party_size, special_requirements, booking_type, booking_purpose, start_datetime, end_datetime, is_outside_seating'
    )
    .eq('id', tokenRow.table_booking_id)
    .maybeSingle()

  if (!booking) {
    return { state: 'blocked', reason: 'booking_not_found' }
  }

  if (booking.customer_id !== tokenRow.customer_id) {
    return { state: 'blocked', reason: 'token_customer_mismatch' }
  }

  if (!booking.start_datetime) {
    return { state: 'blocked', reason: 'booking_time_missing' }
  }

  const startAt = parseIsoDate(booking.start_datetime)
  if (!startAt) {
    return { state: 'blocked', reason: 'booking_time_missing' }
  }

  const now = new Date()
  const canEdit = booking.status === 'confirmed' && now.getTime() < startAt.getTime()
  const canCancel = canEdit

  const assignment = await findTableAssignment(supabase, booking.id)

  return {
    state: 'ready',
    table_booking_id: booking.id,
    customer_id: booking.customer_id,
    booking_reference: booking.booking_reference,
    status: booking.status,
    party_size: booking.party_size,
    committed_party_size: booking.committed_party_size,
    special_requirements: booking.special_requirements,
    booking_type: booking.booking_type,
    booking_purpose: booking.booking_purpose,
    start_datetime: booking.start_datetime,
    end_datetime: booking.end_datetime,
    table_id: assignment?.table_id || null,
    table_ids: assignment?.table_ids || [],
    table_name: assignment?.table_name || null,
    table_capacity: assignment?.table_capacity || null,
    is_outside_seating: booking.is_outside_seating === true,
    can_cancel: canCancel,
    can_edit: canEdit
  }
}

export async function updateTableBookingByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    rawToken: string
    action: 'cancel' | 'update'
    newPartySize?: number | null
    notes?: string | null
    cancellationReason?: string | null
    cancellationReasonDetail?: string | null
    appBaseUrl?: string
  }
): Promise<TableManageUpdateResult> {
  const preview = await getTableManagePreviewByRawToken(supabase, input.rawToken)
  if (preview.state !== 'ready' || !preview.table_booking_id || !preview.customer_id) {
    return {
      state: 'blocked',
      reason: preview.reason || 'invalid_token'
    }
  }

  if (!preview.start_datetime) {
    return {
      state: 'blocked',
      reason: 'booking_time_missing'
    }
  }

  const startAt = parseIsoDate(preview.start_datetime)
  if (!startAt) {
    return {
      state: 'blocked',
      reason: 'booking_time_missing'
    }
  }

  const now = new Date()
  if (now.getTime() >= startAt.getTime()) {
    return {
      state: 'blocked',
      reason: 'booking_started'
    }
  }

  if (preview.status !== 'confirmed') {
    return {
      state: 'blocked',
      reason: 'booking_not_confirmed'
    }
  }

  const bookingId = preview.table_booking_id
  const customerId = preview.customer_id
  const oldPartySize = Math.max(1, Number(preview.party_size || 1))

  // committed_party_size should always be set (NOT NULL in the DB since the v05 migration).
  // If it arrives as null/undefined here the TypeScript type is telling us something unexpected
  // happened (e.g. a direct DB insert that bypassed the RPC). We fall back to oldPartySize to
  // preserve existing behaviour, but we log a warning so the assumption is visible in the audit
  // trail rather than silently affecting the party-size commit rules.
  const committedPartySizeWasNull = preview.committed_party_size == null
  if (committedPartySizeWasNull) {
    logger.warn('[manage-booking] committed_party_size is null, falling back to party_size', {
      metadata: { bookingId }
    })
  }
  const oldCommittedSize = Math.max(1, Number(preview.committed_party_size ?? oldPartySize))

  const cleanNotes = input.notes ? input.notes.trim().slice(0, 500) : null

  if (input.action === 'cancel') {
    const nowIso = new Date().toISOString()

    const { data: cancelledBooking, error: cancelError } = await supabase.from('table_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: 'guest',
        // Optional. Null when the guest did not say, which is a legitimate outcome rather
        // than missing data: they are never made to answer in order to cancel.
        cancellation_reason: formatCancellationReason(
          input.cancellationReason,
          input.cancellationReasonDetail
        ),
        updated_at: nowIso,
        special_requirements: cleanNotes ?? preview.special_requirements ?? null
      })
      .eq('id', bookingId)
      .eq('status', 'confirmed')
      .select('id')
      .maybeSingle()

    if (cancelError) {
      throw cancelError
    }

    if (!cancelledBooking) {
      return {
        state: 'blocked',
        reason: 'booking_not_confirmed'
      }
    }

    try {
      await recordAnalyticsEvent(supabase, {
        customerId,
        tableBookingId: bookingId,
        eventType: 'table_booking_cancelled',
        metadata: {
          cancelled_by: 'guest'
        }
      })
    } catch (analyticsError) {
      logger.warn('Failed to record guest table-booking cancellation analytics event', {
        metadata: {
          bookingId,
          customerId,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        }
      })
    }

    // A guest cancellation is just a cancellation, however late it is.
    //
    // This used to raise a `late_cancel` charge request and email the manager for
    // approval. It was removed on 2026-08-06 because the charge could never be
    // taken: no card is held for any customer (there is no stored payment-method
    // column in the schema at all, and no customer has a `stripe_customer_id`).
    // In production it produced 21 approval emails worth GBP 1,020 and zero
    // successful charges. Telling a guest a fee "may apply" when we cannot
    // collect it, then asking a manager to rule on it, was cost with no benefit.
    //
    // Do not reinstate this without card capture landing first. The approval
    // machinery it called (`charge-approvals.ts`) is still used by the FOH
    // no-show and walkout buttons, which a person chooses to press.
    return {
      state: 'cancelled',
      table_booking_id: bookingId,
      customer_id: customerId,
      status: 'cancelled',
      charge_request_id: null,
      charge_amount: null
    }
  }

  const newPartySize = input.newPartySize != null ? Math.max(1, Math.trunc(input.newPartySize)) : oldPartySize

  if (newPartySize >= 21) {
    return {
      state: 'blocked',
      reason: 'too_large_party'
    }
  }

  const commitTime = getThreeDayCommitTime(startAt)
  let nextCommittedSize = oldCommittedSize
  if (now.getTime() < commitTime.getTime()) {
    nextCommittedSize = newPartySize
  }

  // Outside bookings hold no INDOOR table, so a party-size increase must never trigger table
  // allocation: we only update the party size. Skip the capacity/move check entirely for them
  // (they have no assignment rows and cannot be given one here). The outside table they DO hold
  // is re-costed for us, because the `party_size` UPDATE below trips the reconciling trigger
  // from 20260802000008_outside_reservation_sync.sql. Do not add a bespoke copy of that here.
  if (newPartySize > oldPartySize && preview.is_outside_seating !== true) {
    const tableCapacity = Math.max(0, Number(preview.table_capacity || 0))

    if (newPartySize > tableCapacity) {
      if (!preview.start_datetime || !preview.end_datetime) {
        return {
          state: 'blocked',
          reason: 'no_table'
        }
      }

      const moveResult = await maybeMoveTableForPartySizeIncrease(supabase, {
        bookingId,
        currentTableIds: preview.table_ids || [],
        currentTableId: preview.table_id,
        startIso: preview.start_datetime,
        endIso: preview.end_datetime,
        requiredPartySize: newPartySize,
        // This branch only runs when preview.is_outside_seating !== true (guarded
        // above), so the booking is provably indoor here.
        isOutsideSeating: false
      })

      if (!moveResult.tableId) {
        return {
          state: 'blocked',
          reason: 'no_table'
        }
      }
    }
  }

  // Shrinking a party inside the three-day commit window used to raise a
  // `reduction_fee` charge request and email the manager. Removed on 2026-08-06
  // for the same reason as the late-cancel charge above: no card is held, so the
  // fee could never be collected. See the note in the cancel branch.

  const { data: updatedBooking, error: updateError } = await supabase.from('table_bookings')
    .update({
      party_size: newPartySize,
      committed_party_size: nextCommittedSize,
      special_requirements: cleanNotes ?? preview.special_requirements ?? null,
      updated_at: new Date().toISOString()
    })
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw updateError
  }

  if (!updatedBooking) {
    return {
      state: 'blocked',
      reason: 'booking_not_confirmed'
    }
  }

  return {
    state: 'updated',
    table_booking_id: bookingId,
    customer_id: customerId,
    status: 'confirmed',
    old_party_size: oldPartySize,
    new_party_size: newPartySize,
    committed_party_size: nextCommittedSize,
    charge_request_id: null,
    charge_amount: null
  }
}
