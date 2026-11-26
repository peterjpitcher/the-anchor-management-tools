import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { createTablePaymentToken } from '@/lib/table-bookings/bookings'
import { describePartySizeDeposit } from '@/lib/table-bookings/guest-texts'
import { sendPartySizeDepositRequestEmailFirst } from '@/lib/table-bookings/staff-deposit-transitions'
import type { GuestNotificationOutcome } from '@/lib/table-bookings/guest-notification-outcome'
import { logger } from '@/lib/logger'
import { AuditService } from '@/services/audit'

/**
 * Staff turn a confirmed regular booking into a Christmas booking where only some of the seats are
 * having Christmas dinner (owner requirement, 26 November 2026): 12 seats, 9 Christmas dinners, 3
 * children on the normal menu. The Christmas deposit is GBP 10 a diner, so GBP 90; tables, covers,
 * high chairs and the party size stay on the 12 seats.
 *
 * The database does the change in one locked statement (convert_table_booking_to_christmas_v01):
 * it checks the booking can be converted, prices the deposit with resolve_table_booking_deposit_v02,
 * writes the Christmas terms, sizes the course list and pre-order covers to the diners, and keeps
 * the booking confirmed with the deposit owed (owner decision D20): no hold, nothing for the timeout
 * cron to cancel. This file then mints the payment link and sends the ONE deposit request through
 * the email-first guest path. A link or message failure after the database change is reported to
 * staff as a warning; the conversion itself is never undone, because the booking is correct and a
 * fresh link can be sent from the booking page.
 */

export type ChristmasConversionInput = {
  bookingId: string
  christmasDiners: number
  internalNote?: string | null
  userId: string
  appBaseUrl?: string | null
}

export type ChristmasConversionResult =
  | {
      ok: true
      bookingReference: string | null
      partySize: number
      christmasDiners: number
      depositAmount: number
      depositUrl: string | null
      notification: GuestNotificationOutcome | null
      warning: string | null
    }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string }

type ConvertRpcRow = {
  ok: boolean
  table_booking_id: string
  booking_reference: string | null
  customer_id: string | null
  status: string
  party_size: number
  christmas_diner_count: number
  start_datetime: string
  hold_expires_at: string
  deposit_amount: number | string
  deposit_rule: string | null
  deposit_rate: number | string | null
}

/** Postgres raises 22023 for every refusal the conversion makes, each with a sentence staff can act on. */
function mapRpcError(error: { code?: string | null; message?: string | null }): { status: 404 | 409 | 500; error: string } {
  if (error.code === 'P0002') return { status: 404, error: 'Booking not found.' }
  if (error.code === '22023' && error.message) return { status: 409, error: error.message }
  return { status: 500, error: 'The booking could not be changed to Christmas dinner. Please try again.' }
}

export async function convertTableBookingToChristmas(
  supabase: SupabaseClient<any, 'public', any>,
  input: ChristmasConversionInput
): Promise<ChristmasConversionResult> {
  const note = input.internalNote?.trim() || null

  const { data, error } = await supabase.rpc('convert_table_booking_to_christmas_v01', {
    p_booking_id: input.bookingId,
    p_christmas_diners: input.christmasDiners,
    p_internal_note: note,
  })

  if (error) {
    const mapped = mapRpcError(error)
    if (mapped.status === 500) {
      logger.error('Christmas conversion failed in the database', {
        error: new Error(error.message),
        metadata: { tableBookingId: input.bookingId, code: error.code, details: error.details, hint: error.hint },
      })
    }
    return { ok: false, ...mapped }
  }

  const row = data as ConvertRpcRow | null
  if (!row || row.ok !== true) {
    logger.error('Christmas conversion returned no booking', { metadata: { tableBookingId: input.bookingId } })
    return { ok: false, status: 500, error: 'The booking could not be changed to Christmas dinner. Please try again.' }
  }

  const depositAmount = Number(row.deposit_amount)
  const rate = Number(row.deposit_rate)

  await AuditService.logAuditEvent({
    user_id: input.userId,
    operation_type: 'table_booking.converted_to_christmas',
    resource_type: 'table_booking',
    resource_id: input.bookingId,
    operation_status: 'success',
    old_values: { booking_type: 'regular' },
    new_values: {
      booking_type: 'christmas',
      party_size: row.party_size,
      christmas_diner_count: row.christmas_diner_count,
      deposit_amount: depositAmount,
      deposit_rule: row.deposit_rule,
    },
    additional_info: { stays_confirmed: true, ...(note ? { internal_note: note } : {}) },
  })

  let depositUrl: string | null = null
  let notification: GuestNotificationOutcome | null = null
  let warning: string | null = null

  if (!row.customer_id) {
    warning = 'The booking is now Christmas dinner, but it has no customer, so no deposit request was sent.'
  } else {
    try {
      // The link works until the booking starts: the deposit is owed, not a hold.
      const token = await createTablePaymentToken(createAdminClient(), {
        customerId: row.customer_id,
        tableBookingId: input.bookingId,
        holdExpiresAt: row.hold_expires_at,
        appBaseUrl: input.appBaseUrl,
      })
      depositUrl = token.url

      notification = await sendPartySizeDepositRequestEmailFirst(supabase, {
        booking: {
          id: input.bookingId,
          customer_id: row.customer_id,
          party_size: row.party_size,
          status: row.status,
          payment_status: 'pending',
          booking_type: 'christmas',
          start_datetime: row.start_datetime,
          deposit_amount: depositAmount,
          deposit_amount_locked: null,
          deposit_waived: false,
          deposit_rule: row.deposit_rule,
        },
        customerId: row.customer_id,
        newPartySize: row.party_size,
        depositAmount,
        paymentUrl: token.url,
        holdExpiresAt: token.expiresAt,
        wording: describePartySizeDeposit({
          newPartySize: row.party_size,
          depositAmount,
          isChristmas: true,
          bookingType: 'christmas',
          christmasDiners: row.christmas_diner_count,
        }),
        stillBooked: true,
        christmasDiners: row.christmas_diner_count,
        trigger: 'converted_to_christmas',
        perPersonGbp: Number.isFinite(rate) && rate > 0 ? rate : null,
      })

      if (notification.status !== 'sent') {
        warning =
          'The booking is now Christmas dinner, but the deposit request could not be sent to the guest. ' +
          'Send them the payment link from the booking page.'
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      logger.error('Christmas conversion could not send the deposit request', {
        error: sendError instanceof Error ? sendError : new Error(message),
        metadata: { tableBookingId: input.bookingId },
      })
      warning =
        'The booking is now Christmas dinner, but the deposit request could not be sent to the guest. ' +
        'Send them the payment link from the booking page.'
    }
  }

  return {
    ok: true,
    bookingReference: row.booking_reference,
    partySize: row.party_size,
    christmasDiners: row.christmas_diner_count,
    depositAmount,
    depositUrl,
    notification,
    warning,
  }
}
