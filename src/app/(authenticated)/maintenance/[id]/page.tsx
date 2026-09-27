import { redirect } from 'next/navigation'
import { Alert, PageLayout } from '@/ds'
import {
  currentUserCanUseMaintenance,
  getMaintenanceAreas,
  getMaintenanceItem,
} from '@/app/actions/maintenance'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { MaintenanceDetailClient } from '../_components/MaintenanceDetailClient'
import { MAINTENANCE_ITEM_LAYOUT } from '../_shared/layout'

interface MaintenanceItemPageProps {
  params: Promise<{ id: string }>
}

export default async function MaintenanceItemPage({
  params,
}: MaintenanceItemPageProps): Promise<React.JSX.Element> {
  const canUse = await currentUserCanUseMaintenance()
  if (!canUse) {
    redirect('/unauthorized')
  }

  const { id } = await params

  // Inactive areas are included so an item sitting in one still shows the area it
  // is in. The form offers them for display only; the database refuses a move on
  // to an area that has been switched off.
  const [itemResult, areasResult] = await Promise.all([
    getMaintenanceItem(id),
    getMaintenanceAreas(true),
  ])

  // Three different outcomes, told apart on screen. A read that failed is not the
  // same as a record that is not there, and neither reveals anything about
  // records this person may not see: everyone who reaches this page is already a
  // super-admin who can see all of them. Until an item has loaded its name is not
  // known, so these states use the generic title; the item itself titles the page
  // with its own name (MaintenanceDetailClient).
  if (!itemResult.success) {
    if (itemResult.code === 'forbidden') {
      redirect('/unauthorized')
    }

    return (
      <PageLayout {...MAINTENANCE_ITEM_LAYOUT} title="Maintenance Item">
        <Alert tone="danger" title="Could not load this item">
          {itemResult.error ?? 'Something went wrong. Please reload the page and try again.'}
        </Alert>
      </PageLayout>
    )
  }

  if (!itemResult.data) {
    return (
      <PageLayout {...MAINTENANCE_ITEM_LAYOUT} title="Maintenance Item">
        <Alert tone="warning" title="That item is not here">
          It may have been logged under a different reference. Go back to the list and search for
          it.
        </Alert>
      </PageLayout>
    )
  }

  return (
    <MaintenanceDetailClient
      item={itemResult.data}
      areas={areasResult.data ?? []}
      areasUnavailable={!areasResult.success}
      todayIsoDate={getTodayIsoDate()}
    />
  )
}
