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
  getKitchenPacingOverrideForDate,
  getKitchenPacingSettings,
  isSundayDate,
  resolveKitchenCeiling,
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
    ] = await Promise.all([
      getPacingSettings(supabase),
      getBookingLoadForDate(date, supabase),
      getKitchenPacingSettings(supabase),
      getKitchenPacingOverrideForDate(date, supabase),
      getKitchenWindowForDate(date, supabase),
      getKitchenBookingRowsForDate(date, supabase),
    ])

    const publicSettings = toPublicPacingSettings(settings)

    // Kitchen-pacing capacity + per-slot availability (additive).
    // These fields are safe to ignore when `capacity.enabled` is false — the
    // website should keep showing all slots until pacing is switched on.
    const ceilingCovers = resolveKitchenCeiling(kitchenSettings, date, kitchenOverride)
    const slots = kitchenWindow
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
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
      req.method
    )
  }, ['read:table_bookings'], request)
}
