import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission, tableBookingsManagerCheck } from '@/lib/foh/api-auth'
import { ChristmasCourseValidationError, readChristmasDeadline } from '@/lib/events/staff-seat-updates'

/**
 * The course tiers recorded on a booking, for the party-size dialogs.
 *
 * `can_set` is true for a Christmas booking that has no tiers yet (one taken by staff before
 * BK-057), so the dialog can offer to record them once. `seat_names` gives each recorded seat's
 * guest name, if the booker gave one, so staff can pick who is leaving (BK-054). `deadline` says
 * where the date stands against its pre-order deadline, and `can_change_late` whether this user may
 * change the party after it (a manager, D21). The party-size routes and the database still decide
 * what is accepted.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireFohPermission('view')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid booking' }, { status: 400 })
  const { data, error } = await auth.supabase.from('table_bookings').select('*').eq('id', id).maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Could not load course choices' }, { status: 404 })
  const courseCounts: number[] | null = data.christmas_course_counts ?? null
  const isChristmas = data.booking_type === 'christmas' || Boolean(courseCounts)

  let seatNames: Array<string | null> = []
  if (courseCounts) {
    const { data: covers, error: coversError } = await auth.supabase
      .from('booking_preorder_covers')
      .select('ordinal, guest_name')
      .eq('table_booking_id', id)
    if (coversError) return NextResponse.json({ error: 'Could not load course choices' }, { status: 500 })
    const names = new Map((covers ?? []).map((cover) => [cover.ordinal, cover.guest_name?.trim() || null]))
    seatNames = courseCounts.map((_, index) => names.get(index + 1) ?? null)
  }

  let deadline: 'open' | 'closed' | 'none' = 'none'
  let canChangeLate = false
  if (isChristmas) {
    try {
      deadline = await readChristmasDeadline(auth.supabase, data.booking_date)
    } catch (deadlineError) {
      if (deadlineError instanceof ChristmasCourseValidationError) {
        return NextResponse.json({ error: deadlineError.message }, { status: 500 })
      }
      throw deadlineError
    }
    if (deadline === 'closed') canChangeLate = await tableBookingsManagerCheck(auth)()
  }

  return NextResponse.json({
    course_counts: courseCounts,
    can_set: !courseCounts && data.booking_type === 'christmas' && data.booking_period_answer === true,
    seat_names: seatNames,
    deadline,
    can_change_late: canChangeLate,
  })
}
