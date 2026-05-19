import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEvents } from '@/app/actions/events'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { fetchPrivateBookingsForCalendar } from '@/app/actions/private-bookings-dashboard'
import { listCalendarNotes } from '@/app/actions/calendar-notes'
import { listParkingBookings } from '@/app/actions/parking'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { VenueCalendarBooking, VenueCalendarParking } from '@/components/schedule-calendar'
import EventsClient from './_components/EventsClient'

export const metadata = {
  title: 'Events',
}

export default async function EventsPage() {
  const canViewEvents = await checkUserPermission('events', 'view')

  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  const [eventsResult, categoriesResult, calEventsResult, bookingsResult, notesResult, parkingResult] = await Promise.all([
    getEvents({ status: 'all', dateFrom: getTodayIsoDate(), page: 1, pageSize: 25 }),
    getActiveEventCategories(),
    getEvents({ status: 'all', page: 1, pageSize: 500 }),
    fetchPrivateBookingsForCalendar(),
    listCalendarNotes(),
    listParkingBookings({ limit: 500 }),
  ])

  return (
    <div className="p-6">
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
  )
}
