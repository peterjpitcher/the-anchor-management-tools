import { Alert, PageLayout } from '@/ds'
import { checkUserPermission } from '@/app/actions/rbac'
import { getDestinations, getDistanceEntries } from '@/app/actions/mileage'
import { redirect } from 'next/navigation'
import { DestinationsClient } from '../_components/DestinationsClient'
import type { HeaderNavItem } from '@/ds'

const navItems: HeaderNavItem[] = [
  { label: 'Trips', href: '/mileage' },
  { label: 'Destinations', href: '/mileage/destinations' },
  { label: 'Insights', href: '/mileage/insights' },
]

export default async function MileageDestinationsPage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) redirect('/unauthorized')

  const canManage = await checkUserPermission('mileage', 'manage')
  const [destinationsResult, distancesResult] = await Promise.all([
    getDestinations(),
    getDistanceEntries(),
  ])

  // A failed read must not look like an empty list or zero trips.
  const loadError = destinationsResult.error ?? distancesResult.error
  if (loadError) {
    return (
      <PageLayout title="Mileage" subtitle="Destinations" navItems={navItems}>
        <Alert variant="error" title="Couldn't load destinations" description={loadError} />
      </PageLayout>
    )
  }

  const destinations = destinationsResult.data ?? []
  const distances = distancesResult.data ?? []

  return (
    <PageLayout
      title="Mileage"
      subtitle="Destinations"
      navItems={navItems}
    >
      <DestinationsClient
        initialDestinations={destinations}
        initialDistances={distances}
        canManage={canManage}
      />
    </PageLayout>
  )
}
