import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'

/**
 * The course tiers recorded on a booking, for the party-size dialogs.
 *
 * `can_set` is true for a Christmas booking that has no tiers yet (one taken by staff before
 * BK-057), so the dialog can offer to record them once. The party-size routes and the database
 * trigger still decide whether they are accepted.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireFohPermission('view')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid booking' }, { status: 400 })
  const { data, error } = await auth.supabase.from('table_bookings').select('*').eq('id', id).maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Could not load course choices' }, { status: 404 })
  const courseCounts = data.christmas_course_counts ?? null
  return NextResponse.json({
    course_counts: courseCounts,
    can_set: !courseCounts && data.booking_type === 'christmas' && data.booking_period_answer === true,
  })
}
