import { redirect } from 'next/navigation'
import { Alert, LinkButton, PageHeader } from '@/ds'
import {
  currentUserCanUseMaintenance,
  getMaintenanceAreas,
  getMaintenanceCosts,
  getMaintenanceItems,
} from '@/app/actions/maintenance'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { MaintenanceListClient } from './_components/MaintenanceListClient'
import {
  maintenanceFiltersToInput,
  parseMaintenanceFilters,
} from './_components/maintenanceFilters'

interface MaintenancePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function MaintenancePage({
  searchParams,
}: MaintenancePageProps): Promise<React.JSX.Element> {
  // The server is the boundary. Hiding the nav item is a courtesy; this check,
  // and the one inside every action, is what actually keeps people out.
  const canUse = await currentUserCanUseMaintenance()
  if (!canUse) {
    redirect('/unauthorized')
  }

  const resolvedParams = searchParams ? await searchParams : {}
  const filters = parseMaintenanceFilters(resolvedParams)
  const filterInput = maintenanceFiltersToInput(filters)

  const [areasResult, itemsResult, costsResult] = await Promise.all([
    getMaintenanceAreas(),
    getMaintenanceItems({ filters: filterInput }),
    getMaintenanceCosts(filterInput),
  ])

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Maintenance' }]}
      title="Maintenance and improvements"
      subtitle="Everything that needs fixing or improving around the pub, and who owns it."
      actions={
        <LinkButton href="/maintenance/new" variant="primary">
          Log an issue
        </LinkButton>
      }
      className="mb-0"
    />
  )

  // The list failing is different from the list being empty, so it is never drawn
  // as an empty list.
  if (!itemsResult.success || !itemsResult.data) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger" title="Could not load the maintenance list">
          {itemsResult.error ?? 'Please reload the page and try again.'}
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      {!areasResult.success && (
        <Alert tone="warning" title="Areas are unavailable">
          The area filter is empty because the areas could not be loaded. Everything else on this
          page still works.
        </Alert>
      )}
      <MaintenanceListClient
        areas={areasResult.data ?? []}
        initialFilters={filters}
        initialItems={itemsResult.data.items}
        initialNextCursor={itemsResult.data.nextCursor}
        initialHasMore={itemsResult.data.hasMore}
        initialCosts={costsResult.success ? (costsResult.data ?? null) : null}
        todayIsoDate={getTodayIsoDate()}
      />
    </div>
  )
}
