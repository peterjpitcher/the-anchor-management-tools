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
    const [settings, bookings] = await Promise.all([
      getPacingSettings(supabase),
      getBookingLoadForDate(date, supabase),
    ])

    const publicSettings = toPublicPacingSettings(settings)

    return createApiResponse(
      {
        date,
        window_minutes: publicSettings.window_minutes,
        busy_threshold_covers: publicSettings.busy_threshold_covers,
        filling_threshold_covers: publicSettings.filling_threshold_covers,
        bookings,
      },
      200,
      {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
      req.method
    )
  }, ['read:table_bookings'], request)
}
