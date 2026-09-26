import { createClient } from '@/lib/supabase/server'
import { getDashboardDataAction, getWeeklyProgressAction } from '@/app/actions/cashing-up'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { DashboardClient } from './_components/DashboardClient'

interface PageProps {
  searchParams: Promise<{ year?: string; compareYear?: string }>
}

export default async function CashupDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: site } = await supabase.from('sites').select('id').limit(1).single()
  const siteId = site?.id

  const todayIso = getTodayIsoDate()
  const currentYear = Number(todayIso.slice(0, 4))
  const selectedYear = params.year ? parseInt(params.year, 10) : currentYear
  const compareYear = params.compareYear ? parseInt(params.compareYear, 10) : undefined

  const fromDate = `${selectedYear}-01-01`
  const toDate = `${selectedYear}-12-31`

  const fetches: Promise<any>[] = [
    getDashboardDataAction(siteId, fromDate, toDate),
    siteId ? getWeeklyProgressAction(siteId, todayIso) : Promise.resolve({ success: false, data: null }),
  ]

  if (compareYear) {
    const isCurrentYear = selectedYear === currentYear
    const compFrom = `${compareYear}-01-01`
    const compTo = isCurrentYear
      ? `${compareYear}${todayIso.slice(4)}`
      : `${compareYear}-12-31`
    fetches.push(getDashboardDataAction(siteId, compFrom, compTo))
  }

  const [dashRes, progressRes, compRes] = await Promise.all(fetches)

  return (
    <DashboardClient
      dashboardData={dashRes.data ?? null}
      comparisonData={compRes?.data ?? null}
      weeklyProgress={progressRes.data ?? null}
      selectedYear={selectedYear}
      compareYear={compareYear}
      error={dashRes.error}
    />
  )
}
