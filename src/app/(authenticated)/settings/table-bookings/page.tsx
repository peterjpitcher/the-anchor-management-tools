import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLayout } from '@/ds'
import { Card } from '@/ds'
import { Section } from '@/ds'
import { TableSetupManager } from './TableSetupManager'

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
      <Section title="Table booking setup">
        <Card>
          <TableSetupManager />
        </Card>
      </Section>
    </PageLayout>
  )
}
