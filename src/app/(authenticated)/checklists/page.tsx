import Link from 'next/link'
import { PageHeader } from '@/ds'
import { Icon } from '@/ds/icons'
import { getTodayChecklist } from '@/app/actions/checklists'
import { ChecklistScreen } from './_components/ChecklistScreen'

export default async function ChecklistsTodayPage() {
  const res = await getTodayChecklist(undefined, { dueOnly: true })
  return (
    <div>
      <Link
        href="/table-bookings/foh"
        className="mb-3 inline-flex min-h-[44px] items-center gap-1 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-2"
      >
        <Icon name="chevronLeft" size={16} />
        Back to FOH
      </Link>
      <PageHeader title="Checklists" subtitle="Opening and closing tasks" />
      <ChecklistScreen initial={res.data} error={res.error} />
    </div>
  )
}
