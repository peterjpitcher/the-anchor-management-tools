import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEvents } from '@/app/actions/events'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { fetchPrivateBookingsForCalendar } from '@/app/actions/private-bookings-dashboard'
import { listCalendarNotes } from '@/app/actions/calendar-notes'
import { listParkingBookings } from '@/app/actions/parking'
import { getChecklistTodos } from '@/app/actions/event-checklist'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { VenueCalendarBooking, VenueCalendarParking } from '@/components/schedule-calendar'
import EventsClient from './_components/EventsClient'
import EventTodosWidget from './_components/EventTodosWidget'

export const metadata = {
  title: 'Events',
}

export default async function EventsPage() {
  const canViewEvents = await checkUserPermission('events', 'view')

  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  const [
    eventsResult,
    categoriesResult,
    calEventsResult,
    bookingsResult,
    notesResult,
    parkingResult,
    todosResult,
    canManageEvents,
  ] = await Promise.all([
    getEvents({ status: 'all', dateFrom: getTodayIsoDate(), page: 1, pageSize: 25 }),
    getActiveEventCategories(),
    getEvents({ status: 'all', page: 1, pageSize: 500 }),
    fetchPrivateBookingsForCalendar(),
    listCalendarNotes(),
    listParkingBookings({ limit: 500 }),
    getChecklistTodos(),
    checkUserPermission('events', 'manage'),
  ])

  return (
    <div className="p-6">
      <div className="flex flex-col gap-6 xl:flex-row">
        <div className="min-w-0 flex-1">
          <EventsClient
            initialEvents={eventsResult.data ?? []}
            initialPagination={eventsResult.pagination}
            categories={categoriesResult.data ?? []}
            initialCalendarEvents={calEventsResult.data ?? []}
            initialCalendarBookings={'data' in bookingsResult && bookingsResult.data ? bookingsResult.data as VenueCalendarBooking[] : []}
            initialCalendarNotes={notesResult.data ?? []}
            initialCalendarParking={'data' in parkingResult && parkingResult.data ? parkingResult.data as VenueCalendarParking[] : []}
          />
        </div>
        <aside className="xl:w-80 xl:shrink-0">
          <EventTodosWidget
            initialTodos={todosResult.items ?? []}
            canManage={canManageEvents}
            todayIso={getTodayIsoDate()}
            loadError={todosResult.success ? null : todosResult.error ?? 'Unable to load outstanding todos'}
          />
        </aside>
      </div>
    </div>
  )
}
