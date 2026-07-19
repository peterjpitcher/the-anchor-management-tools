import { getTodayChecklist } from '@/app/actions/checklists'
import { ChecklistScreen } from '../_components/ChecklistScreen'

export default async function ChecklistsDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  const res = await getTodayChecklist(date)
  return <ChecklistScreen initial={res.data} error={res.error} />
}
