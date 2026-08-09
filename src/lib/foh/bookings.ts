import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { logger } from '@/lib/logger'
import { requiresDeposit } from '@/lib/table-bookings/deposit'
import { isChristmasBookingType } from '@/lib/table-bookings/christmas'

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
  booking_type: string | null
  payment_status: string | null
  deposit_waived: boolean | null
  paypal_deposit_capture_id: string | null
  party_size: number | null
  committed_party_size: number | null
  booking_date: string
  booking_time: string
  duration_minutes: number | null
  start_datetime: string | null
  end_datetime: string | null
  high_chair_count?: number
  is_outside_seating?: boolean
}

export async function getTableBookingForFoh(
  supabase: SupabaseClient<any, 'public', any>,
  bookingId: string
): Promise<TableBookingForFoh | null> {
  const { data, error } = await supabase.from('table_bookings')
    .select(
      'id, customer_id, booking_reference, status, booking_type, payment_status, deposit_waived, paypal_deposit_capture_id, party_size, committed_party_size, booking_date, booking_time, duration_minutes, start_datetime, end_datetime, high_chair_count, is_outside_seating'
    )
    .eq('id', bookingId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data as TableBookingForFoh
}

export function hasUnpaidRequiredDeposit(
  booking: Pick<TableBookingForFoh, 'status' | 'payment_status' | 'deposit_waived' | 'party_size' | 'committed_party_size'>
    & Partial<Pick<TableBookingForFoh, 'paypal_deposit_capture_id' | 'booking_type'>>
): boolean {
  if (booking.deposit_waived === true) return false
  if (booking.payment_status === 'completed' || booking.paypal_deposit_capture_id) return false

  const partySize = Math.max(
    0,
    Number(booking.committed_party_size ?? booking.party_size ?? 0)
  )

  // Christmas bookings owe a deposit at any party size, so callers must pass
  // booking_type through or a Christmas party of 6 would read as fully paid.
  if (!requiresDeposit(partySize, { isChristmas: isChristmasBookingType(booking.booking_type) })) return false

  return booking.status === 'pending_payment' || booking.payment_status === 'pending'
}

export async function recordWalkoutForBooking(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    bookingId: string
    customerId?: string | null
    amount: number
    recordedByUserId: string
    notes?: string | null
  }
): Promise<{ amount: number }> {
  const amount = Number(input.amount.toFixed(2))

  if (!Number.isFinite(amount) || amount <= 0) {
    return { amount: 0 }
  }

  // A walkout is worth recording against the customer even though nothing is
  // collected, so the next booking from them carries the history. Analytics is
  // the only side effect: charge requests were withdrawn because no card is
  // ever held for a table booking, so nothing here could ever be charged.
  if (input.customerId) {
    try {
      await recordAnalyticsEvent(supabase, {
        customerId: input.customerId,
        tableBookingId: input.bookingId,
        eventType: 'walkout_recorded',
        metadata: {
          amount,
          currency: 'GBP',
          recorded_by: 'foh',
          recorded_by_user_id: input.recordedByUserId,
          notes: input.notes ?? null
        }
      })
    } catch (analyticsError) {
      logger.warn('Failed recording FOH walkout analytics event', {
        metadata: {
          bookingId: input.bookingId,
          customerId: input.customerId,
          error: analyticsError instanceof Error ? analyticsError.message : String(analyticsError)
        }
      })
    }
  }

  return { amount }
}
