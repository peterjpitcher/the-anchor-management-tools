import { redirect } from 'next/navigation'
import { Alert, LinkButton, PageHeader } from '@/ds'
import {
  currentUserCanUseMaintenance,
  getMaintenanceAreas,
  getMaintenanceItem,
} from '@/app/actions/maintenance'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { MaintenanceDetailClient } from '../_components/MaintenanceDetailClient'

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

  const [itemResult, areasResult] = await Promise.all([
    getMaintenanceItem(id),
    getMaintenanceAreas(),
  ])

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Maintenance', href: '/maintenance' }, { label: 'Item' }]}
      title="Maintenance item"
      actions={<LinkButton href="/maintenance">Back to the list</LinkButton>}
      className="mb-0"
    />
  )

  // Three different outcomes, told apart on screen. A read that failed is not the
  // same as a record that is not there, and neither reveals anything about
  // records this person may not see: everyone who reaches this page is already a
  // super-admin who can see all of them.
  if (!itemResult.success) {
    if (itemResult.code === 'forbidden') {
      redirect('/unauthorized')
    }

    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger" title="Could not load this item">
          {itemResult.error ?? 'Something went wrong. Please reload the page and try again.'}
        </Alert>
      </div>
    )
  }

  if (!itemResult.data) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="warning" title="That item is not here">
          It may have been logged under a different reference. Go back to the list and search for
          it.
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      {!areasResult.success && (
        <Alert tone="warning" title="Areas are unavailable">
          The area cannot be changed at the moment because the list of areas could not be loaded.
        </Alert>
      )}
      <MaintenanceDetailClient
        item={itemResult.data}
        areas={areasResult.data ?? []}
        todayIsoDate={getTodayIsoDate()}
      />
    </div>
  )
}
