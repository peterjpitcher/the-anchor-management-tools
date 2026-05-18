import { PageHeader, SectionNav } from '@/ds'
import { checkUserPermission } from '@/app/actions/rbac'
import { getTrips, getTripStats, getDestinations } from '@/app/actions/mileage'
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

  const [tripsResult, statsResult, destsResult] = await Promise.all([
    getTrips(),
    getTripStats(),
    getDestinations(),
  ])

  const trips = tripsResult.data ?? []
  const stats = statsResult.data ?? {
    quarterTotalMiles: 0,
    quarterAmountDue: 0,
    calendarYear: new Date().getFullYear(),
    calendarYearTotalMiles: 0,
    calendarYearAmountDue: 0,
    taxYearTotalMiles: 0,
    taxYearAmountDue: 0,
    milesToThreshold: 10_000,
  }
  const destinations = destsResult.data ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Finance' }, { label: 'Mileage' }]}
        title="Mileage"
        subtitle="Business trip log with HMRC-rate reimbursement"
      />
      <SectionNav items={MILEAGE_SECTION_NAV} activeId="trips" />
      <MileageClient
        initialTrips={trips}
        initialStats={stats}
        destinations={destinations}
        canManage={canManage}
      />
    </div>
  )
}
