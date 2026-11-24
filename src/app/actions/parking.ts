'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/supabase/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAppUrl } from '@/lib/env'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { formBooleanWithDefault } from '@/lib/forms/formBoolean'
import { getActiveParkingRate, getParkingBooking, updateParkingBooking } from '@/lib/parking/repository'
import { createParkingPaymentOrder, sendParkingPaymentRequest } from '@/lib/parking/payments'
import { revalidatePath, revalidateTag } from 'next/cache'
import type { ParkingBooking, ParkingBookingStatus, ParkingBookingWithBalance, ParkingPaymentStatus, ParkingRate } from '@/types/parking'
import { calculateParkingPricing, parkingRateConfigFromRecord } from '@/lib/parking/pricing'
import type { ParkingRateConfig } from '@/lib/parking/pricing'
import { createPendingParkingBooking } from '@/services/parking'
import { parkingGuestUrl, parkingPaymentReturnUrl } from '@/lib/parking/public-links'
import {
  bookingPrice,
  computeParkingBalance,
  loadParkingBalances,
  loadParkingMoneyRows,
  refundablePayments,
  roundPence,
  type ParkingBalance,
} from '@/lib/parking/balance'
import { planParkingDateChange, reminderFlagResets, sameInstant } from '@/lib/parking/change-dates'
import { refundParkingBooking, sendParkingChangeText } from '@/lib/parking/change-settlement'
import { settleWrite } from '@/lib/supabase/settle-write'
import { enforcePendingPaymentRule, isTopUpBooking } from '@/lib/parking/payment-due'
import type { ParkingChangeOutcome } from '@/lib/parking/notifications'

/**
 * The capacity trigger's refusal, worded for staff, or null for any other failure. It refuses
 * an edit that moves or lengthens a booking onto full dates, and a Payment Link that reopens a
 * lapsed booking whose space has gone. It arrives as a plain database error, which these
 * actions used to answer with only "Failed to ...".
 */
function parkingCapacityRefusal(error: unknown): string | null {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.includes('No parking spaces remaining')
    ? 'No parking spaces are free for these dates. Tick capacity override on the booking to go past the limit.'
    : null
}

const CreateParkingBookingSchema = z.object({
  customer_first_name: z.string().min(1, 'First name is required'),
  customer_last_name: z.string().optional().transform((value) => value?.trim() || undefined),
  customer_mobile: z.string().min(1, 'Mobile number is required'),
  default_country_code: z.string().regex(/^\d{1,4}$/).optional(),
  customer_email: z
    .union([z.string(), z.undefined()])
    .optional()
    .transform((value) => {
      const trimmed = typeof value === 'string' ? value.trim() : undefined
      if (!trimmed) return undefined
      const parsed = z.string().email('Invalid email').safeParse(trimmed)
      if (!parsed.success) {
        throw parsed.error
      }
      return parsed.data
    }),
  vehicle_registration: z.string().min(1, 'Vehicle registration is required'),
  vehicle_make: z.string().optional().transform((value) => value?.trim() || undefined),
  vehicle_model: z.string().optional().transform((value) => value?.trim() || undefined),
  vehicle_colour: z.string().optional().transform((value) => value?.trim() || undefined),
  start_at: z.string().datetime({ offset: true, message: 'Invalid start time' }),
  end_at: z.string().datetime({ offset: true, message: 'Invalid end time' }),
  notes: z.string().optional().transform((value) => value?.trim() || undefined),
  override_price: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value == null || value === '') return undefined
      const num = typeof value === 'number' ? value : parseFloat(value)
      return Number.isFinite(num) ? num : undefined
    }),
  override_reason: z.string().optional().transform((value) => value?.trim() || undefined),
  capacity_override: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === 'on'),
  capacity_override_reason: z.string().optional().transform((value) => value?.trim() || undefined),
  // The client now always sends this, as 'true' or 'false'. It previously only
  // appended the field when the switch was on, and an absent value defaulted to
  // true here, so turning "Send payment link now" off did nothing and the
  // payment-request SMS went out anyway. The default is kept for older callers
  // that omit the field entirely.
  send_payment_link: formBooleanWithDefault(true)
})

const UpdateParkingBookingSchema = CreateParkingBookingSchema.omit({
  send_payment_link: true,
}).extend({
  // Dates move only through Change dates (changeParkingBookingDates), so there is one path that
  // reprices and settles the money. They are accepted here only so an older caller that still
  // sends the unchanged dates keeps working; a different date is refused.
  start_at: z.string().datetime({ offset: true, message: 'Invalid start time' }).optional(),
  end_at: z.string().datetime({ offset: true, message: 'Invalid end time' }).optional(),
  override_price: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value == null || value === '') return undefined
      const num = typeof value === 'number' ? value : parseFloat(value)
      return Number.isFinite(num) ? num : undefined
    }),
})

const ParkingRateFormSchema = z.object({
  hourly_rate: z
    .union([z.string(), z.number()])
    .transform((value) => Number(value))
    .pipe(z.number().min(0).max(1000)),
  daily_rate: z
    .union([z.string(), z.number()])
    .transform((value) => Number(value))
    .pipe(z.number().min(0).max(10000)),
  weekly_rate: z
    .union([z.string(), z.number()])
    .transform((value) => Number(value))
    .pipe(z.number().min(0).max(100000)),
  monthly_rate: z
    .union([z.string(), z.number()])
    .transform((value) => Number(value))
    .pipe(z.number().min(0).max(100000)),
  capacity_override: z
    .union([z.string(), z.number(), z.undefined()])
    .optional()
    .transform((value) => {
      if (value == null || value === '') return null
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    })
    .pipe(z.number().int().min(0).max(500).nullable()),
  notes: z.string().optional().transform((value) => value?.trim() || null),
})

export async function createParkingBooking(formData: FormData) {
  try {
    const [{ user }, hasPermission] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'manage'),
    ])

    if (!user) {
      return { error: 'You need to be signed in to create a parking booking' }
    }

    if (!hasPermission) {
      return { error: 'You do not have permission to create parking bookings' }
    }

    const rawData = Object.fromEntries(formData.entries()) as Record<string, any>
    const parsedResult = CreateParkingBookingSchema.safeParse(rawData)
    if (!parsedResult.success) {
      return { error: parsedResult.error.errors[0]?.message || 'Invalid parking booking data' }
    }

    const data = parsedResult.data

    const adminClient = createAdminClient()
    const { booking } = await createPendingParkingBooking(
      {
        customer: {
          firstName: data.customer_first_name,
          lastName: data.customer_last_name,
          email: data.customer_email,
          mobile: data.customer_mobile,
          defaultCountryCode: data.default_country_code
        },
        vehicle: {
          registration: data.vehicle_registration,
          make: data.vehicle_make,
          model: data.vehicle_model,
          colour: data.vehicle_colour
        },
        startAt: data.start_at,
        endAt: data.end_at,
        notes: data.notes,
        overridePrice: data.override_price,
        overrideReason: data.override_reason,
        capacityOverride: data.capacity_override,
        capacityOverrideReason: data.capacity_override_reason,
        createdBy: user.id,
        updatedBy: user.id
      },
      { client: adminClient }
    )

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'create',
      resource_type: 'parking_booking',
      resource_id: booking.id,
      operation_status: 'success',
      new_values: {
        reference: booking.reference,
        amount: booking.override_price ?? booking.calculated_price,
        payment_due_at: booking.payment_due_at
      }
    })

    let paymentLink: string | undefined
    let paymentWarning: string | undefined
    if (data.send_payment_link) {
      try {
        const appUrl = getAppUrl()
        const { approveUrl } = await createParkingPaymentOrder(booking, {
          returnUrl: parkingPaymentReturnUrl(appUrl, booking.id),
          cancelUrl: parkingGuestUrl(appUrl, booking.id, 'cancelled'),
          client: adminClient
        })
        paymentLink = approveUrl
        await sendParkingPaymentRequest(booking, approveUrl, { client: adminClient })
      } catch (paymentError) {
        console.error('Failed to create parking payment order', paymentError)
        // The booking exists but the customer has no way to pay and has not been
        // texted. Swallowing this told staff the whole thing had worked, so
        // nobody followed up and the booking quietly expired unpaid.
        paymentWarning =
          'Booking created, but the payment link could not be generated and no payment SMS was sent. Send the payment link manually from the booking.'
      }
    }

    revalidatePath('/parking')
    revalidateTag('dashboard')

    return {
      success: true,
      booking,
      paymentLink,
      warning: paymentWarning
    }
  } catch (error) {
    console.error('Unexpected error creating parking booking', error)
    if (error instanceof Error && error.message) {
      return { error: error.message }
    }
    if (error && typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
      return { error: String((error as Record<string, unknown>).message) }
    }
    return { error: JSON.stringify(error) || 'Failed to create parking booking' }
  }
}

