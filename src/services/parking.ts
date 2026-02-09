import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCustomerByPhone } from '@/lib/parking/customers'
import { calculateParkingPricing } from '@/lib/parking/pricing'
import { checkParkingCapacity } from '@/lib/parking/capacity'
import { getActiveParkingRate, insertParkingBooking } from '@/lib/parking/repository'
import type { ParkingBooking } from '@/types/parking'

type GenericClient = SupabaseClient<any, 'public', any>

export type ParkingBookingCustomerInput = {
  firstName: string
  lastName?: string
  email?: string
  mobile: string
}

export type ParkingBookingVehicleInput = {
  registration: string
  make?: string
  model?: string
  colour?: string
}

export type CreateParkingBookingCommandInput = {
  customer: ParkingBookingCustomerInput
  vehicle: ParkingBookingVehicleInput
  startAt: string
  endAt: string
  notes?: string
  overridePrice?: number
  overrideReason?: string
  capacityOverride?: boolean
  capacityOverrideReason?: string
  createdBy?: string | null
  updatedBy?: string | null
}

export type CreateParkingBookingCommandResult = {
  booking: ParkingBooking
}

export async function createPendingParkingBooking(
  input: CreateParkingBookingCommandInput,
  options: { client?: GenericClient } = {}
): Promise<CreateParkingBookingCommandResult> {
  const supabase = options.client ?? createAdminClient()
  const startDate = new Date(input.startAt)
  const endDate = new Date(input.endAt)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid start or end time')
  }

  if (endDate <= startDate) {
    throw new Error('End time must be after start time')
  }

  if (input.overridePrice != null && input.overridePrice <= 0) {
    throw new Error('Override price must be greater than zero')
  }

  const rateRecord = await getActiveParkingRate(supabase)
  if (!rateRecord) {
    throw new Error('Parking rates have not been configured')
  }

  const hourly = Number(rateRecord.hourly_rate)
  const daily = Number(rateRecord.daily_rate)
  const weekly = Number(rateRecord.weekly_rate)
  const monthly = Number(rateRecord.monthly_rate)

  if ([hourly, daily, weekly, monthly].some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Parking rates are invalid')
  }

  const pricing = calculateParkingPricing(startDate, endDate, {
    hourlyRate: hourly,
    dailyRate: daily,
    weeklyRate: weekly,
    monthlyRate: monthly
  })

  if (!input.capacityOverride) {
    const capacity = await checkParkingCapacity(input.startAt, input.endAt)
    if (capacity.remaining <= 0) {
      throw new Error('No parking spaces remaining for the selected period')
    }
  }

  const customer = await resolveCustomerByPhone(supabase, {
    firstName: input.customer.firstName,
    lastName: input.customer.lastName,
    email: input.customer.email?.toLowerCase(),
    phone: input.customer.mobile
  })

  const paymentDueAt = new Date()
  paymentDueAt.setDate(paymentDueAt.getDate() + 7)
  const paymentDueAtIso = paymentDueAt.toISOString()

  const booking = await insertParkingBooking(
    {
      customer_id: customer.id,
      customer_first_name: customer.first_name,
      customer_last_name: customer.last_name ?? null,
      customer_mobile: customer.mobile_number,
      customer_email: customer.email ?? null,
      vehicle_registration: sanitizeRegistration(input.vehicle.registration),
      vehicle_make: input.vehicle.make ?? null,
      vehicle_model: input.vehicle.model ?? null,
      vehicle_colour: input.vehicle.colour ?? null,
      start_at: input.startAt,
      end_at: input.endAt,
      duration_minutes: pricing.durationMinutes,
      calculated_price: pricing.total,
      pricing_breakdown: pricing.breakdown,
      override_price: input.overridePrice ?? null,
      override_reason: input.overrideReason ?? null,
      capacity_override: input.capacityOverride ?? false,
      capacity_override_reason: input.capacityOverrideReason ?? null,
      status: 'pending_payment',
      payment_status: 'pending',
      payment_due_at: paymentDueAtIso,
      expires_at: paymentDueAtIso,
      initial_request_sms_sent: false,
      unpaid_week_before_sms_sent: false,
      unpaid_day_before_sms_sent: false,
      paid_start_three_day_sms_sent: false,
      paid_end_three_day_sms_sent: false,
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
      updated_by: input.updatedBy ?? null
    },
    supabase
  )

  return { booking }
}

function sanitizeRegistration(registration: string): string {
  return registration.replace(/\s+/g, '').toUpperCase()
}

export class ParkingService {
  static async createPendingBooking(
    input: CreateParkingBookingCommandInput,
    options: { client?: GenericClient } = {}
  ) {
    return createPendingParkingBooking(input, options)
  }
}
