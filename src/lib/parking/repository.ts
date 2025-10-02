import { createAdminClient } from '@/lib/supabase/server'
import { ParkingBooking, ParkingRate, ParkingPaymentRecord, ParkingNotificationRecord } from '@/types/parking'
import type { SupabaseClient } from '@supabase/supabase-js'

type GenericClient = SupabaseClient<any, 'public', any>

function resolveClient(client?: GenericClient): GenericClient {
  return client ?? createAdminClient()
}

export async function getActiveParkingRate(client?: GenericClient): Promise<ParkingRate | null> {
  const supabase = resolveClient(client)

  const { data, error } = await supabase
    .from('parking_rates')
    .select('*')
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Failed to load parking rates', error)
    throw new Error('Failed to load parking rates')
  }

  return data as ParkingRate | null
}

export async function insertParkingBooking(
  payload: Record<string, unknown>,
  client?: GenericClient
): Promise<ParkingBooking> {
  const supabase = resolveClient(client)

  const { data, error } = await supabase
    .from('parking_bookings')
    .insert(payload)
    .select()
    .single()

  if (error) {
    console.error('Failed to create parking booking', error)
    throw error
  }

  return data as ParkingBooking
}

export async function updateParkingBooking(
  bookingId: string,
  payload: Record<string, unknown>,
  client?: GenericClient
): Promise<ParkingBooking> {
  const supabase = resolveClient(client)

  const { data, error } = await supabase
    .from('parking_bookings')
    .update(payload)
    .eq('id', bookingId)
    .select()
    .single()

  if (error) {
    console.error('Failed to update parking booking', error)
    throw error
  }

  return data as ParkingBooking
}

export async function getParkingBooking(
  bookingId: string,
  client?: GenericClient
): Promise<ParkingBooking | null> {
  const supabase = resolveClient(client)

  const { data, error } = await supabase
    .from('parking_bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch parking booking', error)
    throw error
  }

  return data as ParkingBooking | null
}

export async function insertParkingPayment(
  payload: Record<string, unknown>,
  client?: GenericClient
): Promise<ParkingPaymentRecord> {
  const supabase = resolveClient(client)

  const { data, error } = await supabase
    .from('parking_booking_payments')
    .insert(payload)
    .select()
    .single()

  if (error) {
    console.error('Failed to create parking payment', error)
    throw error
  }

  return data as ParkingPaymentRecord
}

export async function getPendingParkingPayment(
  bookingId: string,
  client?: GenericClient
): Promise<ParkingPaymentRecord | null> {
  const supabase = resolveClient(client)

  const { data, error } = await supabase
    .from('parking_booking_payments')
    .select('*')
    .eq('booking_id', bookingId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Failed to load pending parking payment', error)
    throw error
  }

  return data as ParkingPaymentRecord | null
}

export async function logParkingNotification(
  payload: Record<string, unknown>,
  client?: GenericClient
): Promise<ParkingNotificationRecord> {
  const supabase = resolveClient(client)

  const { data, error } = await supabase
    .from('parking_booking_notifications')
    .insert(payload)
    .select()
    .single()

  if (error) {
    console.error('Failed to log parking notification', error)
    throw error
  }

  return data as ParkingNotificationRecord
}