function escapeLikePattern(input: string) {
  return input
    .replace(/[,%_()"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

export async function listParkingBookings(options?: {
  status?: ParkingBookingStatus | 'all'
  /**
   * Restrict to several statuses at once. Used by the calendars, which want the
   * live bookings only: a cancelled or expired booking rendered there as a live
   * block that no filter could hide.
   */
  statuses?: ParkingBookingStatus[]
  paymentStatus?: ParkingPaymentStatus | 'all'
  search?: string
  limit?: number
  /**
   * Only bookings still running at or after this ISO instant (departing at or
   * after it), so a stay that began earlier but overlaps the period is kept. The
   * calendars pass midnight London time on the first day of last month, so they
   * load what they can show instead of the newest 500 of all time.
   */
  endingFrom?: string
}) {
  try {
    const supabase = await createClient()
    const [{ user }, canView] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'view'),
    ])
    if (!user) {
      return { error: 'Authentication required' }
    }

    if (!canView) {
      return { error: 'You do not have permission to view parking bookings' }
    }

    const limit = options?.limit && options.limit > 0 ? options.limit : 200

    let query = supabase
      .from('parking_bookings')
      // Every field of the ParkingBooking type, named, so the list no longer pulls the table's
      // audit columns (created_by, updated_by) or any column added later. The parking page, the
      // events calendar and agents (through the MCP bridge) read these rows: keep it in step with the type.
      .select(
        'id, reference, status, payment_status, calculated_price, override_price, override_reason, pricing_breakdown, start_at, end_at, duration_minutes, customer_id, customer_first_name, customer_last_name, customer_mobile, customer_email, vehicle_registration, vehicle_make, vehicle_model, vehicle_colour, payment_due_at, expires_at, confirmed_at, cancelled_at, completed_at, notes, capacity_override, capacity_override_reason, payment_overdue_notified, start_notification_sent, end_notification_sent, initial_request_sms_sent, unpaid_week_before_sms_sent, unpaid_day_before_sms_sent, paid_start_three_day_sms_sent, paid_end_three_day_sms_sent, created_at, updated_at'
      )
      .order('start_at', { ascending: false })
      .limit(limit)

    if (options?.status && options.status !== 'all') {
      query = query.eq('status', options.status)
    }

    if (options?.statuses && options.statuses.length > 0) {
      query = query.in('status', options.statuses)
    }

    if (options?.paymentStatus && options.paymentStatus !== 'all') {
      query = query.eq('payment_status', options.paymentStatus)
    }

    if (options?.endingFrom) {
      const endingFrom = new Date(options.endingFrom)
      if (Number.isNaN(endingFrom.getTime())) {
        return { error: 'Invalid start date for parking bookings' }
      }
      query = query.gte('end_at', endingFrom.toISOString())
    }

    if (options?.search) {
      const trimmed = options.search.trim()
      if (trimmed.length > 0) {
        const pattern = escapeLikePattern(trimmed)
        query = query.or(
          `reference.ilike.%${pattern}%,customer_first_name.ilike.%${pattern}%,customer_last_name.ilike.%${pattern}%`,
        )
      }
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching parking bookings:', error)
      return { error: 'Failed to load parking bookings' }
    }

    const rows = (data || []) as ParkingBooking[]

    // Each booking's balance (spec section 5), so the list can show "£X to pay" or "£X refund to
    // do". Read with the admin client: the caller's parking view permission is already checked,
    // and the payments and refunds tables are not all readable by the signed-in role. If the
    // money cannot be read the list still loads, with no balance shown, rather than failing.
    let balances = new Map<string, ParkingBalance>()
    try {
      balances = await loadParkingBalances(createAdminClient(), rows)
    } catch (balanceError) {
      console.error('Failed to load parking balances for the list', balanceError)
    }

    return {
      success: true,
      data: rows.map((row) => ({ ...row, balance: balances.get(row.id) ?? null })) as ParkingBookingWithBalance[],
    }
  } catch (error) {
    console.error('Unexpected error listing parking bookings', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getParkingBookingNotifications(bookingId: string) {
  try {
    const supabase = await createClient()
    const [{ user }, canView] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'view'),
    ])
    if (!user) {
      return { error: 'Authentication required' }
    }

    if (!canView) {
      return { error: 'You do not have permission to view parking bookings' }
    }

    const { data, error } = await supabase
      .from('parking_booking_notifications')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading parking notifications:', error)
      return { error: 'Failed to load notifications' }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error('Unexpected error loading parking notifications', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getParkingRateConfig(): Promise<{ success: true; data: ParkingRateConfig } | { error: string }> {
  try {
    const [{ user }, canManage] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'manage'),
    ])
    if (!user) {
      return { error: 'Authentication required' }
    }

    if (!canManage) {
      return { error: 'You do not have permission to manage parking bookings' }
    }

    const adminClient = createAdminClient()
    const rateRecord = await getActiveParkingRate(adminClient)

    if (!rateRecord) {
      return { error: 'Parking rates have not been configured' }
    }

    const config: ParkingRateConfig = parkingRateConfigFromRecord(rateRecord)

    return { success: true, data: config }
  } catch (error) {
    console.error('Failed to load parking rate configuration', error)
    return { error: 'Failed to load parking rate configuration' }
  }
}

export async function getParkingRateSettings(): Promise<{ success: true; data: ParkingRate } | { error: string }> {
  try {
    const [{ user }, canManage] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'manage'),
    ])
    if (!user) {
      return { error: 'Authentication required' }
    }
    if (!canManage) {
      return { error: 'You do not have permission to manage parking rates' }
    }

    const rateRecord = await getActiveParkingRate(createAdminClient())
    if (!rateRecord) {
      return { error: 'Parking rates have not been configured' }
    }

    return { success: true, data: rateRecord }
  } catch (error) {
    console.error('Failed to load parking rate settings', error)
    return { error: 'Failed to load parking rate settings' }
  }
}

export async function saveParkingRateConfig(formData: FormData) {
  try {
    const [{ user }, canManage] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'manage'),
    ])
    if (!user) {
      return { error: 'Authentication required' }
    }
    if (!canManage) {
      return { error: 'You do not have permission to manage parking rates' }
    }

    const parsed = ParkingRateFormSchema.safeParse(Object.fromEntries(formData.entries()))
    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message || 'Invalid parking rate data' }
    }

    const adminClient = createAdminClient()
    const { data: rate, error } = await adminClient
      .from('parking_rates')
      .insert({
        hourly_rate: parsed.data.hourly_rate,
        daily_rate: parsed.data.daily_rate,
        weekly_rate: parsed.data.weekly_rate,
        monthly_rate: parsed.data.monthly_rate,
        capacity_override: parsed.data.capacity_override,
        notes: parsed.data.notes,
        effective_from: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (error) {
      console.error('Failed to save parking rates:', error)
      return { error: 'Failed to save parking rates' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'create',
      resource_type: 'parking_rate',
      resource_id: rate.id,
      operation_status: 'success',
      new_values: rate as Record<string, unknown>,
    })

    revalidatePath('/parking')
    revalidateTag('dashboard')

    return { success: true, data: rate as ParkingRate }
  } catch (error) {
    console.error('Unexpected error saving parking rates', error)
    return { error: 'Failed to save parking rates' }
  }
}

