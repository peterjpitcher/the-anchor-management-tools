import { createClient } from '@/lib/supabase/server'
import { getDailySummaryAction } from '@/app/actions/daily-summary'
import { getDailyTargetAction } from '@/app/actions/cashing-up'
import { getWeeklyDataAction } from '@/app/actions/cashing-up'
import { getMissingCashupDatesAction } from '@/app/actions/missing-cashups'
import { CashingUpService } from '@/services/cashing-up.service'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { DailyClient } from './_components/DailyClient'

export default async function DailyCashupPage(props: { searchParams: Promise<{ date?: string; siteId?: string; edit?: string }> }) {
  const searchParams = await props.searchParams

  const supabase = await createClient()
  const { data: site } = await supabase.from('sites').select('id, name').limit(1).single()
  const siteId = searchParams.siteId || site?.id
  const siteName = site?.name || 'Default Site'

  if (!siteId) {
    return <p className="text-text-muted text-center py-8">No site configured. Please configure a site in the database.</p>
  }

  const todayIso = getTodayIsoDate()
  const sessionDate = searchParams.date || todayIso
  const initialEditMode = searchParams.edit === '1' || searchParams.edit === 'true'

  // Calculate week start (Monday)
  const dateObj = new Date(sessionDate + 'T12:00:00')
  const dayOfWeek = dateObj.getDay()
  const diffToMon = dateObj.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
  dateObj.setDate(diffToMon)
  const weekStart = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`

  const [summaryRes, targetRes, weeklyRes, existingSession, missingRes] = await Promise.all([
    getDailySummaryAction(sessionDate),
    getDailyTargetAction(siteId, sessionDate),
    getWeeklyDataAction(siteId, weekStart),
    CashingUpService.getSessionByDateAndSite(supabase, siteId, sessionDate).catch(() => null),
    getMissingCashupDatesAction(siteId),
  ])

  const targetAmount = typeof targetRes.data === 'number' ? targetRes.data : 0

  return (
    <DailyClient
      siteId={siteId}
      siteName={siteName}
      sessionDate={sessionDate}
      dailySummary={summaryRes.success ? summaryRes.summary ?? null : null}
      dailyTarget={targetAmount}
      weeklyData={weeklyRes.data ?? []}
      existingSession={existingSession ? JSON.parse(JSON.stringify(existingSession)) : null}
      missingDates={missingRes.success && missingRes.dates ? missingRes.dates : []}
      initialEditMode={initialEditMode}
    />
  )
}
