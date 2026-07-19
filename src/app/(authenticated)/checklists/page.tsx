import { PageHeader } from '@/ds'
import { getTodayChecklist } from '@/app/actions/checklists'
import { ChecklistScreen } from './_components/ChecklistScreen'

export default async function ChecklistsTodayPage() {
  const res = await getTodayChecklist()
  return (
    <div>
      <PageHeader title="Checklists" subtitle="Opening and closing tasks" />
      <ChecklistScreen initial={res.data} error={res.error} />
    </div>
  )
}
