import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/ds'
import { TableSetupManager } from './TableSetupManager'
import { AllocationSettings } from './AllocationSettings'
import { SeasonalPeriods } from './SeasonalPeriods'

export default async function TableSetupSettingsPage() {
  const canManage = await checkUserPermission('settings', 'manage')

  if (!canManage) {
    redirect('/unauthorized')
  }

  return (
    <PageLayout
      title="Table Setup"
      subtitle="Configure table names, areas, capacities, joined-table rules and private-booking blocking"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      {/* Each block is a Section of Cards, passed straight to the page so the page spaces them. */}
      <TableSetupManager />
      <AllocationSettings />
      <SeasonalPeriods />
    </PageLayout>
  )
}
