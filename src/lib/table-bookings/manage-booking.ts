import type { SupabaseClient } from '@supabase/supabase-js'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { getFeePerHead } from '@/lib/foh/bookings'
import { sendManagerChargeApprovalEmail } from '@/lib/table-bookings/charge-approvals'
import { logger } from '@/lib/logger'

type ChargeRequestType = 'late_cancel' | 'reduction_fee'

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
  table_name?: string | null
  table_capacity?: number | null
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

function getLateCancelCutoff(startAt: Date): Date {
  return new Date(startAt.getTime() - 24 * 60 * 60 * 1000)
}

async function findTableAssignment(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string
): Promise<{ table_id: string; table_name: string | null; table_capacity: number | null } | null> {
  const { data: assignment } = await (supabase.from('booking_table_assignments') as any)
    .select('table_id')
    .eq('table_booking_id', bookingId)
    .maybeSingle()

  if (!assignment?.table_id) {
    return null
  }

  const { data: table } = await (supabase.from('tables') as any)
    .select('id, table_number, name, capacity')
    .eq('id', assignment.table_id)
    .maybeSingle()

  if (!table) {
    return null
  }

  return {
    table_id: table.id,
    table_name: table.name || table.table_number || null,
    table_capacity: table.capacity || null
  }
}

