import { createAdminClient } from '@/lib/supabase/admin'

export type ParkingBookingUpdateResult = 'updated' | 'missing' | 'error'

export async function updateParkingBookingById(
  supabase: ReturnType<typeof createAdminClient>,
  bookingId: string,
  patch: Record<string, unknown>,
  context: string
): Promise<ParkingBookingUpdateResult> {
  const { data, error } = await supabase
    .from('parking_bookings')
    .update(patch)
    .eq('id', bookingId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`${context} (booking ${bookingId})`, error)
    return 'error'
  }

  if (!data) {
    console.warn(`${context} no-op because booking row is missing (${bookingId})`)
    return 'missing'
  }

  return 'updated'
}

