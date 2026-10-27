import { NextRequest, NextResponse } from 'next/server'

import { getLondonDateIso, requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidIsoDate } from '@/lib/dateUtils'
import { loadDayLoads } from '@/services/day-load'

/**
 * Who is in on a date, for the kitchen's day view (review BK-075): covers counted as every other
 * screen counts them, private-hire guests as their own figure, and every draft and confirmed hire
 * with its times, rooms, guests, catering and kitchen covers, including a hire with no room.
 *
 * Hires, event tickets and the kitchen list are read through the admin client once
 * requireBohTableBookingPermission has proven the caller may see the day's bookings.
 */
export async function GET(request: NextRequest) {
  const auth = await requireBohTableBookingPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const dateParam = request.nextUrl.searchParams.get('date')
  if (dateParam !== null && !isValidIsoDate(dateParam)) {
    return NextResponse.json({ success: false, error: 'Invalid date' }, { status: 400 })
  }
  const date = dateParam ?? getLondonDateIso()

  try {
    const loads = await loadDayLoads(date, date, { db: createAdminClient(), withHours: false })
    return NextResponse.json({ success: true, data: loads.get(date) ?? null })
  } catch (error) {
    console.error('Failed to load the day load for BOH:', error)
    return NextResponse.json({ success: false, error: 'Could not load the private hires for this day' }, { status: 500 })
  }
}
