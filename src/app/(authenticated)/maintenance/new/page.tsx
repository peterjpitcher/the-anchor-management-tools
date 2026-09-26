import { redirect } from 'next/navigation'
import { Alert, LinkButton, PageLayout } from '@/ds'
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

  // One header for every state. A single form, so the page is medium width.
  const layoutProps = {
    title: 'Log an Issue or Improvement',
    subtitle: 'Four fields is enough, photos and the rest come afterwards',
    backButton: { label: 'Back to Maintenance', href: '/maintenance' },
    containerSize: 'md',
  } as const

  if (!areasResult.success) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger" title="Could not load the areas">
          {areasResult.error ?? 'Please reload the page and try again.'}
        </Alert>
      </PageLayout>
    )
  }

  const areas = areasResult.data ?? []

  // Without an area there is nothing valid to save, so say so rather than showing
  // a form that can only fail.
  if (areas.length === 0) {
    return (
      <PageLayout {...layoutProps}>
        <Alert
          tone="warning"
          title="There are no areas yet"
          actions={
            <LinkButton href="/settings/maintenance" size="sm">
              Manage Areas
            </LinkButton>
          }
        >
          Add at least one area before logging anything.
        </Alert>
      </PageLayout>
    )
  }

  return (
    <PageLayout {...layoutProps}>
      <MaintenanceNewClient areas={areas} />
    </PageLayout>
  )
}