export async function updateParkingBookingDetails(bookingId: string, formData: FormData) {
  try {
    const [{ user }, hasPermission] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'manage'),
    ])
    if (!user) {
      return { error: 'Authentication required' }
    }
    if (!hasPermission) {
      return { error: 'You do not have permission to update parking bookings' }
    }

    const parsed = UpdateParkingBookingSchema.safeParse(Object.fromEntries(formData.entries()))
    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message || 'Invalid parking booking data' }
    }

    const adminClient = createAdminClient()
    const existing = await getParkingBooking(bookingId, adminClient)
    if (!existing) {
      return { error: 'Parking booking not found' }
    }
    if (existing.status === 'cancelled' || existing.status === 'completed') {
      return { error: `Parking booking cannot be edited because it is ${existing.status}` }
    }

    const data = parsed.data

    // Compare instants, not strings. PostgREST returns "2026-08-11T09:00:00+00:00"
    // while the client sends "2026-08-11T09:00:00.000Z", so a string comparison
    // reported every paid booking as price-affected and refused every edit,
    // including ones that only corrected a customer's name.
    if (
      (data.start_at && !sameInstant(existing.start_at, data.start_at)) ||
      (data.end_at && !sameInstant(existing.end_at, data.end_at))
    ) {
      return { error: 'Use Change dates to move a booking\'s dates. It reprices the stay and settles the money.' }
    }

    const overrideChanged = Number(existing.override_price ?? 0) !== Number(data.override_price ?? 0)

    if (overrideChanged && ['paid', 'refunded'].includes(existing.payment_status)) {
      return { error: 'A paid booking\'s price cannot be edited here. Use Change dates to change its dates.' }
    }

    const payload = {
      customer_first_name: data.customer_first_name,
      customer_last_name: data.customer_last_name ?? null,
      customer_mobile: data.customer_mobile,
      customer_email: data.customer_email ?? null,
      vehicle_registration: data.vehicle_registration,
      vehicle_make: data.vehicle_make ?? null,
      vehicle_model: data.vehicle_model ?? null,
      vehicle_colour: data.vehicle_colour ?? null,
      // Dates and the calculated price are deliberately not written here. Recomputing the price on
      // every edit meant a name correction after a rate change quietly changed what a paid
      // booking owed; only Change dates reprices a stay.
      notes: data.notes ?? null,
      override_price: data.override_price ?? null,
      override_reason: data.override_reason ?? null,
      capacity_override: data.capacity_override,
      capacity_override_reason: data.capacity_override_reason ?? null,
      updated_by: user.id,
    }

    const updated = await updateParkingBooking(bookingId, payload, adminClient)

    if (existing.payment_status === 'pending') {
      const nextAmount = updated.override_price ?? updated.calculated_price ?? 0

      // The pending row holds the PayPal approve_url the guest pay link depends
      // on. Replacing metadata wholesale destroyed it, and because
      // createParkingPaymentOrder reuses any pending row and returns
      // metadata.approve_url || '', one edit broke the customer's pay link for
      // good.
      const { data: pendingPayments, error: pendingFetchError } = await adminClient
        .from('parking_booking_payments')
        .select('id, amount, metadata')
        .eq('booking_id', bookingId)
        .eq('status', 'pending')

      if (pendingFetchError) {
        console.error('Failed to load pending parking payment:', pendingFetchError)
        return { error: 'Booking updated but pending payment could not be read' }
      }

      for (const payment of pendingPayments ?? []) {
        const existingMetadata = (payment.metadata ?? {}) as Record<string, unknown>
        const amountChanged = Number(payment.amount) !== Number(nextAmount)

        // A PayPal order is created for a fixed amount, so once the price
        // changes the existing order is for the wrong sum. Expire it rather than
        // let it be reused, and createParkingPaymentOrder will mint a fresh one
        // at the new amount on the next payment request.
        const { error: paymentError } = await adminClient
          .from('parking_booking_payments')
          .update({
            amount: nextAmount,
            ...(amountChanged ? { status: 'expired' as const } : {}),
            metadata: {
              ...existingMetadata,
              parking_booking_edited: true,
              edited_at: new Date().toISOString(),
              edited_by: user.id,
              ...(amountChanged
                ? {
                    superseded_reason: 'amount_changed_on_edit',
                    superseded_amount: payment.amount,
                  }
                : {}),
            },
          })
          .eq('id', payment.id)

        if (paymentError) {
          console.error('Failed to update pending parking payment amount:', paymentError)
          return { error: 'Booking updated but pending payment amount could not be updated' }
        }
      }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      resource_type: 'parking_booking',
      resource_id: bookingId,
      operation_status: 'success',
      old_values: existing as unknown as Record<string, unknown>,
      new_values: payload,
      additional_info: { action: 'edit_parking_booking' },
    })

    revalidatePath('/parking')
    revalidateTag('dashboard')

    return { success: true, booking: updated }
  } catch (error) {
    console.error('Failed to update parking booking details', error)
    return { error: parkingCapacityRefusal(error) ?? 'Failed to update parking booking' }
  }
}

async function getParkingBookingById(bookingId: string) {
  try {
    const hasPermission = await checkUserPermission('parking', 'view')
    if (!hasPermission) {
      return { error: 'You do not have permission to view parking bookings' }
    }

    const supabase = createAdminClient()
    const booking = await getParkingBooking(bookingId, supabase)

    if (!booking) {
      return { error: 'Parking booking not found' }
    }

    return { success: true, booking }
  } catch (error) {
    console.error('Failed to fetch parking booking', error)
    return { error: 'Failed to fetch parking booking' }
  }
}

export async function updateParkingBookingStatus(
  bookingId: string,
  updates: Partial<Pick<ParkingBooking, 'status' | 'payment_status' | 'notes' | 'cancelled_at'>>
) {
  try {
    const [{ user }, hasPermission] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'manage'),
    ])
    if (!user) {
      return { error: 'Unauthorized' }
    }

    if (!hasPermission) {
      return { error: 'You do not have permission to update parking bookings' }
    }

    // Staff cancel or complete a booking here, and that is all the parking screen asks of it.
    // Confirming one goes through Mark Paid or a payment, which also record the money: the
    // capacity trigger lets a lapsed booking back in on full dates only because it has been
    // paid for, so a status-only confirm must not reach it (Codex review of PR 243).
    if (updates.status !== undefined && updates.status !== 'cancelled' && updates.status !== 'completed') {
      return { error: 'A booking can only be cancelled or completed here' }
    }

    const adminClient = createAdminClient()

    const existing = await getParkingBooking(bookingId, adminClient)
    if (!existing) {
      return { error: 'Parking booking not found' }
    }

    let updatesToApply = { ...updates }
    const nowIso = new Date().toISOString()

    // If cancelled without an explicit payment status, derive an appropriate payment status and sync the latest payment record.
    if (updates.status === 'cancelled') {
      const currentPaymentStatus = existing.payment_status
      let nextPaymentStatus = updates.payment_status ?? currentPaymentStatus

      // Cancelling is not refunding. This used to rewrite a paid booking to
      // 'refunded' without calling PayPal or writing a payment_refunds row, so
      // the money never moved, and because the refund entry points only act on
      // a paid booking, staff were then locked out of issuing the real refund.
      // A cancelled booking stays 'paid' until an explicit refund is processed,
      // which is also the honest signal that one is owed.
      if (currentPaymentStatus === 'pending') {
        nextPaymentStatus = 'failed'
      }

      if (!updates.payment_status && nextPaymentStatus !== currentPaymentStatus) {
        updatesToApply = { ...updatesToApply, payment_status: nextPaymentStatus }
      }

      if (!updatesToApply.cancelled_at && !existing.cancelled_at) {
        updatesToApply = { ...updatesToApply, cancelled_at: nowIso }
      }

      const { data: latestPayment, error: latestPaymentError } = await adminClient
        .from('parking_booking_payments')
        .select('*')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestPaymentError) {
        console.error('Failed to load latest parking payment during cancellation:', latestPaymentError)
        return { error: 'Failed to update booking payment status' }
      }

      if (latestPayment) {
        const paymentUpdates: Record<string, unknown> = {
          metadata: {
            ...(latestPayment.metadata || {}),
            cancelled_booking: true,
            cancelled_at: nowIso
          }
        }

        if (nextPaymentStatus === 'failed' && latestPayment.status === 'pending') {
          Object.assign(paymentUpdates, { status: 'failed' })
        }

        // Deliberately does not mark the payment row refunded. Only a real
        // refund through processPayPalRefund may do that, and it also writes the
        // payment_refunds row the refund history is built from. A paid booking
        // that gets cancelled therefore keeps status 'paid', and the metadata
        // stamp below is what records that a refund is owed.
        const { data: updatedPayment, error: paymentUpdateError } = await adminClient
          .from('parking_booking_payments')
          .update(paymentUpdates)
          .eq('id', latestPayment.id)
          .select('id')
          .maybeSingle()

        if (paymentUpdateError) {
          console.error('Failed to update parking payment during cancellation:', paymentUpdateError)
          return { error: 'Failed to update booking payment status' }
        }

        if (!updatedPayment) {
          return { error: 'Failed to update booking payment status' }
        }
      }
    }

    const booking = await updateParkingBooking(bookingId, updatesToApply, adminClient)

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'parking_booking',
      resource_id: bookingId,
      operation_status: 'success',
      new_values: updatesToApply as Record<string, unknown>
    })

    revalidatePath('/parking')
    revalidateTag('dashboard')

    return { success: true, booking }
  } catch (error) {
    console.error('Failed to update parking booking', error)
    return { error: 'Failed to update parking booking' }
  }
}

