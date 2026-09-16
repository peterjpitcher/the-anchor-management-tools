import { Alert, PageHeader, SectionNav } from '@/ds'
import { checkUserPermission } from '@/app/actions/rbac'
import { getTrips, getTripStats, getDestinations } from '@/app/actions/mileage'
import { getMileageDrivers } from '@/app/actions/mileage-drivers'
import { redirect } from 'next/navigation'
import { MileageClient } from './_components/MileageClient'

const MILEAGE_SECTION_NAV = [
  { id: 'trips', label: 'Trips', href: '/mileage' },
  { id: 'destinations', label: 'Destinations', href: '/mileage/destinations' },
  { id: 'insights', label: 'Insights', href: '/mileage/insights' },
]

export default async function MileagePage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) redirect('/unauthorized')

  const canManage = await checkUserPermission('mileage', 'manage')

  const [tripsResult, statsResult, destsResult, driversResult] = await Promise.all([
    getTrips(),
    getTripStats(),
    getDestinations(),
    getMileageDrivers(),
  ])

  // A failed read used to render as "No trips recorded"; say what went wrong instead.
  // Drivers count too: without them no trip can be saved.
  const loadError = tripsResult.error ?? statsResult.error ?? destsResult.error ?? driversResult.error
  // Totals with no data are never replaced by made-up zeros.
  if (loadError || !statsResult.data) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[{ label: 'Finance' }, { label: 'Mileage' }]}
          title="Mileage"
          subtitle="Business trip log with HMRC-rate reimbursement"
          className="mb-0"
        />
        <SectionNav items={MILEAGE_SECTION_NAV} activeId="trips" />
        <Alert variant="error" title="Couldn't load mileage" description={loadError ?? 'Mileage totals are unavailable'} />
      </div>
    )
  }

  const trips = tripsResult.data ?? []
  const tripTotal = tripsResult.pageInfo?.total ?? trips.length
  const tripPage = tripsResult.pageInfo?.page ?? 1
  const tripPageSize = tripsResult.pageInfo?.pageSize ?? 25
  const stats = statsResult.data
  const destinations = destsResult.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Finance' }, { label: 'Mileage' }]}
        title="Mileage"
        subtitle="Business trip log with HMRC-rate reimbursement"
        className="mb-0"
      />
      <SectionNav items={MILEAGE_SECTION_NAV} activeId="trips" />
      <MileageClient
        initialTrips={trips}
        initialTotal={tripTotal}
        initialPage={tripPage}
        initialPageSize={tripPageSize}
        initialStats={stats}
        destinations={destinations}
        drivers={driversResult.data ?? []}
        canManage={canManage}
      />
    </div>
  )
}
