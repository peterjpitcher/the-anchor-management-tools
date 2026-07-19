import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageHeader, SectionNav } from '@/ds'

const CHECKLIST_NAV = [
  { id: 'today', label: 'Today', href: '/checklists' },
]

export default async function ChecklistsLayout({ children }: { children: React.ReactNode }) {
  const canView = await checkUserPermission('checklists', 'view')
  if (!canView) redirect('/unauthorized')

  return (
    <div>
      <PageHeader title="Checklists" subtitle="Opening and closing tasks" />
      <SectionNav items={CHECKLIST_NAV} activeId="today" className="mb-6" />
      {children}
    </div>
  )
}