export async function generateParkingPaymentLink(bookingId: string) {
  try {
    const [{ user }, hasPermission] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'manage'),
    ])
    if (!user) {
      return { error: 'Unauthorized' }
    }

    if (!hasPermission) {
      return { error: 'You do not have permission to manage parking payments' }
    }

    const adminClient = createAdminClient()
    const booking = await getParkingBooking(bookingId, adminClient)
    if (!booking) {
      return { error: 'Parking booking not found' }
    }

    // A confirmed, paid booking with a balance (its dates grew): the link charges the balance only,
    // as a top-up, and the booking's status, payment status and deadline are never touched. Its
    // offer deadline is long past, and resetting it here would un-confirm a live booking and let
    // the lifecycle cron expire it (spec section 7).
    if (isTopUpBooking(booking)) {
      const rule = await enforcePendingPaymentRule(adminClient, booking)
      if (!rule.due || rule.due.purpose !== 'top_up') {
        return { error: 'Nothing is owed on this booking, so there is no payment link to send' }
      }
      const appUrl = getAppUrl()
      const { approveUrl } = await createParkingPaymentOrder(booking as ParkingBooking, {
        returnUrl: parkingPaymentReturnUrl(appUrl, booking.id),
        cancelUrl: parkingGuestUrl(appUrl, booking.id, 'cancelled'),
        client: adminClient,
        amount: rule.due.amount,
        purpose: 'top_up',
      })
      if (!approveUrl) {
        return { error: 'PayPal did not return an approval link' }
      }
      await logAuditEvent({
        user_id: user.id,
        operation_type: 'update',
        resource_type: 'parking_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: { action: 'generate_payment_link', purpose: 'top_up', amount: rule.due.amount },
      })
      revalidatePath('/parking')
      revalidateTag('dashboard')
      return { success: true, approveUrl, amount: rule.due.amount }
    }

    if (booking.status === 'cancelled' || booking.status === 'completed') {
      return { error: `This booking is ${booking.status}, so there is no payment link to send` }
    }

    let dueAt = booking.payment_due_at ? new Date(booking.payment_due_at) : null
    if (!dueAt || dueAt < new Date()) {
      dueAt = new Date()
      dueAt.setDate(dueAt.getDate() + 7)
      await updateParkingBooking(
        bookingId,
        {
          status: 'pending_payment',
          payment_status: 'pending',
          payment_due_at: dueAt.toISOString(),
          expires_at: dueAt.toISOString(),
          payment_overdue_notified: false,
          unpaid_week_before_sms_sent: false,
          unpaid_day_before_sms_sent: false
        },
        adminClient
      )
      booking.status = 'pending_payment'
      booking.payment_status = 'pending'
      booking.payment_due_at = dueAt.toISOString()
      booking.expires_at = dueAt.toISOString()
      booking.payment_overdue_notified = false
      booking.unpaid_week_before_sms_sent = false
      booking.unpaid_day_before_sms_sent = false
    }

    const appUrl = getAppUrl()

    const { approveUrl } = await createParkingPaymentOrder(booking as ParkingBooking, {
      returnUrl: parkingPaymentReturnUrl(appUrl, booking.id),
      cancelUrl: parkingGuestUrl(appUrl, booking.id, 'cancelled'),
      client: adminClient
    })

    if (!approveUrl) {
      return { error: 'PayPal did not return an approval link' }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      resource_type: 'parking_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        action: 'generate_payment_link'
      }
    })

    revalidatePath('/parking')
    revalidateTag('dashboard')

    return { success: true, approveUrl }
  } catch (error) {
    console.error('Failed to generate parking payment link', error)
    return { error: parkingCapacityRefusal(error) ?? 'Failed to generate payment link' }
  }
}

/**
 * Records money taken at the venue (cash or the card terminal) for what a parking booking owes.
 *
 * - A booking still waiting for its first payment: records its whole price and confirms it.
 * - A confirmed, paid booking with a balance (its dates grew): records the balance as a top-up and
 *   leaves the booking's status alone.
 *
 * It never rewrites an existing payment row. A pending PayPal link is expired and a separate
 * `provider = 'manual'` row is written, so a later refund of it is a cash or bank refund, never a
 * PayPal one, and the online income page (PayPal only) does not count it. The booking is claimed
 * on its updated_at first, so a double press records the money once.
 */
