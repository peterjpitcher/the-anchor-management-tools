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
      {/* Each block renders its own Sections and Cards. The page used to wrap all three in
          another Section and Card as well, which nested the cards three deep. */}
      <div className="space-y-6">
        <TableSetupManager />
        <AllocationSettings />
        <SeasonalPeriods />
      </div>
    </PageLayout>
  )
}
