import { PageHeader } from '@/ds'
import { getTodayChecklist } from '@/app/actions/checklists'
import { ChecklistScreen } from '../_components/ChecklistScreen'

export default async function ChecklistsDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  const res = await getTodayChecklist(date, { dueOnly: true })
  return (
    <div>
      <PageHeader title="Checklists" subtitle={`Tasks for ${date}`} />
      <ChecklistScreen initial={res.data} error={res.error} />
    </div>
  )
}
