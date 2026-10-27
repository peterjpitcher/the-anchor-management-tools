import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import { parseFohAvailabilityQuery, withPacingBypass } from '@/lib/foh/availability-query'

/**
 * Which times are free, for staff taking a booking on the FOH screen (BK-184).
 *
 * The same check the website's slot list uses, check_table_availability_v06, with the staff channel
 * (or 'walkin' for a walk-in): a fitting table, kitchen pacing including the date's own pace and
 * private hire and event food, outside tables and the drinks arrivals ceiling. Staff used to learn a
 * time was full only after pressing submit.
 *
 * GET /api/foh/availability?date=YYYY-MM-DD&party_size=N&purpose=food|drinks|christmas
 *   [&outside=true][&requires_accessible_table=true][&high_chair_count=0..2][&walk_in=true]
 *
 * The answer is passed through as the database gives it. calculation_state 'unknown' means the
 * check could not run: the screen must then not mark any time as free.
 *
 * Party size: the database applies the one table booking limit (table_booking_max_party_online,
 * D30) to every channel, so a party over it gets no times, as the staff booking function would
 * refuse it. Walk-ins and drinks bookings skip kitchen pacing and the drinks ceiling when saved, so
 * their times are not refused for those here.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireFohPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const query = parseFohAvailabilityQuery(request.nextUrl.searchParams)
  if (!query.ok) {
    return NextResponse.json({ success: false, error: query.error }, { status: 400 })
  }

  const { data, error } = await auth.supabase.rpc('check_table_availability_v06', {
    p_booking_date: query.value.date,
    p_party_size: query.value.partySize,
    p_purpose: query.value.purpose,
    p_outside: query.value.outside,
    p_requires_accessible_table: query.value.requiresAccessibleTable,
    p_high_chair_count: query.value.highChairCount,
    p_channel: query.value.channel,
  })

  if (error) {
    logger.error('check_table_availability_v06 failed for the FOH screen', {
      error: new Error(error.message),
      metadata: { date: query.value.date, partySize: query.value.partySize, purpose: query.value.purpose },
    })
    return NextResponse.json(
      {
        success: true,
        data: { contract_version: 1, calculation_state: 'unknown', date: query.value.date, slots: [] },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // Walk-ins and drinks skip the arrival limits when they are saved, so their times are not
  // refused for them here either (the same rule as the create route).
  const answer = withPacingBypass((data ?? {}) as { slots?: Array<Record<string, unknown>> }, query.value.bypassPacing)
  return NextResponse.json({ success: true, data: answer }, { headers: { 'Cache-Control': 'no-store' } })
}
