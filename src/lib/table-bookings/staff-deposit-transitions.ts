import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { getSmartFirstName } from '@/lib/sms/bulk'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { createTablePaymentToken } from '@/lib/table-bookings/bookings'
import {
  getCanonicalDeposit,
  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
  requiresDeposit,
} from '@/lib/table-bookings/deposit'
import { isChristmasBookingType } from '@/lib/table-bookings/christmas'
import { logger } from '@/lib/logger'

export type PartySizeDepositTransitionBooking = {
  id: string
  customer_id: string | null
  party_size: number | null
  status: string | null
  payment_status: string | null
  booking_type: string | null
  start_datetime: string | null
  deposit_amount: number | string | null
  deposit_amount_locked: number | string | null
  deposit_waived: boolean | null
  /**
   * Set when the booking was taken inside a seasonal period. Its presence is what stops this
   * function re-pricing a booking with a rule that never applied to it. See the guard below.
   */
  booking_period_id?: string | null
  booking_period_name?: string | null
}

export type PartySizeDepositTransitionResult =
  | {
      state: 'deposit_required'
      depositUrl: string
      depositAmount: number
      holdExpiresAt: string
      smsSent: boolean
    }
  | {
      state: 'deposit_cleared'
    }
  | {
      /**
       * The party size changed on a seasonal booking, so the deposit was deliberately left exactly
       * as it was and a person has to decide. Never a failure: the amendment itself succeeded.
       */
      state: 'manual_review'
      message: string
      depositAmount: number | null
    }
  | {
      state: 'unchanged'
    }

function computeStaffPaymentHoldExpiry(
  bookingStartIso: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const maxHold = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  let expiry = maxHold

  if (bookingStartIso) {
    const bookingStart = new Date(bookingStartIso)
    if (Number.isFinite(bookingStart.getTime()) && bookingStart.getTime() < expiry.getTime()) {
      expiry = bookingStart
    }
  }

  if (expiry.getTime() <= now.getTime()) {
    return null
  }

  return expiry.toISOString()
}

