import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { checkUserPermission } from '@/app/actions/rbac'
import { getDestinations } from '@/app/actions/mileage'
import { redirect } from 'next/navigation'
import { DestinationsClient } from '../_components/DestinationsClient'

export default async function MileageDestinationsPage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) redirect('/unauthorized')

  const canManage = await checkUserPermission('mileage', 'manage')
  const result = await getDestinations()
  const destinations = result.data ?? []

  return (
    <PageLayout
      title="Saved Destinations"
      subtitle="Manage your frequently visited destinations."
      backButton={{ label: 'Back to mileage', href: '/mileage' }}
    >
      <DestinationsClient
        initialDestinations={destinations}
        canManage={canManage}
      />
    </PageLayout>
  )
}
