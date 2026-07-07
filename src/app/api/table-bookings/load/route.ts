import { NextRequest } from 'next/server'
import {
  createApiResponse,
  createErrorResponse,
  withApiAuth,
} from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getBookingLoadForDate,
  getPacingSettings,
  toPublicPacingSettings,
} from '@/lib/table-bookings/load'
import {
  buildKitchenAvailabilitySlots,
  enrichSlotsWithHighChairsRemaining,
  getHighChairInventory,
  getKitchenPacingOverrideForDate,
  getKitchenPacingSettings,
  isSundayDate,
  resolveKitchenCeiling,
  type HighChairHoldRow,
  type KitchenBookingRow,
} from '@/lib/table-bookings/kitchen-pacing'
import { getKitchenWindowForDate } from '@/services/business-hours'

// Grid resolution for the per-slot availability read-out (minutes between offered times).
const SLOT_STEP_MINUTES = 15

function isValidCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10))
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

async function getKitchenBookingRowsForDate(
  date: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<KitchenBookingRow[]> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select(
      'booking_time, booking_purpose, party_size, committed_party_size, status, left_at, hold_expires_at, payment_status'
    )
    .eq('booking_date', date)

  if (error) {
    throw new Error('Failed to load kitchen booking rows')
  }

  return (data || []) as KitchenBookingRow[]
}

async function getHighChairHoldRowsForDate(
  date: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<HighChairHoldRow[]> {
  // Chairs are a venue-wide pool shared across overlapping windows, so a booking on the
  // previous evening can hold a chair into an early slot. Widen the fetch by one day either
  // side and let the JS span-overlap decide which holds touch each slot.
  const dayMs = 24 * 60 * 60 * 1000
  const from = new Date(`${date}T00:00:00Z`).getTime() - dayMs
  const to = new Date(`${date}T00:00:00Z`).getTime() + 2 * dayMs
  const { data, error } = await supabase
    .from('table_bookings')
    .select('start_datetime, end_datetime, high_chair_count, status, left_at, hold_expires_at, payment_status')
    .gt('high_chair_count', 0)
    .gte('start_datetime', new Date(from).toISOString())
    .lt('start_datetime', new Date(to).toISOString())

  if (error) {
    throw new Error('Failed to load high chair holds')
  }

  return (data || []) as HighChairHoldRow[]
}

export async function OPTIONS() {
  return createApiResponse({}, 200)
}

export async function GET(request: NextRequest) {
  return withApiAuth(async (req) => {
    const date = new URL(req.url).searchParams.get('date')

    if (!isValidCalendarDate(date)) {
      return createErrorResponse('Date must use YYYY-MM-DD format', 'VALIDATION_ERROR', 400)
    }

    const supabase = createAdminClient()
    const [
      settings,
      bookings,
      kitchenSettings,
      kitchenOverride,
      kitchenWindow,
      kitchenRows,
      highChairHolds,
      highChairInventory,
    ] = await Promise.all([
      getPacingSettings(supabase),
      getBookingLoadForDate(date, supabase),
      getKitchenPacingSettings(supabase),
      getKitchenPacingOverrideForDate(date, supabase),
      getKitchenWindowForDate(date, supabase),
      getKitchenBookingRowsForDate(date, supabase),
      getHighChairHoldRowsForDate(date, supabase),
      getHighChairInventory(supabase),
    ])

    const publicSettings = toPublicPacingSettings(settings)

    // Kitchen-pacing capacity + per-slot availability (additive).
    // These fields are safe to ignore when `capacity.enabled` is false — the
    // website should keep showing all slots until pacing is switched on.
    const ceilingCovers = resolveKitchenCeiling(kitchenSettings, date, kitchenOverride)
    const baseSlots = kitchenWindow
      ? buildKitchenAvailabilitySlots(
          kitchenRows,
          kitchenSettings,
          date,
          kitchenWindow.openMinutes,
          kitchenWindow.closeMinutes,
          SLOT_STEP_MINUTES,
          kitchenOverride
        )
      : []

    // Advisory per-slot high chairs left (inventory − overlapping holds). Computed by true
    // start/end span overlap (spec §6, A3); the RPC's atomic grant remains the real gate.
    const slots = enrichSlotsWithHighChairsRemaining(
      baseSlots,
      highChairHolds,
      highChairInventory,
      date,
      SLOT_STEP_MINUTES
    )

    return createApiResponse(
      {
        date,
        window_minutes: publicSettings.window_minutes,
        busy_threshold_covers: publicSettings.busy_threshold_covers,
        filling_threshold_covers: publicSettings.filling_threshold_covers,
        bookings,
        capacity: {
          enabled: kitchenSettings.enabled,
          window_minutes: kitchenSettings.windowMinutes,
          ceiling_covers: ceilingCovers,
          walk_in_reserve: isSundayDate(date)
            ? kitchenSettings.walkInReserveSunday
            : kitchenSettings.walkInReserveRegular,
        },
        slots,
      },
      200,
      {
        // Chairs are a 2-unit physical resource — this response now carries
        // `high_chairs_remaining` per slot, so it must never be served from a
        // stale/CDN copy (spec §6). Overrides the default GET cache header.
        'Cache-Control': 'no-store',
      },
      req.method
    )
  }, ['read:table_bookings'], request)
}
