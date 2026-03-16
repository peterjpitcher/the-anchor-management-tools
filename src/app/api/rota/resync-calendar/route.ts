import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(_req: NextRequest): Promise<NextResponse> {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const canPublish = await checkUserPermission('rota', 'publish')
  if (!canPublish) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: weeks, error } = await admin
    .from('rota_weeks')
    .select('id')
    .eq('status', 'published')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { syncRotaWeekToCalendar } = await import('@/lib/google-calendar-rota')

  let weeksSynced = 0
  const errors: string[] = []

  for (const week of weeks ?? []) {
    const { data: shifts } = await admin
      .from('rota_published_shifts')
      .select('id, week_id, employee_id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name')
      .eq('week_id', week.id)

    try {
      await syncRotaWeekToCalendar(week.id, shifts ?? [])
      weeksSynced++
    } catch (err: any) {
      console.error('[RotaCalendar] resync failed for week', week.id, err)
      errors.push(`Week ${week.id}: ${err?.message ?? 'unknown error'}`)
    }
  }

  return NextResponse.json({ success: true, weeksSynced, errors })
}