export async function markParkingBookingPaid(bookingId: string, input: { method?: 'cash' | 'card_terminal' } = {}) {
  try {
    const [{ user }, hasPermission] = await Promise.all([
      getCurrentUser(),
      checkUserPermission('parking', 'manage'),
    ])
    if (!user) {
      return { error: 'Unauthorized' }
    }

    if (!hasPermission) {
      return { error: 'You do not have permission to update parking bookings' }
    }

    const adminClient = createAdminClient()
    const booking = await getParkingBooking(bookingId, adminClient)
    if (!booking) {
      return { error: 'Parking booking not found' }
    }

    // Confirming a cancelled or completed one claims a space again, which the capacity trigger can
    // refuse, after the money had already been recorded. Hold a direct call to the same rule.
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      return { error: `This booking is ${booking.status}, so it cannot be marked as paid` }
    }

    const topUp = isTopUpBooking(booking)
    const money = await loadParkingMoneyRows(adminClient, [booking.id])
    const owed = topUp
      ? computeParkingBalance(booking, money.payments, money.refunds)
      : null
    const amount = topUp ? (owed && owed.state === 'to_pay' ? owed.balance : 0) : bookingPrice(booking)
    if (!amount || amount <= 0) {
      return { error: topUp ? 'Nothing is owed on this booking' : 'This booking has no price to record' }
    }

    // Claim the booking first: a second press, or another member of staff at the same moment,
    // finds it changed and records nothing.
    const nowIso = new Date().toISOString()
    const { data: claimed, error: claimError } = await adminClient
      .from('parking_bookings')
      .update({ updated_by: user.id })
      .eq('id', booking.id)
      .eq('updated_at', booking.updated_at)
      .select('id')
      .maybeSingle()
    if (claimError) {
      console.error('Failed to claim parking booking for Mark Paid:', claimError)
      return { error: 'Failed to update payment status' }
    }
    if (!claimed) {
      return { error: 'This booking has just changed. Refresh it and check what is owed before marking it paid.' }
    }

    // Retire any pending PayPal link: what it was for is now paid.
    for (const pending of money.payments.filter((payment) => payment.status === 'pending')) {
      const ok = await settleWrite(
        adminClient
          .from('parking_booking_payments')
          .update({
            status: 'expired',
            metadata: {
              ...((pending.metadata as Record<string, unknown> | null) ?? {}),
              superseded_at: nowIso,
              superseded_reason: 'paid_at_venue',
            },
          })
          .eq('id', pending.id)
          .eq('status', 'pending'),
        { table: 'parking_booking_payments', what: 'Retiring the payment link before recording a venue payment', ids: { bookingId, paymentId: pending.id } }
      )
      if (!ok) return { error: 'Failed to update payment status' }
    }

    // The claim above stops a press made from a stale screen, but not a second request that reads
    // the booking just after it. So the row goes in as PENDING first: the unique index allows one
    // pending row per booking, so only one request can hold that slot at a time. The holder then
    // re-reads what is owed, with every other payment settled, and only then turns its row paid.
    const { data: slot, error: paymentInsertError } = await adminClient
      .from('parking_booking_payments')
      .insert({
        booking_id: bookingId,
        provider: 'manual',
        status: 'pending',
        amount,
        currency: 'GBP',
        metadata: {
          manual_settlement: true,
          settled_by: user.id,
          method: input.method ?? 'cash',
          purpose: topUp ? 'top_up' : 'booking',
        },
      })
      .select('id')
      .single()

    if (paymentInsertError || !slot) {
      if ((paymentInsertError as { code?: unknown } | null)?.code === '23505') {
        return { error: 'This booking is being updated by someone else. Refresh it and check what is owed.' }
      }
      console.error('Failed to create parking payment record:', paymentInsertError)
      return { error: 'Failed to update payment status' }
    }

    const releaseSlot = async (reason: string) => {
      await settleWrite(
        adminClient
          .from('parking_booking_payments')
          .update({ status: 'expired', metadata: { manual_settlement: true, superseded_at: new Date().toISOString(), superseded_reason: reason } })
          .eq('id', slot.id)
          .eq('status', 'pending'),
        { table: 'parking_booking_payments', what: 'Releasing an unused venue payment', ids: { bookingId, paymentId: slot.id } }
      )
    }

    const recheck = await loadParkingMoneyRows(adminClient, [booking.id])
    const stillOwed = topUp
      ? (() => {
          const now = computeParkingBalance(booking, recheck.payments, recheck.refunds)
          return now.state === 'to_pay' ? now.balance : 0
        })()
      : recheck.payments.some((payment) => payment.status === 'paid')
        ? 0
        : amount
    if (Math.abs(stillOwed - amount) > 0.005) {
      await releaseSlot('already_paid')
      return { error: 'This booking has just been paid. Refresh it and check what is owed.' }
    }

    const { data: settled, error: settleError } = await adminClient
      .from('parking_booking_payments')
      .update({ status: 'paid', paid_at: nowIso })
      .eq('id', slot.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (settleError || !settled) {
      console.error('Failed to settle the venue payment row:', settleError)
      await releaseSlot('settle_failed')
      return { error: 'Failed to update payment status' }
    }

    const updated = topUp
      ? ((await getParkingBooking(bookingId, adminClient)) ?? booking)
      : await updateParkingBooking(
          bookingId,
          {
            status: 'confirmed',
            payment_status: 'paid',
            confirmed_at: nowIso,
            paid_start_three_day_sms_sent: false,
            paid_end_three_day_sms_sent: false
          },
          adminClient
        )

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      resource_type: 'parking_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        action: 'mark_paid',
        amount,
        method: input.method ?? 'cash',
        purpose: topUp ? 'top_up' : 'booking',
      }
    })

    revalidatePath('/parking')
    revalidateTag('dashboard')

    return { success: true, booking: updated, amount }
  } catch (error) {
    console.error('Failed to mark parking booking as paid', error)
    return { error: parkingCapacityRefusal(error) ?? 'Failed to update payment status' }
  }
}

// ---------------------------------------------------------------------------------------------
// Change dates (spec tasks/spec-2026-11-24-parking-change-time-and-settle.md)
// ---------------------------------------------------------------------------------------------

const ChangeDatesWindowSchema = z.object({
  start_at: z.string().datetime({ offset: true, message: 'Invalid start time' }),
  end_at: z.string().datetime({ offset: true, message: 'Invalid end time' }),
})

const ChangeParkingDatesSchema = ChangeDatesWindowSchema.extend({
  /** A UUID made once per opening of the dialog, so a double click or retry is recognised. */
  changeId: z.string().uuid('Invalid change id'),
  /** The booking's updated_at when the dialog loaded: a booking changed since is refused. */
  expectedUpdatedAt: z.string().min(1),
  /** The new price the screen showed. If the server works out a different one, nothing happens. */
  expectedNewPrice: z.number().nonnegative(),
  notifyCustomer: z.boolean().default(true),
  /** Unpaid bookings only: text the new payment link. */
  sendPaymentLink: z.boolean().default(true),
  /** Paid bookings that now cost less: what to refund (0 up to the difference). */
  refundAmount: z.number().nonnegative().optional(),
  refundReason: z.string().trim().max(500).optional(),
  manualRefundMethod: z.enum(['cash', 'bank_transfer']).default('cash'),
  /**
   * Paid bookings that now cost more (D4): text a payment link for the extra, record it as paid
   * at the venue, or charge nothing extra (reason required).
   */
  extraChoice: z.enum(['link', 'venue', 'waive']).optional(),
  /** The extra the screen showed. If the server works out a different one, nothing happens. */
  expectedExtra: z.number().nonnegative().optional(),
  venueMethod: z.enum(['cash', 'card_terminal']).default('cash'),
  waiveReason: z.string().trim().max(500).optional(),
})

export type ParkingDateChangePreview = {
  bookingId: string
  updatedAt: string
  oldPrice: number
  newPrice: number
  netPaid: number
  balanceAfter: number
  kind: 'unpaid' | 'none' | 'refund' | 'extra'
  refundDue: number
  refundDefault: number
  extraDue: number
  insideNoRefundWindow: boolean
  started: boolean
  ended: boolean
  hadOverride: boolean
  overridePrice: number | null
  canRefund: boolean
  paypalRefundPossible: boolean
  /** True: a paid booking that would cost more can be changed, with one of the three choices. */
  extendingPaidAvailable: boolean
}

async function loadChangeContext(bookingId: string, window: { start_at: string; end_at: string }) {
  const adminClient = createAdminClient()
  const booking = await getParkingBooking(bookingId, adminClient)
  if (!booking) return { error: 'Parking booking not found' as const }
  const rateRecord = await getActiveParkingRate(adminClient)
  if (!rateRecord) return { error: 'Parking rates have not been configured' as const }
  const money = await loadParkingMoneyRows(adminClient, [booking.id])
  const result = planParkingDateChange({
    booking,
    payments: money.payments,
    refunds: money.refunds,
    newStartAt: window.start_at,
    newEndAt: window.end_at,
    rates: parkingRateConfigFromRecord(rateRecord),
    now: new Date(),
  })
  return { adminClient, booking, money, result }
}

/**
 * Prices a proposed change of dates on the server (the dialog never prices in the browser) and
 * says how the difference would be settled. Reads only.
 */
export async function previewParkingDateChange(
  bookingId: string,
  window: { start_at: string; end_at: string }
): Promise<{ success: true; data: ParkingDateChangePreview } | { error: string }> {
  try {
    const [{ user }, canManage] = await Promise.all([getCurrentUser(), checkUserPermission('parking', 'manage')])
    if (!user) return { error: 'Authentication required' }
    if (!canManage) return { error: 'You do not have permission to change parking bookings' }

    const parsed = ChangeDatesWindowSchema.safeParse(window)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message || 'Invalid dates' }

    const context = await loadChangeContext(bookingId, parsed.data)
    if ('error' in context) return { error: context.error as string }
    if (!context.result.ok) return { error: context.result.error }

    const plan = context.result.plan
    const canRefund = await checkUserPermission('parking', 'refund')
    return {
      success: true,
      data: {
        bookingId,
        updatedAt: context.booking.updated_at,
        oldPrice: plan.oldPrice,
        newPrice: plan.newPrice,
        netPaid: plan.netPaid,
        balanceAfter: plan.balanceAfter,
        kind: plan.kind,
        refundDue: plan.refundDue,
        refundDefault: plan.refundDefault,
        extraDue: plan.extraDue,
        insideNoRefundWindow: plan.insideNoRefundWindow,
        started: plan.started,
        ended: plan.ended,
        hadOverride: plan.hadOverride,
        overridePrice: plan.hadOverride ? Number(context.booking.override_price) : null,
        canRefund,
        paypalRefundPossible: plan.paypalRefundPossible,
        extendingPaidAvailable: true,
      },
    }
  } catch (error) {
    console.error('Failed to preview a parking date change', error)
    return { error: 'Could not work out the new price' }
  }
}

