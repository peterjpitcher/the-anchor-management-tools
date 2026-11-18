import { redirect } from 'next/navigation'
import { Alert, PageLayout } from '@/ds'
import { checkUserPermission, getCurrentUserModuleActions } from '@/app/actions/rbac'
import { getDestinationOptions, getTripDateRange, getTripStats, listMileageTrips } from '@/app/actions/mileage'
import { getMileageDrivers } from '@/app/actions/mileage-drivers'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { MILEAGE_LIST_PAGE_SIZE, parseMileageListQuery, serialiseMileageListQuery } from '@/lib/mileage/list-query'
import { buildPeriodPresets } from '@/lib/mileage/period-presets'
import { MILEAGE_TRIPS_LAYOUT } from './_shared/nav'
import { MileageClient } from './_components/MileageClient'

interface MileagePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Answers the page's two mileage permissions exactly as two checkUserPermission calls would, from
 * one read of the user's permission list.
 *
 * getCurrentUserModuleActions lists only the permission rows the user's roles hold, while
 * checkUserPermission also allows a super admin everything and answers no when the lookup fails.
 * So an action missing from the list is not yet a no: checkUserPermission settles the first
 * missing one. If that says no, the user is not a super admin and the other missing action is a
 * no as well (both read the same cached permission list); if it says yes, the other is checked too.
 */
async function resolveMileagePagePermissions(): Promise<{ canView: boolean; canManage: boolean }> {
  const moduleActions = await getCurrentUserModuleActions('mileage')
  const held = new Set<string>('actions' in moduleActions ? moduleActions.actions : [])
  const result = { view: held.has('view'), manage: held.has('manage') }

  const missing = (['view', 'manage'] as const).filter((action) => !result[action])
  if (missing.length > 0) {
    const [probe, ...rest] = missing
    result[probe] = await checkUserPermission('mileage', probe)
    if (result[probe]) {
      for (const action of rest) result[action] = await checkUserPermission('mileage', action)
    }
  }
  return { canView: result.view, canManage: result.manage }
}

/** The trips page (spec 7.1): the address holds the filters, sort and page, and this page loads what it asks for. */
export default async function MileagePage({ searchParams }: MileagePageProps): Promise<React.JSX.Element> {
  const { canView, canManage } = await resolveMileagePagePermissions()
  if (!canView) redirect('/unauthorized')

  const { query, warnings } = parseMileageListQuery(await searchParams)
  const [tripsResult, statsResult, destsResult, driversResult, rangeResult] = await Promise.all([
    listMileageTrips(query),
    getTripStats(),
    getDestinationOptions(),
    getMileageDrivers(),
    getTripDateRange(),
  ])

  // A failed read is shown as a failure, never as "No trips recorded". Drivers count too: without
  // them no trip can be saved. Totals with no data are never replaced by made-up zeros.
  const loadError = tripsResult.error ?? statsResult.error ?? destsResult.error ?? driversResult.error ?? rangeResult.error
  if (loadError || !tripsResult.data || !statsResult.data) {
    return (
      <PageLayout {...MILEAGE_TRIPS_LAYOUT}>
        <Alert tone="danger" title="Couldn't load mileage">
          {loadError ?? 'Mileage totals are unavailable'}
        </Alert>
      </PageLayout>
    )
  }

  // A page past the end goes to the last page instead of showing an empty table (spec 7.1).
  const lastPage = Math.max(1, Math.ceil(tripsResult.data.totalCount / MILEAGE_LIST_PAGE_SIZE))
  if (query.page > lastPage) {
    const address = serialiseMileageListQuery({ ...query, page: lastPage })
    redirect(address ? `/mileage?${address}` : '/mileage')
  }

  const today = getTodayIsoDate()
  // MileageClient renders the PageLayout, so New Trip, Export CSV and Download Report sit in the header.
  return (
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
  )
}
