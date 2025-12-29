import { checkUserPermission } from '@/app/actions/rbac'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { redirect } from 'next/navigation'
import { EventCategory } from '@/types/event-categories'
import NewEventClient from './NewEventClient'

export const metadata = {
  title: 'Create New Event',
}

export default async function NewEventPage() {
  const canManageEvents = await checkUserPermission('events', 'manage')
  if (!canManageEvents) {
    redirect('/unauthorized')
  }

  const categoriesResult = await getActiveEventCategories()
  if (categoriesResult.error) {
    console.error('Error loading event categories:', categoriesResult.error)
  }

  return (
    <NewEventClient
      categories={(categoriesResult.data as EventCategory[]) || []}
    />
  )
}