export type ChangeParkingBookingDatesResult = {
  success?: boolean
  error?: string
  /** Something after the save did not happen (a refund, a link, the text). Never a failed change. */
  warning?: string
  /** True when this change had already been saved (a retry of the same dialog). */
  alreadyApplied?: boolean
  booking?: ParkingBooking
  /** A payment link to copy, when one was made. */
  paymentLink?: string
  textStatus?: 'sent' | 'held' | 'skipped' | 'failed' | 'not_sent'
  textNote?: string | null
  refunded?: number
}

/**
 * Changes a parking booking's dates and settles the money in one save (staff only, D9).
 *
 * Order matters: the booking is saved first, which is where the capacity trigger claims (or
 * refuses) the new space, and only then does any money move or any text go. A failure after the
 * save never rolls the dates back: it comes back as `success` with a `warning` saying what did not
 * happen, and the booking keeps showing its balance until someone settles it. Paid bookings that
 * would cost more take one of three choices (D4): a payment link for the extra, paid at the venue,
 * or no extra charge with a reason.
 *
 * Needs parking "manage". Sending a refund also needs parking "refund"; without it the change
 * saves and the booking shows the refund as still to do. Refunds are keyed on the changeId plus
 * the payment id, so the same dialog submitted twice sends one refund and one text.
 */
