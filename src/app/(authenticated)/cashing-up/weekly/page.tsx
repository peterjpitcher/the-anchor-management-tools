import { createClient } from '@/lib/supabase/server'
import { getWeeklyDataAction } from '@/app/actions/cashing-up'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { WeeklyClient } from './_components/WeeklyClient'

export default async function WeeklyCashupPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week: paramWeek } = await searchParams
  const supabase = await createClient()
  const { data: site } = await supabase.from('sites').select('id').limit(1).single()
  const siteId = site?.id

  // Default to this week's Monday
  const todayIso = getTodayIsoDate()
  const todayDate = new Date(todayIso + 'T12:00:00')
  const dayOfWeek = todayDate.getDay()
  const diffToMon = todayDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
  todayDate.setDate(diffToMon)
  const defaultWeek = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`

  const weekStart = paramWeek || defaultWeek

  let weeklyData: unknown[] = []
  if (siteId) {
    const res = await getWeeklyDataAction(siteId, weekStart)
    if (res.data) weeklyData = res.data
  }

  return (
    <WeeklyClient
      siteId={siteId || ''}
      weekStart={weekStart}
      initialData={weeklyData}
    />
  )
}
