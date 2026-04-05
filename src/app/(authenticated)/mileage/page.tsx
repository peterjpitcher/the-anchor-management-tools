import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { checkUserPermission } from '@/app/actions/rbac'
import { getTrips, getTripStats, getDestinations } from '@/app/actions/mileage'
import { redirect } from 'next/navigation'
import { MileageClient } from './_components/MileageClient'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

const navItems: HeaderNavItem[] = [
  { label: 'Trips', href: '/mileage' },
  { label: 'Destinations', href: '/mileage/destinations' },
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
    taxYearTotalMiles: 0,
    taxYearAmountDue: 0,
    milesToThreshold: 10_000,
  }
  const destinations = destsResult.data ?? []

  return (
    <PageLayout
      title="Mileage"
      subtitle="Track business trips for HMRC mileage reimbursement."
      navItems={navItems}
    >
      <MileageClient
        initialTrips={trips}
        initialStats={stats}
        destinations={destinations}
        canManage={canManage}
      />
    </PageLayout>
  )
}
