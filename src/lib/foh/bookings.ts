import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'
import { sendManagerChargeApprovalEmail } from '@/lib/table-bookings/charge-approvals'

const DEFAULT_FEE_PER_HEAD = 15

function parseFeePerHeadSetting(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  if (value && typeof value === 'object') {
    const nested = Number((value as Record<string, unknown>).per_head || (value as Record<string, unknown>).amount)
    if (Number.isFinite(nested) && nested > 0) {
      return nested
    }
  }

  return DEFAULT_FEE_PER_HEAD
}

export async function getFeePerHead(
  supabase: SupabaseClient<any, 'public', any>
): Promise<number> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .in('key', ['fee_per_head_amount_gbp', 'table_booking_fee_per_head', 'booking_fee_per_head'])
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) {
    return DEFAULT_FEE_PER_HEAD
  }

  return parseFeePerHeadSetting((data[0] as any).value)
}

export type TableBookingForFoh = {
  id: string
  customer_id: string | null
  booking_reference: string | null
  status: string
  party_size: number | null
  committed_party_size: number | null
  booking_date: string
  booking_time: string
  duration_minutes: number | null
  start_datetime: string | null
  end_datetime: string | null
}

export async function getTableBookingForFoh(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string
): Promise<TableBookingForFoh | null> {
  const { data, error } = await (supabase.from('table_bookings') as any)
    .select(
      'id, customer_id, booking_reference, status, party_size, committed_party_size, booking_date, booking_time, duration_minutes, start_datetime, end_datetime'
    )
    .eq('id', bookingId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data as TableBookingForFoh
}

export async function createChargeRequestForBooking(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    customerId?: string | null
    type: 'late_cancel' | 'no_show' | 'reduction_fee' | 'walkout'
    amount: number
    requestedByUserId: string
    metadata?: Record<string, unknown>
  }
): Promise<{ chargeRequestId: string | null; amount: number; capApplied: boolean }> {
  let amount = Number(input.amount.toFixed(2))
  let capApplied = false

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      chargeRequestId: null,
      amount: 0,
      capApplied: false
    }
  }

  const isPerHeadCappedType = ['late_cancel', 'no_show', 'reduction_fee'].includes(input.type)
  if (isPerHeadCappedType) {
    const { data: bookingRow, error: bookingLookupError } = await (supabase.from('table_bookings') as any)
      .select('committed_party_size, party_size')
      .eq('id', input.bookingId)
      .maybeSingle()

    if (bookingLookupError) {
      throw new Error(`Failed to load booking charge-cap context: ${bookingLookupError.message}`)
    }

    if (!bookingRow) {
      throw new Error(`Booking not found while preparing charge request cap: ${input.bookingId}`)
    }

    const committedPartySize = Math.max(
      1,
      Number(bookingRow?.committed_party_size || bookingRow?.party_size || 1)
    )
    const feePerHead = await getFeePerHead(supabase)
    const totalCap = Number((committedPartySize * feePerHead).toFixed(2))

    const { data: existingRows, error: existingChargeLookupError } = await (supabase.from('charge_requests') as any)
      .select('amount, manager_decision, charge_status, type')
      .eq('table_booking_id', input.bookingId)
      .in('type', ['late_cancel', 'no_show', 'reduction_fee'])

    if (existingChargeLookupError) {
      throw new Error(`Failed to load existing capped charge requests: ${existingChargeLookupError.message}`)
    }

    const alreadyAllocated = ((existingRows || []) as any[])
      .filter((row) => row.manager_decision !== 'waived' && row.charge_status !== 'waived')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)

    const remainingCap = Math.max(0, Number((totalCap - alreadyAllocated).toFixed(2)))
    if (amount > remainingCap) {
      amount = remainingCap
      capApplied = true
    }
  }

  if (amount <= 0) {
    return {
      chargeRequestId: null,
      amount: 0,
      capApplied
    }
  }

  const { data, error } = await (supabase.from('charge_requests') as any)
    .insert({
      table_booking_id: input.bookingId,
      type: input.type,
      amount,
      currency: 'GBP',
      metadata: input.metadata || {},
      requested_by: 'foh',
      requested_by_user_id: input.requestedByUserId,
      charge_status: 'pending'
    })
    .select('id')
    .maybeSingle()

  if (error) {
    throw error
  }

  if (input.customerId) {
    try {
      await recordAnalyticsEvent(supabase, {
        customerId: input.customerId,
        tableBookingId: input.bookingId,
        eventType: 'charge_request_created',
        metadata: {
          charge_type: input.type,
          amount,
          currency: 'GBP',
          requested_by: 'foh',
          cap_applied: capApplied
        }
      })
    } catch (analyticsError) {
      logger.warn('Failed recording FOH charge-request analytics event', {
        metadata: {
          bookingId: input.bookingId,
          customerId: input.customerId,
          chargeType: input.type,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        }
      })
    }
  }

  const chargeRequestId = (data as any)?.id || null

  if (chargeRequestId) {
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL

    const emailResult = await sendManagerChargeApprovalEmail(supabase, {
      chargeRequestId,
      appBaseUrl
    })

    if (!emailResult.sent) {
      logger.warn('Failed to send manager charge-approval email', {
        metadata: {
          chargeRequestId,
          bookingId: input.bookingId,
          reason: emailResult.error || 'unknown'
        }
      })
    }
  }

  return {
    chargeRequestId,
    amount,
    capApplied
  }
}
