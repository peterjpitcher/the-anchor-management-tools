import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getChecklistTodos } from '@/app/actions/event-checklist'
import { PageHeader } from '@/ds'
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
    <div className="p-6">
      <PageHeader
        title="Event Todos"
        subtitle="Cross-event checklist overview"
        breadcrumbs={[
          { label: 'Events', href: '/events' },
          { label: 'Todos' },
        ]}
      />
      <TodoClient initialTodos={result.items ?? []} />
    </div>
  )
}
