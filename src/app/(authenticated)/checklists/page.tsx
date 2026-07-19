import { getTodayChecklist } from '@/app/actions/checklists'
import { ChecklistScreen } from './_components/ChecklistScreen'

export default async function ChecklistsTodayPage() {
  const res = await getTodayChecklist()
  return <ChecklistScreen initial={res.data} error={res.error} />
}
