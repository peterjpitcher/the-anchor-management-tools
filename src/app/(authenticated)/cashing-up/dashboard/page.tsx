import { createClient } from '@/lib/supabase/server'
import { getDashboardDataAction, getWeeklyProgressAction } from '@/app/actions/cashing-up'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { DashboardClient } from './_components/DashboardClient'

export default async function CashupDashboardPage() {
  const supabase = await createClient()
  const { data: site } = await supabase.from('sites').select('id').limit(1).single()
  const siteId = site?.id

  const todayIso = getTodayIsoDate()
  const currentYear = new Date().getFullYear()
  const fromDate = `${currentYear}-01-01`
  const toDate = `${currentYear}-12-31`

  const [dashRes, progressRes] = await Promise.all([
    getDashboardDataAction(siteId, fromDate, toDate),
    siteId ? getWeeklyProgressAction(siteId, todayIso) : Promise.resolve({ success: false, data: null }),
  ])

  return (
    <DashboardClient
      dashboardData={dashRes.data ?? null}
      weeklyProgress={progressRes.data ?? null}
      error={dashRes.error}
    />
  )
}
