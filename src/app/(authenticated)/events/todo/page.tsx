import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getChecklistTodos } from '@/app/actions/event-checklist'
import { Alert, PageLayout } from '@/ds'
import TodoClient from './_components/TodoClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Event Todos',
}

export default async function EventsTodoPage() {
  const canView = await checkUserPermission('events', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getChecklistTodos()

  return (
    <PageLayout
      title="Event Todos"
      subtitle="Cross-event checklist overview"
      backButton={{ label: 'Back to Events', href: '/events' }}
    >
      {result.success ? (
        <TodoClient initialTodos={result.items ?? []} />
      ) : (
        // A failed load is never shown as "nothing outstanding".
        <Alert tone="danger" title="Outstanding todos could not be loaded">
          {result.error ?? 'Please refresh the page to try again.'}
        </Alert>
      )}
    </PageLayout>
  )
}
