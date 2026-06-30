'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { getActiveParkingRate, getParkingBooking, updateParkingBooking } from '@/lib/parking/repository'
import { createParkingPaymentOrder, sendParkingPaymentRequest } from '@/lib/parking/payments'
import { revalidatePath, revalidateTag } from 'next/cache'
import type { ParkingBooking, ParkingBookingStatus, ParkingPaymentStatus, ParkingRate } from '@/types/parking'
import { calculateParkingPricing } from '@/lib/parking/pricing'
import type { ParkingRateConfig } from '@/lib/parking/pricing'
import { createPendingParkingBooking } from '@/services/parking'
import { parkingGuestUrl, parkingPaymentReturnUrl } from '@/lib/parking/public-links'

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
  send_payment_link: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => {
      if (value == null) return true
      return value === true || value === 'true' || value === 'on'
    })
})

const UpdateParkingBookingSchema = CreateParkingBookingSchema.omit({
  send_payment_link: true,
}).extend({
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
    const supabase = await createClient()
    const [{ data: { user } }, hasPermission] = await Promise.all([
      supabase.auth.getUser(),
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
    if (data.send_payment_link) {
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const { approveUrl } = await createParkingPaymentOrder(booking, {
          returnUrl: parkingPaymentReturnUrl(appUrl, booking.id),
          cancelUrl: parkingGuestUrl(appUrl, booking.id, 'cancelled'),
          client: adminClient
        })
        paymentLink = approveUrl
        await sendParkingPaymentRequest(booking, approveUrl, { client: adminClient })
      } catch (paymentError) {
        console.error('Failed to create parking payment order', paymentError)
      }
    }

    revalidatePath('/parking')
    revalidateTag('dashboard')

    return {
      success: true,
      booking,
      paymentLink
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
  paymentStatus?: ParkingPaymentStatus | 'all'
  search?: string
  limit?: number
}) {
  try {
    const supabase = await createClient()
    const [{ data: { user } }, canView] = await Promise.all([
      supabase.auth.getUser(),
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
      .select('*')
      .order('start_at', { ascending: false })
      .limit(limit)

    if (options?.status && options.status !== 'all') {
      query = query.eq('status', options.status)
    }

    if (options?.paymentStatus && options.paymentStatus !== 'all') {
      query = query.eq('payment_status', options.paymentStatus)
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

    return { success: true, data: (data || []) as ParkingBooking[] }
  } catch (error) {
    console.error('Unexpected error listing parking bookings', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getParkingBookingNotifications(bookingId: string) {
  try {
    const supabase = await createClient()
    const [{ data: { user } }, canView] = await Promise.all([
      supabase.auth.getUser(),
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
    const supabase = await createClient()
    const [{ data: { user } }, canManage] = await Promise.all([
      supabase.auth.getUser(),
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

    const config: ParkingRateConfig = {
      hourlyRate: Number(rateRecord.hourly_rate) || 0,
      dailyRate: Number(rateRecord.daily_rate) || 0,
      weeklyRate: Number(rateRecord.weekly_rate) || 0,
      monthlyRate: Number(rateRecord.monthly_rate) || 0
    }

    return { success: true, data: config }
  } catch (error) {
    console.error('Failed to load parking rate configuration', error)
    return { error: 'Failed to load parking rate configuration' }
  }
}

export async function getParkingRateSettings(): Promise<{ success: true; data: ParkingRate } | { error: string }> {
  try {
    const supabase = await createClient()
    const [{ data: { user } }, canManage] = await Promise.all([
      supabase.auth.getUser(),
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
    const supabase = await createClient()
    const [{ data: { user } }, canManage] = await Promise.all([
      supabase.auth.getUser(),
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
    const supabase = await createClient()
    const [{ data: { user } }, hasPermission] = await Promise.all([
      supabase.auth.getUser(),
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
    const start = new Date(data.start_at)
    const end = new Date(data.end_at)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      return { error: 'End time must be after start time' }
    }

    const rateRecord = await getActiveParkingRate(adminClient)
    if (!rateRecord) {
      return { error: 'Parking rates have not been configured' }
    }

    const pricing = calculateParkingPricing(start, end, {
      hourlyRate: Number(rateRecord.hourly_rate) || 0,
      dailyRate: Number(rateRecord.daily_rate) || 0,
      weeklyRate: Number(rateRecord.weekly_rate) || 0,
      monthlyRate: Number(rateRecord.monthly_rate) || 0,
    })

    const priceAffectingChanged =
      existing.start_at !== data.start_at ||
      existing.end_at !== data.end_at ||
      Number(existing.override_price ?? 0) !== Number(data.override_price ?? 0)

    if (priceAffectingChanged && ['paid', 'refunded'].includes(existing.payment_status)) {
      return { error: 'Paid parking bookings cannot have price-affecting fields edited' }
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
      start_at: data.start_at,
      end_at: data.end_at,
      duration_minutes: pricing.durationMinutes,
      calculated_price: pricing.total,
      pricing_breakdown: pricing.breakdown,
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
      const { error: paymentError } = await adminClient
        .from('parking_booking_payments')
        .update({
          amount: nextAmount,
          metadata: {
            parking_booking_edited: true,
            edited_at: new Date().toISOString(),
            edited_by: user.id,
          },
        })
        .eq('booking_id', bookingId)
        .eq('status', 'pending')

      if (paymentError) {
        console.error('Failed to update pending parking payment amount:', paymentError)
        return { error: 'Booking updated but pending payment amount could not be updated' }
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
    return { error: 'Failed to update parking booking' }
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
    const supabase = await createClient()
    const [{ data: { user } }, hasPermission] = await Promise.all([
      supabase.auth.getUser(),
      checkUserPermission('parking', 'manage'),
    ])
    if (!user) {
      return { error: 'Unauthorized' }
    }

    if (!hasPermission) {
      return { error: 'You do not have permission to update parking bookings' }
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

      if (currentPaymentStatus === 'paid') {
        nextPaymentStatus = 'refunded'
      } else if (currentPaymentStatus === 'pending') {
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

        if (nextPaymentStatus === 'refunded' && latestPayment.status === 'paid') {
          Object.assign(paymentUpdates, { status: 'refunded', refunded_at: nowIso })
        }

        // Only persist when we actually modified the payment status.
        if (
          paymentUpdates.status === 'failed' ||
          paymentUpdates.status === 'refunded'
        ) {
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
    const supabase = await createClient()
    const [{ data: { user } }, hasPermission] = await Promise.all([
      supabase.auth.getUser(),
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

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
    return { error: 'Failed to generate payment link' }
  }
}

export async function markParkingBookingPaid(bookingId: string) {
  try {
    const supabase = await createClient()
    const [{ data: { user } }, hasPermission] = await Promise.all([
      supabase.auth.getUser(),
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

    const amount = booking.override_price ?? booking.calculated_price ?? 0
    const nowIso = new Date().toISOString()

    const { data: paymentRecord, error: paymentRecordError } = await adminClient
      .from('parking_booking_payments')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (paymentRecordError) {
      console.error('Failed to load parking payment record:', paymentRecordError)
      return { error: 'Failed to update payment status' }
    }

    if (paymentRecord) {
      const { data: updatedPayment, error: paymentUpdateError } = await adminClient
        .from('parking_booking_payments')
        .update({
          status: 'paid',
          amount,
          paid_at: nowIso,
          metadata: {
            ...(paymentRecord.metadata || {}),
            manual_settlement: true,
            settled_by: user.id
          }
        })
        .eq('id', paymentRecord.id)
        .select('id')
        .maybeSingle()

      if (paymentUpdateError) {
        console.error('Failed to update parking payment record:', paymentUpdateError)
        return { error: 'Failed to update payment status' }
      }

      if (!updatedPayment) {
        return { error: 'Payment record not found' }
      }
    } else {
      const { error: paymentInsertError } = await adminClient
        .from('parking_booking_payments')
        .insert({
          booking_id: bookingId,
          provider: 'manual',
          status: 'paid',
          amount,
          currency: 'GBP',
          paid_at: nowIso,
          metadata: {
            manual_settlement: true,
            settled_by: user.id
          }
        })

      if (paymentInsertError) {
        console.error('Failed to create parking payment record:', paymentInsertError)
        return { error: 'Failed to update payment status' }
      }
    }

    const updated = await updateParkingBooking(
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
        amount
      }
    })

    revalidatePath('/parking')
    revalidateTag('dashboard')

    return { success: true, booking: updated }
  } catch (error) {
    console.error('Failed to mark parking booking as paid', error)
    return { error: 'Failed to update payment status' }
  }
}
