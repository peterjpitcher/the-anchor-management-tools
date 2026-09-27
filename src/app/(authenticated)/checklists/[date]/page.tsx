import { PageLayout } from '@/ds'
import { getTodayChecklist } from '@/app/actions/checklists'
import { formatDateFull, isValidIsoDate } from '@/lib/dateUtils'
import { ChecklistScreen } from '../_components/ChecklistScreen'

// A past business date's checklist, opened from the weekly Insights report. Same screen as
// /checklists, one level down: a child page, so it is titled with its record (the date) and
// gets a back button instead of the kiosk's "Back to the floor" (nothing on the floor links here).
export default async function ChecklistsDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  const res = await getTodayChecklist(date, { dueOnly: true })
  // The date in words, for example "Tuesday, 22 September 2026". Anything that is not a real
  // calendar date (a typo, or 2026-02-30) is shown as typed rather than rolled into another day.
  const title = isValidIsoDate(date) ? formatDateFull(date) : date
  return (
    <PageLayout
      title={title}
      subtitle="Opening and closing tasks"
      backButton={{ label: 'Back to Checklists', href: '/checklists' }}
    >
      <ChecklistScreen initial={res.data} error={res.error} />
    </PageLayout>
  )
}
