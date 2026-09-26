import { Alert, PageLayout } from '@/ds'
import { checkUserPermission } from '@/app/actions/rbac'
import { getDestinations, getDistanceEntries } from '@/app/actions/mileage'
import { redirect } from 'next/navigation'
import { MILEAGE_DESTINATIONS_LAYOUT } from '../_shared/nav'
import { DestinationsClient } from '../_components/DestinationsClient'

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
      <PageLayout {...MILEAGE_DESTINATIONS_LAYOUT}>
        <Alert tone="danger" title="Couldn't load destinations">{loadError}</Alert>
      </PageLayout>
    )
  }

  const destinations = destinationsResult.data ?? []
  const distances = distancesResult.data ?? []

  // DestinationsClient renders the PageLayout, so New Destination can sit in the header.
  return (
    <DestinationsClient
      initialDestinations={destinations}
      initialDistances={distances}
      canManage={canManage}
    />
  )
}
