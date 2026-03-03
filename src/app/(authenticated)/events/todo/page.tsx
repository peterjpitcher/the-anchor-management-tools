import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getChecklistTodos } from '@/app/actions/event-checklist'
import TodoClient from './TodoClient'

export const dynamic = 'force-dynamic'

export default async function EventsTodoPage() {
  const canView = await checkUserPermission('events', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getChecklistTodos()

  return (
    <TodoClient
      initialItems={result.items || []}
      initialError={result.success ? undefined : result.error}
    />
  )
}
