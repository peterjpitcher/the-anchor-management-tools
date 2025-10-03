'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { z } from 'zod'
import { calculateParkingPricing } from '@/lib/parking/pricing'
import { getActiveParkingRate, insertParkingBooking, getParkingBooking, updateParkingBooking } from '@/lib/parking/repository'
import { checkParkingCapacity } from '@/lib/parking/capacity'
import { createParkingPaymentOrder } from '@/lib/parking/payments'
import { revalidatePath } from 'next/cache'
import type { ParkingBooking } from '@/types/parking'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCustomerByPhone } from '@/lib/parking/customers'

const CreateParkingBookingSchema = z.object({
  customer_first_name: z.string().min(1, 'First name is required'),
  customer_last_name: z.string().optional().transform((value) => value?.trim() || undefined),
  customer_mobile: z.string().min(1, 'Mobile number is required'),
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
    .transform((value) => value === true || value === 'true' || value === 'on')
})

function sanitizeRegistration(reg: string): string {
  return reg.replace(/\s+/g, '').toUpperCase()
}

export async function createParkingBooking(formData: FormData) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { error: 'You need to be signed in to create a parking booking' }
    }

    const hasPermission = await checkUserPermission('parking', 'manage', user.id)
    if (!hasPermission) {
      return { error: 'You do not have permission to create parking bookings' }
    }

    const rawData = Object.fromEntries(formData.entries()) as Record<string, any>
    const parsedResult = CreateParkingBookingSchema.safeParse(rawData)
    if (!parsedResult.success) {
      return { error: parsedResult.error.errors[0]?.message || 'Invalid parking booking data' }
    }

    const data = parsedResult.data
    const startDate = new Date(data.start_at)
    const endDate = new Date(data.end_at)

    if (endDate <= startDate) {
      return { error: 'End time must be after start time' }
    }

    const adminClient = createAdminClient()
    const rateRecord = await getActiveParkingRate(adminClient)

    if (!rateRecord) {
      return { error: 'Parking rates have not been configured. Please add rates first.' }
    }

    const hourly = Number(rateRecord.hourly_rate)
    const daily = Number(rateRecord.daily_rate)
    const weekly = Number(rateRecord.weekly_rate)
    const monthly = Number(rateRecord.monthly_rate)

    if ([hourly, daily, weekly, monthly].some((value) => !Number.isFinite(value) || value <= 0)) {
      return { error: 'Parking rates are invalid. Please review the rate configuration.' }
    }

    if (data.override_price != null && data.override_price <= 0) {
      return { error: 'Override price must be greater than zero' }
    }

    const pricing = calculateParkingPricing(startDate, endDate, {
      hourlyRate: hourly,
      dailyRate: daily,
      weeklyRate: weekly,
      monthlyRate: monthly
    })

    const capacity = await checkParkingCapacity(data.start_at, data.end_at)
    if (!data.capacity_override && capacity.remaining <= 0) {
      return { error: 'No parking spaces remaining for the selected period' }
    }

    const customer = await resolveCustomerByPhone(supabase as SupabaseClient<any, 'public', any>, {
      firstName: data.customer_first_name,
      lastName: data.customer_last_name,
      email: data.customer_email?.toLowerCase(),
      phone: data.customer_mobile
    })

    const paymentDueAt = new Date()
    paymentDueAt.setDate(paymentDueAt.getDate() + 7)

    const payload = {
      customer_id: customer.id,
      customer_first_name: customer.first_name,
      customer_last_name: customer.last_name ?? null,
      customer_mobile: customer.mobile_number,
      customer_email: customer.email ?? null,
      vehicle_registration: sanitizeRegistration(data.vehicle_registration),
      vehicle_make: data.vehicle_make ?? null,
      vehicle_model: data.vehicle_model ?? null,
      vehicle_colour: data.vehicle_colour ?? null,
      start_at: data.start_at,
      end_at: data.end_at,
      duration_minutes: pricing.durationMinutes,
      calculated_price: pricing.total,
      pricing_breakdown: pricing.breakdown,
      override_price: data.override_price ?? null,
      override_reason: data.override_reason ?? null,
      capacity_override: data.capacity_override || false,
      capacity_override_reason: data.capacity_override_reason ?? null,
      status: 'pending_payment',
      payment_status: 'pending',
      payment_due_at: paymentDueAt.toISOString(),
      expires_at: paymentDueAt.toISOString(),
      notes: data.notes ?? null,
      created_by: user.id,
      updated_by: user.id
    }

    const booking = await insertParkingBooking(payload, adminClient)

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
        const { approveUrl } = await createParkingPaymentOrder(booking as ParkingBooking, {
          returnUrl: `${appUrl}/api/parking/payment/return?booking_id=${booking.id}`,
          cancelUrl: `${appUrl}/parking/bookings/${booking.id}?cancelled=true`,
          client: adminClient
        })
        paymentLink = approveUrl
      } catch (paymentError) {
        console.error('Failed to create parking payment order', paymentError)
      }
    }

    revalidatePath('/parking')

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

export async function getParkingBookingById(bookingId: string) {
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
  updates: Partial<Pick<ParkingBooking, 'status' | 'payment_status' | 'notes'>>
) {
  try {
    const hasPermission = await checkUserPermission('parking', 'manage')
    if (!hasPermission) {
      return { error: 'You do not have permission to update parking bookings' }
    }

    const adminClient = createAdminClient()
    const booking = await updateParkingBooking(bookingId, updates, adminClient)

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'parking_booking',
      resource_id: bookingId,
      operation_status: 'success',
      new_values: updates as Record<string, unknown>
    })

    revalidatePath('/parking')

    return { success: true, booking }
  } catch (error) {
    console.error('Failed to update parking booking', error)
    return { error: 'Failed to update parking booking' }
  }
}

export async function generateParkingPaymentLink(bookingId: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { error: 'Unauthorized' }
    }

    const hasPermission = await checkUserPermission('parking', 'manage', user.id)
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
          payment_due_at: dueAt.toISOString(),
          expires_at: dueAt.toISOString()
        },
        adminClient
      )
      booking.payment_due_at = dueAt.toISOString()
      booking.expires_at = dueAt.toISOString()
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

    const { approveUrl } = await createParkingPaymentOrder(booking as ParkingBooking, {
      returnUrl: `${appUrl}/api/parking/payment/return?booking_id=${booking.id}`,
      cancelUrl: `${appUrl}/parking`,
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

    return { success: true, approveUrl }
  } catch (error) {
    console.error('Failed to generate parking payment link', error)
    return { error: 'Failed to generate payment link' }
  }
}

export async function markParkingBookingPaid(bookingId: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { error: 'Unauthorized' }
    }

    const hasPermission = await checkUserPermission('parking', 'manage', user.id)
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

    const { data: paymentRecord } = await adminClient
      .from('parking_booking_payments')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (paymentRecord) {
      await adminClient
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
    } else {
      await adminClient
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
    }

    const updated = await updateParkingBooking(
      bookingId,
      {
        status: 'confirmed',
        payment_status: 'paid',
        confirmed_at: nowIso
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

    return { success: true, booking: updated }
  } catch (error) {
    console.error('Failed to mark parking booking as paid', error)
    return { error: 'Failed to update payment status' }
  }
}