export async function changeParkingBookingDates(
  bookingId: string,
  input: z.input<typeof ChangeParkingDatesSchema>
): Promise<ChangeParkingBookingDatesResult> {
  try {
    const [{ user }, canManage] = await Promise.all([getCurrentUser(), checkUserPermission('parking', 'manage')])
    if (!user) return { error: 'Authentication required' }
    if (!canManage) return { error: 'You do not have permission to change parking bookings' }

    const parsed = ChangeParkingDatesSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message || 'Invalid change' }
    const data = parsed.data

    const adminClient = createAdminClient()

    // A retry of a change already saved (same dialog, same changeId): say so, move nothing.
    const { data: earlier, error: earlierError } = await adminClient
      .from('parking_booking_notifications')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('event_type', 'booking_changed')
      .contains('payload', { change_id: data.changeId })
      .limit(1)
      .maybeSingle()
    if (earlierError) {
      console.error('Failed to check for an earlier parking change', earlierError)
      return { error: 'Could not check whether this change was already saved. Try again.' }
    }
    if (earlier) {
      const current = await getParkingBooking(bookingId, adminClient)
      return { success: true, alreadyApplied: true, booking: current ?? undefined }
    }

    const context = await loadChangeContext(bookingId, data)
    if ('error' in context) return { error: context.error as string }
    const { booking, money } = context
    if (!context.result.ok) return { error: context.result.error }
    const plan = context.result.plan

    if (!sameInstant(booking.updated_at, data.expectedUpdatedAt)) {
      return { error: 'This booking has changed since you opened Change dates. Close it and open it again.' }
    }

    if (Math.abs(plan.newPrice - data.expectedNewPrice) > 0.005) {
      return {
        error: `The new price is now £${plan.newPrice.toFixed(2)}, not £${data.expectedNewPrice.toFixed(2)}. Check the figures and save again.`,
      }
    }

    // How a dearer stay is settled (D4). The extra is re-checked against the screen, because a
    // top-up captured since the dialog opened changes what is owed without touching updated_at.
    if (plan.kind === 'extra') {
      if (!data.extraChoice) {
        return { error: `This change costs £${plan.extraDue.toFixed(2)} more. Choose how the extra is settled.` }
      }
      if (data.expectedExtra !== undefined && Math.abs(plan.extraDue - data.expectedExtra) > 0.005) {
        return {
          error: `The extra to pay is now £${plan.extraDue.toFixed(2)}, not £${data.expectedExtra.toFixed(2)}. Check the figures and save again.`,
        }
      }
      if (data.extraChoice === 'waive' && !data.waiveReason) {
        return { error: 'Give a reason for not charging the extra.' }
      }
    }

    // How a cheaper stay is settled (D1 to D3, D6, and "an amount settled is settled").
    let refundToSend = 0
    let overridePrice: number | null = null
    let overrideReason: string | null = null
    const canRefund = plan.kind === 'refund' ? await checkUserPermission('parking', 'refund') : false
    if (plan.kind === 'refund' && canRefund) {
      const chosen = roundPence(data.refundAmount ?? plan.refundDefault)
      if (chosen < 0 || chosen > plan.refundDue + 0.005) {
        return { error: `The refund can be between £0.00 and £${plan.refundDue.toFixed(2)}.` }
      }
      if (chosen < plan.refundDue && !data.refundReason) {
        return { error: 'Give a reason for refunding less than the difference.' }
      }
      refundToSend = chosen
      if (chosen < plan.refundDue) {
        // The rest is kept, not left as a refund to do: the price becomes what will have been paid.
        overridePrice = roundPence(plan.netPaid - chosen)
        overrideReason = `Dates changed; £${roundPence(plan.refundDue - chosen).toFixed(2)} of the difference kept: ${data.refundReason}`
      }
    }

    if (plan.kind === 'extra' && data.extraChoice === 'waive') {
      // No extra charge: the price becomes what has been paid, so the balance is zero.
      overridePrice = plan.netPaid
      overrideReason = `Dates changed; £${plan.extraDue.toFixed(2)} extra not charged: ${data.waiveReason}`
    }

    const now = new Date()
    const resets = reminderFlagResets({
      startMoved: plan.startMoved,
      endMoved: plan.endMoved,
      newStartAt: data.start_at,
      newEndAt: data.end_at,
      now,
    })

    const payload: Record<string, unknown> = {
      start_at: data.start_at,
      end_at: data.end_at,
      duration_minutes: plan.pricing.durationMinutes,
      calculated_price: plan.newPrice,
      pricing_breakdown: plan.pricing.breakdown,
      // A date change clears any old agreed price and starts from the calculated one. While a
      // refund is on its way the price is held at what has been paid, so the booking reads
      // settled and nobody can send the same difference again from Refund to do; it is set to
      // its final figure once the refund has gone (claimRefundThenSettle below).
      override_price: refundToSend > 0 ? plan.netPaid : overridePrice,
      override_reason: refundToSend > 0 ? REFUND_IN_PROGRESS_REASON : overrideReason,
      updated_by: user.id,
      ...(resets.resetStart ? { paid_start_three_day_sms_sent: false, start_notification_sent: false } : {}),
      ...(resets.resetEnd ? { paid_end_three_day_sms_sent: false, end_notification_sent: false } : {}),
    }

    // An unpaid booking whose offer deadline has passed gets a fresh 7-day one, as Payment Link
    // does; otherwise the deadline is left alone.
    if (plan.kind === 'unpaid' && (!booking.payment_due_at || new Date(booking.payment_due_at) < now)) {
      const dueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
      Object.assign(payload, {
        payment_due_at: dueAt,
        expires_at: dueAt,
        payment_overdue_notified: false,
        unpaid_week_before_sms_sent: false,
        unpaid_day_before_sms_sent: false,
      })
    }

    // Step 4: save. The capacity trigger runs here. Guarded on updated_at, so two people saving
    // the same booking at once cannot both settle the same difference.
    const { data: saved, error: saveError } = await adminClient
      .from('parking_bookings')
      .update(payload)
      .eq('id', booking.id)
      .eq('updated_at', booking.updated_at)
      .select('*')
      .maybeSingle()
    if (saveError) {
      console.error('Failed to save parking date change', saveError)
      return { error: parkingCapacityRefusal(saveError) ?? 'Failed to change the dates' }
    }
    if (!saved) {
      return { error: 'This booking has changed since you opened Change dates. Close it and open it again.' }
    }
    let updated = saved as ParkingBooking

    // The change's marker: records the changeId (so a retry is recognised) and tells the reminder
    // cron a start or end reminder may go again for the new dates.
    let markerId: string | null = null
    {
      const { data: marker, error: markerError } = await adminClient
        .from('parking_booking_notifications')
        .insert({
          booking_id: booking.id,
          channel: 'sms',
          event_type: 'booking_changed',
          status: 'queued',
          payload: {
            template_key: 'parking_booking_changed',
            change_id: data.changeId,
            old_start_at: booking.start_at,
            old_end_at: booking.end_at,
            new_start_at: updated.start_at,
            new_end_at: updated.end_at,
            old_price: plan.oldPrice,
            // The price for the new dates. bookingPrice(updated) read the held price while a refund
            // was on its way, and logged the old figure (seen on the live test, 24 November 2026).
            new_price: plan.newPrice,
            start_moved: plan.startMoved,
            end_moved: plan.endMoved,
            reset_start_reminder: resets.resetStart,
            reset_end_reminder: resets.resetEnd,
          },
        })
        .select('id')
        .single()
      if (markerError) {
        console.error('Failed to record the parking change marker', markerError)
      } else {
        markerId = marker.id
      }
    }

    const warnings: string[] = []
    let paymentLink: string | undefined
    let refunded = 0
    let textStatus: ChangeParkingBookingDatesResult['textStatus'] = 'not_sent'
    let textNote: string | null = null
    let outcome: ParkingChangeOutcome = { kind: 'plain' }
    let textHandled = false

    // Step 6: settle the money.
    if (plan.kind === 'unpaid') {
      const nextAmount = bookingPrice(updated)
      const pendingRows = money.payments.filter((payment) => payment.status === 'pending')
      for (const payment of pendingRows) {
        if (Math.abs(Number(payment.amount) - nextAmount) <= 0.005) continue
        const { error: expireError } = await adminClient
          .from('parking_booking_payments')
          .update({
            status: 'expired',
            metadata: {
              ...((payment.metadata as Record<string, unknown> | null) ?? {}),
              parking_booking_edited: true,
              edited_at: now.toISOString(),
              edited_by: user.id,
              superseded_reason: 'amount_changed_on_date_change',
              superseded_amount: payment.amount,
            },
          })
          .eq('id', payment.id)
          .eq('status', 'pending')
        if (expireError) console.error('Failed to retire the old parking payment link', expireError)
      }

      // Always make the new order, so the reminder texts have a real link to carry.
      try {
        const appUrl = getAppUrl()
        const order = await createParkingPaymentOrder(updated, {
          returnUrl: parkingPaymentReturnUrl(appUrl, updated.id),
          cancelUrl: parkingGuestUrl(appUrl, updated.id, 'cancelled'),
          client: adminClient,
        })
        paymentLink = order.approveUrl || undefined
      } catch (orderError) {
        console.error('Failed to make a parking payment link after a date change', orderError)
        warnings.push('The dates were changed, but a new payment link could not be made. Press Send payment link on the booking.')
      }

      if (data.sendPaymentLink && paymentLink) {
        textHandled = true
        const sendResult = await sendParkingPaymentRequest(updated, paymentLink, { client: adminClient, changeId: data.changeId })
        textStatus = sendResult.sent ? 'sent' : sendResult.skipped ? 'skipped' : 'failed'
        if (!sendResult.sent) {
          textNote = 'The payment link did not reach the customer, so they have not been told. Copy the link below and send it.'
        }
        if (markerId) {
          await settleWrite(
            adminClient
              .from('parking_booking_notifications')
              .update({ status: 'skipped', payload: { ...(await markerPayload(adminClient, markerId)), reason: 'payment_request_sent_instead' } })
              .eq('id', markerId),
            { table: 'parking_booking_notifications', what: 'Recording that the payment link text replaced the change text', ids: { markerId } }
          )
        }
      }
    } else if (plan.kind === 'refund' && refundToSend > 0) {
      const refundResult = await refundParkingBooking({
        payments: plan.refundable,
        amount: refundToSend,
        reason: data.refundReason || `Parking dates changed (${booking.reference})`,
        operationId: data.changeId,
        manualMethod: data.manualRefundMethod,
        // The change text names the refund. One change, one message.
        skipCustomerNotification: true,
        now,
      })
      refunded = refundResult.refunded
      // The final price is what will have been paid once this refund has gone: refunds still
      // pending count as gone, and any part that did not go through shows as a refund to do.
      const finalised = await finaliseRefundPrice(adminClient, {
        bookingId: booking.id,
        finalPrice: roundPence(plan.netPaid - refundToSend),
        calculatedPrice: plan.newPrice,
        reason: overrideReason ?? 'Dates changed; part of the refund did not go through',
      })
      if (finalised) updated = { ...updated, ...finalised }
      else warnings.push('The refund was sent, but the booking price could not be updated. Check the booking before refunding again.')
      // Only the part PayPal is sending back is "refunded to the way you paid". A part refunded by
      // cash or bank transfer is handed over by staff and is not named in the text.
      if (refundResult.refundedViaPayPal > 0) {
        outcome = { kind: 'refund', amount: refundResult.refundedViaPayPal }
      }
      if (!refundResult.complete) {
        const missing = roundPence(refundToSend - refundResult.refunded)
        warnings.push(
          `The dates were changed, but the £${missing.toFixed(2)} refund did not go through. Nothing was sent to the customer about that refund. The booking shows it as a refund to do. ${refundResult.failures.join(' ')}`.trim()
        )
      }
    } else if (plan.kind === 'extra' && data.extraChoice === 'link') {
      // A PayPal order for the extra only, texted in the change message.
      try {
        const appUrl = getAppUrl()
        const order = await createParkingPaymentOrder(updated, {
          returnUrl: parkingPaymentReturnUrl(appUrl, updated.id),
          cancelUrl: parkingGuestUrl(appUrl, updated.id, 'cancelled'),
          client: adminClient,
          amount: plan.extraDue,
          purpose: 'top_up',
        })
        paymentLink = order.approveUrl || undefined
      } catch (orderError) {
        console.error('Failed to make a parking top-up link after a date change', orderError)
      }
      if (paymentLink) {
        outcome = { kind: 'pay_link', amount: plan.extraDue, link: paymentLink }
      } else {
        warnings.push(
          `The dates were changed, but a payment link for the £${plan.extraDue.toFixed(2)} extra could not be made. The booking shows it as to pay: press Payment link on the booking.`
        )
      }
    } else if (plan.kind === 'extra' && data.extraChoice === 'venue') {
      // Paid at the venue: a manual payment row for the extra. No PayPal call.
      const recorded = await settleWrite(
        adminClient.from('parking_booking_payments').insert({
          booking_id: booking.id,
          provider: 'manual',
          status: 'paid',
          amount: plan.extraDue,
          currency: 'GBP',
          paid_at: now.toISOString(),
          metadata: {
            manual_settlement: true,
            settled_by: user.id,
            method: data.venueMethod,
            purpose: 'top_up',
            change_id: data.changeId,
          },
        }),
        { table: 'parking_booking_payments', what: 'Recording the extra paid at the venue', ids: { bookingId: booking.id, changeId: data.changeId } }
      )
      if (recorded) {
        outcome = { kind: 'paid_at_venue', amount: plan.extraDue }
      } else {
        warnings.push(
          `The dates were changed, but the £${plan.extraDue.toFixed(2)} paid at the venue could not be recorded. The booking shows it as to pay: press Mark paid on the booking.`
        )
      }
    } else if (plan.kind === 'refund' && !canRefund) {
      warnings.push(
        `The dates were changed. A manager will need to send the refund of up to £${plan.refundDue.toFixed(2)}: the booking shows it as a refund to do.`
      )
    }

    // The pending-payment rule (spec section 5): on a paid booking, a pending top-up link for an
    // amount no longer owed stops working now, not when the customer tries to pay it.
    if (plan.kind !== 'unpaid') {
      try {
        await enforcePendingPaymentRule(adminClient, updated, { reason: 'dates_changed' })
      } catch (ruleError) {
        console.error('Failed to retire an old parking payment link after a date change', ruleError)
      }
    }

    // Step 7: tell the customer.
    if (!textHandled) {
      if (data.notifyCustomer) {
        const textResult = await sendParkingChangeText({
          client: adminClient,
          booking: updated,
          outcome,
          changeId: data.changeId,
          markerId,
        })
        textStatus = textResult.status
        textNote = textResult.note
      } else if (markerId) {
        await settleWrite(
          adminClient
            .from('parking_booking_notifications')
            .update({ status: 'skipped', payload: { ...(await markerPayload(adminClient, markerId)), reason: 'Staff chose not to tell the customer' } })
            .eq('id', markerId),
          { table: 'parking_booking_notifications', what: 'Recording that the change text was not sent', ids: { markerId } }
        )
        textStatus = 'skipped'
        textNote = 'You chose not to tell the customer.'
      }
    }

    if (textStatus === 'failed' || (textStatus === 'skipped' && data.notifyCustomer && textNote)) {
      warnings.push(textNote ?? 'The customer was not told.')
    }

    // Step 8: audit.
    await logAuditEvent({
      user_id: user.id,
      operation_type: 'update',
      resource_type: 'parking_booking',
      resource_id: booking.id,
      operation_status: 'success',
      old_values: { start_at: booking.start_at, end_at: booking.end_at, price: plan.oldPrice },
      new_values: { start_at: updated.start_at, end_at: updated.end_at, price: bookingPrice(updated) },
      additional_info: {
        action: 'change_parking_dates',
        change_id: data.changeId,
        difference: roundPence(plan.newPrice - plan.oldPrice),
        settlement: plan.kind,
        refund_chosen: refundToSend,
        refunded,
        kept_by_override: overridePrice !== null,
        extra_choice: plan.kind === 'extra' ? data.extraChoice : null,
        extra_due: plan.extraDue,
        payment_link_made: Boolean(paymentLink),
        text_status: textStatus,
        warnings,
      },
    })

    revalidatePath('/parking')
    revalidateTag('dashboard')

    return {
      success: true,
      booking: updated,
      warning: warnings.length > 0 ? warnings.join(' ') : undefined,
      paymentLink,
      textStatus,
      textNote,
      refunded,
    }
  } catch (error) {
    console.error('Failed to change parking booking dates', error)
    return { error: parkingCapacityRefusal(error) ?? 'Failed to change the dates' }
  }
}