export async function applyPartySizeDepositTransition(
  supabase: SupabaseClient<any, 'public', any>,
  input: {
    booking: PartySizeDepositTransitionBooking
    previousPartySize: number
    newPartySize: number
    sendSms: boolean
    appBaseUrl: string
  },
): Promise<PartySizeDepositTransitionResult> {
  const depositWaived = input.booking.deposit_waived === true
  // A Christmas booking already owes a deposit at any party size, so resizing it
  // never crosses the 10+ threshold: both sides evaluate to true and the
  // transition is correctly a no-op here (the amount is re-locked elsewhere).
  const isChristmas = isChristmasBookingType(input.booking.booking_type)

  // SEASONAL BOOKINGS ARE NOT RE-PRICED HERE, AND THAT IS DELIBERATE.
  //
  // Everything below reasons with `requiresDeposit`, which knows one rule: ten guests or more. A
  // seasonal booking obeys the terms snapshotted on it instead, and every season other than
  // Christmas carries booking_type 'regular', so `isChristmas` is false and the ten-guest rule was
  // silently applied to a deposit that never came from it. Twelve guests on a per-head GBP 25
  // period pay GBP 300; amending to eight made the branch below write deposit_amount NULL and
  // status 'confirmed', turning GBP 300 owed into GBP 0 with nothing logged. The reverse kept a
  // stale figure that was far too small.
  //
  // Re-pricing correctly is not possible from the booking alone: when the large-group rule beat the
  // seasonal one, the snapshot records the GROUP basis and rate, so the period's own rate is not
  // there to re-apply, and reading it back off booking_periods would price the guest against terms
  // a manager may have edited since. Whether an amendment should re-price a seasonal deposit at all
  // is an owner decision, not one to infer here.
  //
  // So the deposit is left EXACTLY as it stands and a person is told. Over-collecting is visible
  // and correctable; silently zeroing money owed is neither.
  if (input.booking.booking_period_id) {
    const currentAmount = Number(input.booking.deposit_amount)
    const periodLabel = input.booking.booking_period_name || 'seasonal'
    return {
      state: 'manual_review',
      depositAmount: Number.isFinite(currentAmount) ? currentAmount : null,
      message:
        `The party size changed on a ${periodLabel} booking, so the deposit has been left as it is. ` +
        'Check whether it still needs adjusting and handle it manually.',
    }
  }

  const wasDepositRequired = requiresDeposit(input.previousPartySize, { depositWaived, isChristmas })
  const isNowDepositRequired = requiresDeposit(input.newPartySize, { depositWaived, isChristmas })
  const depositAlreadyHandled = ['completed', 'refunded'].includes(input.booking.payment_status || '')

  if (!wasDepositRequired && isNowDepositRequired && !depositAlreadyHandled) {
    if (!input.booking.customer_id) {
      throw new Error('Cannot request a deposit because the booking has no customer.')
    }

    const holdExpiresAt = computeStaffPaymentHoldExpiry(input.booking.start_datetime)
    if (!holdExpiresAt) {
      throw new Error('Cannot request a deposit because the booking hold would already be expired.')
    }

    const depositAmount = Number(
      getCanonicalDeposit(
        {
          party_size: input.newPartySize,
          deposit_amount: input.booking.deposit_amount ?? null,
          deposit_amount_locked: input.booking.deposit_amount_locked ?? null,
          status: 'pending_payment',
          payment_status: 'pending',
          deposit_waived: input.booking.deposit_waived ?? null,
          booking_type: input.booking.booking_type ?? null,
        },
        input.newPartySize,
      ).toFixed(2),
    )

    const token = await createTablePaymentToken(createAdminClient(), {
      customerId: input.booking.customer_id,
      tableBookingId: input.booking.id,
      holdExpiresAt,
      appBaseUrl: input.appBaseUrl,
    })

    const { error: pendingUpdateError } = await supabase
      .from('table_bookings')
      .update({
        status: 'pending_payment',
        payment_status: 'pending',
        hold_expires_at: token.expiresAt,
        deposit_amount: depositAmount,
        paypal_deposit_order_id: null,
      })
      .eq('id', input.booking.id)

    if (pendingUpdateError) {
      throw new Error(`Failed to mark booking pending payment: ${pendingUpdateError.message}`)
    }

    let smsSent = false
    if (input.sendSms) {
      try {
        const { data: customer, error: customerError } = await supabase
          .from('customers')
          .select('id, first_name, mobile_number, mobile_e164, sms_status')
          .eq('id', input.booking.customer_id)
          .maybeSingle()

        if (customerError) {
          throw new Error(`Failed to load customer for deposit SMS: ${customerError.message}`)
        }

        const phone = customer?.mobile_e164 || customer?.mobile_number || null
        if (customer && customer.sms_status === 'active' && phone) {
          const firstName = getSmartFirstName(customer.first_name)
          const seatWord = input.newPartySize === 1 ? 'person' : 'people'
          const depositKindLabel = isChristmas
            ? 'Christmas deposit'
            : input.booking.booking_type === 'sunday_lunch'
              ? 'Sunday lunch deposit'
              : 'table deposit'
          const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
          const depositLabel = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(depositAmount)
          const expectedSimpleTotal = input.newPartySize * LARGE_GROUP_DEPOSIT_PER_PERSON_GBP
          const breakdownNote = depositAmount === expectedSimpleTotal
            ? ` (${input.newPartySize} x GBP ${LARGE_GROUP_DEPOSIT_PER_PERSON_GBP})`
            : ''
          const smsBody = `The Anchor: Hi ${firstName}, your party size has been updated to ${input.newPartySize} ${seatWord}. A ${depositKindLabel} of ${depositLabel}${breakdownNote} is now required to secure your booking. Pay now: ${token.url}`
          await sendSMS(phone, ensureReplyInstruction(smsBody, supportPhone), {
            customerId: input.booking.customer_id,
            metadata: {
              table_booking_id: input.booking.id,
              template_key: 'table_booking_pending_payment',
              trigger: 'party_size_threshold_crossed',
            },
          })
          smsSent = true
        }
      } catch (smsError) {
        logger.warn('Failed to send party-size deposit SMS after creating payment link', {
          metadata: {
            tableBookingId: input.booking.id,
            customerId: input.booking.customer_id,
            error: smsError instanceof Error ? smsError.message : String(smsError),
          },
        })
      }
    }

    return {
      state: 'deposit_required',
      depositUrl: token.url,
      depositAmount,
      holdExpiresAt: token.expiresAt,
      smsSent,
    }
  }

  if (wasDepositRequired && !isNowDepositRequired && input.booking.status === 'pending_payment') {
    const { error: clearError } = await supabase
      .from('table_bookings')
      .update({
        status: 'confirmed',
        payment_status: null,
        hold_expires_at: null,
        deposit_amount: null,
        paypal_deposit_order_id: null,
      })
      .eq('id', input.booking.id)

    if (clearError) {
      throw new Error(`Failed to clear pending deposit state: ${clearError.message}`)
    }

    return { state: 'deposit_cleared' }
  }

  return { state: 'unchanged' }
}