async function getTableManageTokenRow(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<{ customer_id: string; table_booking_id: string } | null> {
  const tokenHash = hashGuestToken(rawToken)

  const { data: tokenRow } = await (supabase.from('guest_tokens') as any)
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
    currentTableId?: string | null
    startIso: string
    endIso: string
    requiredPartySize: number
  }
): Promise<{ moved: boolean; tableId: string | null }> {
  const { bookingId, currentTableId, startIso, endIso, requiredPartySize } = input

  const { data: candidateTables } = await (supabase.from('tables') as any)
    .select('id, capacity, is_bookable')
    .eq('is_bookable', true)
    .gte('capacity', requiredPartySize)
    .order('capacity', { ascending: true })

  const tableRows = (candidateTables || []) as Array<{ id: string; capacity: number; is_bookable: boolean }>

  for (const table of tableRows) {
    if (!table?.id) continue
    if (currentTableId && table.id === currentTableId) {
      return {
        moved: false,
        tableId: currentTableId
      }
    }

    const { data: overlappingAssignments } = await (supabase.from('booking_table_assignments') as any)
      .select('table_booking_id')
      .eq('table_id', table.id)
      .neq('table_booking_id', bookingId)
      .lt('start_datetime', endIso)
      .gt('end_datetime', startIso)

    const overlapIds = Array.from(
      new Set(((overlappingAssignments || []) as any[]).map((row) => row.table_booking_id))
    )

    if (overlapIds.length > 0) {
      const { data: overlappingBookings } = await (supabase.from('table_bookings') as any)
        .select('id, status')
        .in('id', overlapIds)

      const hasActiveOverlap = ((overlappingBookings || []) as any[]).some((row) => row.status !== 'cancelled')
      if (hasActiveOverlap) {
        continue
      }
    }

    const { data: currentAssignment } = await (supabase.from('booking_table_assignments') as any)
      .select('table_booking_id')
      .eq('table_booking_id', bookingId)
      .maybeSingle()

    if (currentAssignment) {
      const { data: updatedAssignment, error: updateError } = await (supabase.from('booking_table_assignments') as any)
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
      const { error: insertError } = await (supabase.from('booking_table_assignments') as any)
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

async function computePerHeadFeeCapRemaining(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    committedPartySize: number
    feePerHead: number
  }
): Promise<number> {
  const totalCap = Math.max(0, input.committedPartySize * input.feePerHead)

  const { data: existingRequests } = await (supabase.from('charge_requests') as any)
    .select('amount, type, manager_decision, charge_status')
    .eq('table_booking_id', input.bookingId)
    .in('type', ['late_cancel', 'no_show', 'reduction_fee'])

  const alreadyAllocated = ((existingRequests || []) as any[])
    .filter((row) => row.manager_decision !== 'waived' && row.charge_status !== 'waived')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)

  return Math.max(0, Number((totalCap - alreadyAllocated).toFixed(2)))
}

async function createSystemChargeRequestWithApproval(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    customerId: string
    type: ChargeRequestType
    amount: number
    metadata: Record<string, unknown>
    appBaseUrl?: string
  }
): Promise<{ chargeRequestId: string | null }> {
  const amount = Number(input.amount.toFixed(2))
  if (!Number.isFinite(amount) || amount <= 0) {
    return { chargeRequestId: null }
  }

  const { data: chargeRequest, error } = await (supabase.from('charge_requests') as any)
    .insert({
      table_booking_id: input.bookingId,
      type: input.type,
      amount,
      currency: 'GBP',
      metadata: input.metadata,
      requested_by: 'system',
      requested_by_user_id: null,
      charge_status: 'pending'
    })
    .select('id')
    .maybeSingle()

  if (error) {
    throw error
  }

  const chargeRequestId = chargeRequest?.id || null

  if (chargeRequestId) {
    try {
      await recordAnalyticsEvent(supabase, {
        customerId: input.customerId,
        tableBookingId: input.bookingId,
        eventType: 'charge_request_created',
        metadata: {
          charge_type: input.type,
          amount,
          currency: 'GBP',
          requested_by: 'system'
        }
      })
    } catch (analyticsError) {
      logger.warn('Failed to record system charge-request analytics event', {
        metadata: {
          chargeRequestId,
          bookingId: input.bookingId,
          customerId: input.customerId,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        }
      })
    }

    try {
      const emailResult = await sendManagerChargeApprovalEmail(supabase, {
        chargeRequestId,
        appBaseUrl: input.appBaseUrl
      })

      if (!emailResult.sent) {
        logger.warn('Failed to send manager charge-approval email for system request', {
          metadata: {
            chargeRequestId,
            bookingId: input.bookingId,
            error: emailResult.error || 'unknown'
          }
        })
      }
    } catch (emailError) {
      logger.warn('Failed to dispatch manager charge-approval email for system request', {
        metadata: {
          chargeRequestId,
          bookingId: input.bookingId,
          error: emailError instanceof Error ? emailError.message : String(emailError)
        }
      })
    }
  }

  return { chargeRequestId }
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

  const { data: booking } = await (supabase.from('table_bookings') as any)
    .select(
      'id, customer_id, booking_reference, status, party_size, committed_party_size, special_requirements, booking_type, booking_purpose, start_datetime, end_datetime'
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
    table_name: assignment?.table_name || null,
    table_capacity: assignment?.table_capacity || null,
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
  const oldCommittedSize = Math.max(1, Number(preview.committed_party_size || oldPartySize))
  const cleanNotes = input.notes ? input.notes.trim().slice(0, 500) : null

  if (input.action === 'cancel') {
    const nowIso = new Date().toISOString()

    const { data: cancelledBooking, error: cancelError } = await (supabase.from('table_bookings') as any)
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
        cancelled_by: 'guest',
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

    const lateCancelCutoff = getLateCancelCutoff(startAt)
    if (now.getTime() < lateCancelCutoff.getTime()) {
      return {
        state: 'cancelled',
        table_booking_id: bookingId,
        customer_id: customerId,
        status: 'cancelled',
        charge_request_id: null,
        charge_amount: null
      }
    }

    const feePerHead = await getFeePerHead(supabase)
    const remainingCap = await computePerHeadFeeCapRemaining(supabase, {
      bookingId,
      committedPartySize: oldCommittedSize,
      feePerHead
    })

    const suggestedAmount = Number((oldPartySize * feePerHead).toFixed(2))
    const chargeAmount = Math.max(0, Math.min(suggestedAmount, remainingCap))

    if (chargeAmount <= 0) {
      return {
        state: 'cancelled',
        table_booking_id: bookingId,
        customer_id: customerId,
        status: 'cancelled',
        charge_request_id: null,
        charge_amount: 0
      }
    }

    let chargeRequestId: string | null = null
    let finalChargeAmount: number | null = null
    try {
      const chargeRequest = await createSystemChargeRequestWithApproval(supabase, {
        bookingId,
        customerId,
        type: 'late_cancel',
        amount: chargeAmount,
        appBaseUrl: input.appBaseUrl,
        metadata: {
          source: 'guest_late_cancel',
          old_party_size: oldPartySize,
          committed_party_size: oldCommittedSize,
          fee_per_head: feePerHead
        }
      })
      chargeRequestId = chargeRequest.chargeRequestId
      if (chargeRequestId) {
        finalChargeAmount = chargeAmount
      }
    } catch (chargeRequestError) {
      logger.error('Failed to create late-cancel charge request after guest cancellation', {
        error: chargeRequestError instanceof Error ? chargeRequestError : new Error(String(chargeRequestError)),
        metadata: {
          bookingId,
          customerId,
          chargeAmount
        }
      })
    }

    return {
      state: 'cancelled',
      table_booking_id: bookingId,
      customer_id: customerId,
      status: 'cancelled',
      charge_request_id: chargeRequestId,
      charge_amount: finalChargeAmount
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

  if (newPartySize > oldPartySize) {
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
        currentTableId: preview.table_id,
        startIso: preview.start_datetime,
        endIso: preview.end_datetime,
        requiredPartySize: newPartySize
      })

      if (!moveResult.tableId) {
        return {
          state: 'blocked',
          reason: 'no_table'
        }
      }
    }
  }

  let plannedReductionCharge:
    | {
        amount: number
        metadata: Record<string, unknown>
      }
    | null = null

  if (newPartySize < oldPartySize && now.getTime() >= commitTime.getTime()) {
    const reductionCount = Math.max(0, oldCommittedSize - newPartySize)
    if (reductionCount > 0) {
      const feePerHead = await getFeePerHead(supabase)
      const remainingCap = await computePerHeadFeeCapRemaining(supabase, {
        bookingId,
        committedPartySize: oldCommittedSize,
        feePerHead
      })

      const suggestedAmount = Number((reductionCount * feePerHead).toFixed(2))
      const chargeAmount = Math.max(0, Math.min(suggestedAmount, remainingCap))

      if (chargeAmount > 0) {
        plannedReductionCharge = {
          amount: chargeAmount,
          metadata: {
            source: 'guest_reduction_inside_3_days',
            old_party_size: oldPartySize,
            new_party_size: newPartySize,
            committed_party_size: oldCommittedSize,
            reduction_count: reductionCount,
            fee_per_head: feePerHead
          }
        }
      }
    }
  }

  const { data: updatedBooking, error: updateError } = await (supabase.from('table_bookings') as any)
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

  let chargeRequestId: string | null = null
  let chargeAmount: number | null = null
  if (plannedReductionCharge) {
    try {
      const chargeRequest = await createSystemChargeRequestWithApproval(supabase, {
        bookingId,
        customerId,
        type: 'reduction_fee',
        amount: plannedReductionCharge.amount,
        appBaseUrl: input.appBaseUrl,
        metadata: plannedReductionCharge.metadata
      })
      chargeRequestId = chargeRequest.chargeRequestId
      if (chargeRequestId) {
        chargeAmount = plannedReductionCharge.amount
      }
    } catch (chargeRequestError) {
      logger.error('Failed to create reduction-fee charge request after guest booking update', {
        error: chargeRequestError instanceof Error ? chargeRequestError : new Error(String(chargeRequestError)),
        metadata: {
          bookingId,
          customerId,
          newPartySize,
          oldPartySize,
          plannedChargeAmount: plannedReductionCharge.amount
        }
      })
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
    charge_request_id: chargeRequestId,
    charge_amount: chargeAmount
  }
}
