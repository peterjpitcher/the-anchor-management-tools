import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEvents } from '@/app/actions/events'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import EventsClient from './_components/EventsClient'

export const metadata = {
  title: 'Events',
}

export default async function EventsPage() {
  const canViewEvents = await checkUserPermission('events', 'view')

  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  const [eventsResult, categoriesResult] = await Promise.all([
    getEvents({ status: 'all', page: 1, pageSize: 25 }),
    getActiveEventCategories(),
  ])

  return (
    <div className="p-6">
      <EventsClient
        initialEvents={eventsResult.data ?? []}
        initialPagination={eventsResult.pagination}
        categories={categoriesResult.data ?? []}
      />
    </div>
  )
}