const REFUND_IN_PROGRESS_REASON = 'Refund in progress'

/**
 * Sets a parking booking's price once a refund has been sent. `finalPrice` is the net paid before
 * the refund less the amount asked for, so a refund that only partly went through leaves exactly
 * the unsent part as a refund to do. Equal to the calculated price means no agreed price at all.
 * Returns the written fields, or null when the write failed.
 */
async function finaliseRefundPrice(
  client: ReturnType<typeof createAdminClient>,
  input: { bookingId: string; finalPrice: number; calculatedPrice: number; reason: string }
): Promise<Pick<ParkingBooking, 'override_price' | 'override_reason'> | null> {
  const same = Math.abs(input.finalPrice - input.calculatedPrice) <= 0.005
  const fields = { override_price: same ? null : input.finalPrice, override_reason: same ? null : input.reason }
  const ok = await settleWrite(client.from('parking_bookings').update(fields).eq('id', input.bookingId), {
    table: 'parking_bookings',
    what: 'Setting the parking price after a refund',
    ids: { bookingId: input.bookingId },
    note: 'the refund itself went through',
  })
  return ok ? fields : null
}

async function markerPayload(client: ReturnType<typeof createAdminClient>, markerId: string): Promise<Record<string, unknown>> {
  const { data } = await client.from('parking_booking_notifications').select('payload').eq('id', markerId).maybeSingle()
  return (data?.payload as Record<string, unknown> | null) ?? {}
}

const SettleRefundDueSchema = z.object({
  operationId: z.string().uuid('Invalid operation id'),
  /** True: no refund is due after all, so the difference is kept (with a reason). */
  noRefund: z.boolean().default(false),
  amount: z.number().nonnegative().optional(),
  reason: z.string().trim().min(1, 'Give a reason').max(500),
  manualRefundMethod: z.enum(['cash', 'bank_transfer']).default('cash'),
})

/**
 * Settles a "refund to do" on a confirmed parking booking: sends some or all of it, or records
 * that none is due. Whatever is not sent is recorded as kept (the agreed price becomes what the
 * booking has then paid), so the booking reads settled. Needs parking "refund".
 */
export async function settleParkingRefundDue(
  bookingId: string,
  input: z.input<typeof SettleRefundDueSchema>
): Promise<{ success?: boolean; error?: string; warning?: string; refunded?: number }> {
  try {
    const [{ user }, canRefund] = await Promise.all([getCurrentUser(), checkUserPermission('parking', 'refund')])
    if (!user) return { error: 'Authentication required' }
    if (!canRefund) return { error: 'You do not have permission to refund parking bookings' }

    const parsed = SettleRefundDueSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message || 'Invalid refund' }
    const data = parsed.data

    const adminClient = createAdminClient()
    const booking = await getParkingBooking(bookingId, adminClient)
    if (!booking) return { error: 'Parking booking not found' }
    const money = await loadParkingMoneyRows(adminClient, [booking.id])
    const balance = computeParkingBalance(booking, money.payments, money.refunds)
    if (balance.state !== 'refund_due') return { error: 'There is no refund to do on this booking.' }
    const due = roundPence(-balance.balance)

    const amount = data.noRefund ? 0 : roundPence(data.amount ?? due)
    if (amount < 0 || amount > due + 0.005) return { error: `The refund can be between £0.00 and £${due.toFixed(2)}.` }

    const kept = roundPence(due - amount)
    const finalPrice = roundPence(balance.netPaid - amount)
    const keptReason = `£${kept.toFixed(2)} of a refund kept: ${data.reason}`

    // Claim the booking before any money moves. Guarded on updated_at (a trigger bumps it on every
    // write), so of two people settling at once only one gets through. With a refund to send, the
    // price is held at what has been paid, so the booking reads settled while the refund is on its
    // way and nobody else can send it too; it is set to its final figure once the refund has gone.
    const sending = amount > 0
    const { data: claimed, error: claimError } = await adminClient
      .from('parking_bookings')
      .update({
        override_price: sending ? balance.netPaid : finalPrice,
        override_reason: sending ? REFUND_IN_PROGRESS_REASON : keptReason,
        updated_by: user.id,
      })
      .eq('id', booking.id)
      .eq('updated_at', booking.updated_at)
      .select('id')
      .maybeSingle()
    if (claimError) {
      console.error('Failed to claim a parking refund to do', claimError)
      return { error: 'Failed to record the decision' }
    }
    if (!claimed) {
      return { error: 'This booking has just changed. Close this and check it again before refunding.' }
    }

    let refunded = 0
    let warning: string | undefined
    if (amount > 0) {
      const result = await refundParkingBooking({
        payments: refundablePayments(money.payments, money.refunds),
        amount,
        reason: data.reason,
        operationId: data.operationId,
        manualMethod: data.manualRefundMethod,
        skipCustomerNotification: false,
      })
      refunded = result.refunded
      const finalised = await finaliseRefundPrice(adminClient, {
        bookingId: booking.id,
        finalPrice,
        calculatedPrice: Number(booking.calculated_price ?? 0),
        reason: kept > 0 ? keptReason : 'Part of a refund did not go through',
      })
      if (!finalised) {
        warning = 'The refund was sent, but the booking price could not be updated. Check the booking before refunding again.'
      }
      if (!result.complete) {
        warning = [warning, `£${roundPence(amount - result.refunded).toFixed(2)} of the refund did not go through and still shows as a refund to do. ${result.failures.join(' ')}`.trim()]
          .filter(Boolean)
          .join(' ')
      }
    }

    await logAuditEvent({
      user_id: user.id,
      operation_type: 'refund',
      resource_type: 'parking_booking',
      resource_id: booking.id,
      operation_status: 'success',
      additional_info: { action: 'settle_parking_refund_due', due, chosen: amount, refunded, no_refund: data.noRefund, reason: data.reason },
    })

    revalidatePath('/parking')
    revalidateTag('dashboard')
    return { success: true, refunded, warning }
  } catch (error) {
    console.error('Failed to settle a parking refund to do', error)
    return { error: 'Failed to settle the refund' }
  }
}
