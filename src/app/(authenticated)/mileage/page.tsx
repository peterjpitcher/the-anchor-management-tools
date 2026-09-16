import { redirect } from 'next/navigation'
import { Alert, PageHeader, SectionNav } from '@/ds'
import { checkUserPermission } from '@/app/actions/rbac'
import { getDestinations, getTripDateRange, getTripStats, listMileageTrips } from '@/app/actions/mileage'
import { getMileageDrivers } from '@/app/actions/mileage-drivers'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { MILEAGE_LIST_PAGE_SIZE, parseMileageListQuery, serialiseMileageListQuery } from '@/lib/mileage/list-query'
import { buildPeriodPresets } from '@/lib/mileage/period-presets'
import { MileageClient } from './_components/MileageClient'

const MILEAGE_SECTION_NAV = [
  { id: 'trips', label: 'Trips', href: '/mileage' },
  { id: 'destinations', label: 'Destinations', href: '/mileage/destinations' },
  { id: 'insights', label: 'Insights', href: '/mileage/insights' },
]

interface MileagePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function PageFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Finance' }, { label: 'Mileage' }]}
        title="Mileage"
        subtitle="Business trip log with HMRC-rate reimbursement"
        className="mb-0"
      />
      <SectionNav items={MILEAGE_SECTION_NAV} activeId="trips" />
      {children}
    </div>
  )
}

/** The trips page (spec 7.1): the address holds the filters, sort and page, and this page loads what it asks for. */
export default async function MileagePage({ searchParams }: MileagePageProps): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) redirect('/unauthorized')
  const canManage = await checkUserPermission('mileage', 'manage')

  const { query, warnings } = parseMileageListQuery(await searchParams)
  const [tripsResult, statsResult, destsResult, driversResult, rangeResult] = await Promise.all([
    listMileageTrips(query),
    getTripStats(),
    getDestinations(),
    getMileageDrivers(),
    getTripDateRange(),
  ])

  // A failed read is shown as a failure, never as "No trips recorded". Drivers count too: without
  // them no trip can be saved. Totals with no data are never replaced by made-up zeros.
  const loadError = tripsResult.error ?? statsResult.error ?? destsResult.error ?? driversResult.error ?? rangeResult.error
  if (loadError || !tripsResult.data || !statsResult.data) {
    return (
      <PageFrame>
        <Alert tone="danger" title="Couldn't load mileage">
          {loadError ?? 'Mileage totals are unavailable'}
        </Alert>
      </PageFrame>
    )
  }

  // A page past the end goes to the last page instead of showing an empty table (spec 7.1).
  const lastPage = Math.max(1, Math.ceil(tripsResult.data.totalCount / MILEAGE_LIST_PAGE_SIZE))
  if (query.page > lastPage) {
    const address = serialiseMileageListQuery({ ...query, page: lastPage })
    redirect(address ? `/mileage?${address}` : '/mileage')
  }

  const today = getTodayIsoDate()
  return (
    <PageFrame>
      <MileageClient
        query={query}
        warnings={warnings}
        trips={tripsResult.data}
        stats={statsResult.data}
        destinations={destsResult.data ?? []}
        drivers={driversResult.data ?? []}
        presets={buildPeriodPresets({
          today,
          firstTripDate: rangeResult.data?.first ?? null,
          lastTripDate: rangeResult.data?.last ?? null,
        })}
        today={today}
        canManage={canManage}
      />
    </PageFrame>
  )
}
