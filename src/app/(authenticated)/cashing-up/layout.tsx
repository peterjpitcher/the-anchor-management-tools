import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageHeader, SectionNav } from '@/ds'

const CASHING_UP_NAV = [
  { id: 'dashboard', label: 'Dashboard', href: '/cashing-up/dashboard' },
  { id: 'daily', label: 'Daily Entry', href: '/cashing-up/daily' },
  { id: 'weekly', label: 'Weekly', href: '/cashing-up/weekly' },
  { id: 'insights', label: 'Insights', href: '/cashing-up/insights' },
  { id: 'import', label: 'Import', href: '/cashing-up/import' },
]

export default async function CashingUpLayout({ children }: { children: React.ReactNode }) {
  const canView = await checkUserPermission('cashing_up', 'view')
  if (!canView) redirect('/unauthorized')

  return (
    <div>
      <PageHeader title="Cashing Up" subtitle="Daily takings and cash management" />
      <SectionNav items={CASHING_UP_NAV} activeId="" className="mb-6" />
      {children}
    </div>
  )
}
