import { redirect } from 'next/navigation'
import { Alert, LinkButton, PageHeader } from '@/ds'
import { currentUserCanUseMaintenance, getMaintenanceAreas } from '@/app/actions/maintenance'
import { MaintenanceNewClient } from '../_components/MaintenanceNewClient'

export default async function NewMaintenanceItemPage(): Promise<React.JSX.Element> {
  const canUse = await currentUserCanUseMaintenance()
  if (!canUse) {
    redirect('/unauthorized')
  }

  // Active areas only. A switched-off area stays visible on items that already use
  // it, but nothing new can be logged against one.
  const areasResult = await getMaintenanceAreas()

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Maintenance', href: '/maintenance' }, { label: 'Log an issue' }]}
      title="Log an issue or improvement"
      subtitle="Four fields is enough. Photos and the rest come afterwards."
      className="mb-0"
    />
  )

  if (!areasResult.success) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger" title="Could not load the areas">
          {areasResult.error ?? 'Please reload the page and try again.'}
        </Alert>
      </div>
    )
  }

  const areas = areasResult.data ?? []

  // Without an area there is nothing valid to save, so say so rather than showing
  // a form that can only fail.
  if (areas.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Alert
          tone="warning"
          title="There are no areas yet"
          actions={<LinkButton href="/settings/maintenance">Manage areas</LinkButton>}
        >
          Add at least one area before logging anything.
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      <MaintenanceNewClient areas={areas} />
    </div>
  )
}
