import { PageLayout } from '@/ds'
import { getTodayChecklist } from '@/app/actions/checklists'
import { ChecklistScreen } from '../_components/ChecklistScreen'

// A past business date's checklist, opened from the weekly Insights report. Same screen as
// /checklists, one level down, so it gets a back button instead of the kiosk's
// "Back to the floor" (nothing on the floor links here).
export default async function ChecklistsDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  const res = await getTodayChecklist(date, { dueOnly: true })
  return (
    <PageLayout
      title="Checklists"
      subtitle={`Tasks for ${date}`}
      backButton={{ label: 'Back to Checklists', href: '/checklists' }}
    >
      <ChecklistScreen initial={res.data} error={res.error} />
    </PageLayout>
  )
}
