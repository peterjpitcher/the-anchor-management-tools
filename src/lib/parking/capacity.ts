import { createAdminClient } from '@/lib/supabase/server'
import { ParkingCapacityCheckResult } from '@/types/parking'

export async function checkParkingCapacity(
  startIso: string,
  endIso: string,
  options: { ignoreBookingId?: string } = {}
): Promise<ParkingCapacityCheckResult> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('check_parking_capacity', {
    p_start: startIso,
    p_end: endIso,
    p_ignore_booking: options.ignoreBookingId ?? null
  })

  if (error) {
    throw new Error(`Failed to check parking capacity: ${error.message}`)
  }

  const result = Array.isArray(data) ? data[0] : data

  if (!result) {
    return { remaining: 0, capacity: 0, active: 0 }
  }

  return {
    remaining: result.remaining ?? 0,
    capacity: result.capacity ?? 0,
    active: result.active ?? 0
  }
}
