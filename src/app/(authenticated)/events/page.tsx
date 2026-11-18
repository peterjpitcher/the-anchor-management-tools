import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getCalendarEvents, getEvents } from '@/app/actions/events'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { fetchPrivateBookingsForCalendar } from '@/app/actions/private-bookings-dashboard'
import { listCalendarNotes } from '@/app/actions/calendar-notes'
import { listParkingBookings } from '@/app/actions/parking'
import {
  fetchCalendarBalanceDues,
  fetchCalendarBirthdays,
  fetchCalendarDailyOps,
  fetchCalendarMarketingSends,
  fetchCalendarSpecialHours,
} from '@/app/actions/calendar-datasets'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { calendarParkingStartFrom } from '@/lib/events/calendar-events'
import type { VenueCalendarBooking, VenueCalendarParking } from '@/components/schedule-calendar'
import EventsClient, { type EventsCalendarLayers } from './_components/EventsClient'
import EventTodosPanel, { EventTodosPanelFallback } from './_components/EventTodosPanel'

export const metadata = {
  title: 'Events',
}

// AI SEO generation (generateEventSeoContent, opened from EventDrawer) runs to a ~90s budget; raise past Vercel's 15s default so the function isn't killed mid-generation.
export const maxDuration = 100

/**
 * The calendar's secondary layers. Each gates itself and returns 'denied'
 * rather than an error, so a user who may not see one of them simply does not
 * get that layer. Not awaited by the page: the promise streams to the client,
 * so a slow layer no longer holds first paint.
 */
async function loadCalendarLayers(): Promise<EventsCalendarLayers> {
  const [specialHoursResult, birthdaysResult, balanceDuesResult, dailyOpsResult, marketingSendsResult] =
    await Promise.all([
      fetchCalendarSpecialHours(),
      fetchCalendarBirthdays(),
      fetchCalendarBalanceDues(),
      fetchCalendarDailyOps(),
      fetchCalendarMarketingSends(),
    ])

  return {
    specialHours: specialHoursResult.data,
    birthdays: birthdaysResult.data,
    balanceDues: balanceDuesResult.data,
    dailyOps: dailyOpsResult.data[0] ?? null,
    marketingSends: marketingSendsResult.data,
    warnings: [
      specialHoursResult.status === 'failed' ? specialHoursResult.message : null,
      birthdaysResult.status === 'failed' ? birthdaysResult.message : null,
      balanceDuesResult.status === 'failed' ? balanceDuesResult.message : null,
      dailyOpsResult.status === 'failed' ? dailyOpsResult.message : null,
      marketingSendsResult.status === 'failed' ? marketingSendsResult.message : null,
    ].filter((message): message is string => Boolean(message)),
  }
}

export default async function EventsPage() {
  const [canViewEvents, canManageEvents, canManageCalendarNotes] = await Promise.all([
    checkUserPermission('events', 'view'),
    checkUserPermission('events', 'manage'),
    checkUserPermission('settings', 'manage'),
  ])

  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  // Started before the first-view reads are awaited, so they run alongside them.
  const calendarLayers = loadCalendarLayers().catch(
    (): EventsCalendarLayers => ({
      specialHours: [],
      birthdays: [],
      balanceDues: [],
      dailyOps: null,
      marketingSends: [],
      warnings: ['Some calendar layers could not be loaded'],
    }),
  )

  const [
    eventsResult,
    categoriesResult,
    calEventsResult,
    bookingsResult,
    notesResult,
    parkingResult,
  ] = await Promise.all([
    getEvents({ status: 'all', dateFrom: getTodayIsoDate(), page: 1, pageSize: 25 }),
    getActiveEventCategories(),
    getCalendarEvents(),
    fetchPrivateBookingsForCalendar(),
    listCalendarNotes(),
    // Live bookings only; a cancelled or expired one is not something the
    // calendar should show as an arriving car. Arrivals from the first day of
    // last month onward, not the newest 500 of all time.
    listParkingBookings({
      limit: 500,
      statuses: ['pending_payment', 'confirmed', 'completed'],
      startFrom: calendarParkingStartFrom(),
    }),
  ])

  // Same rule as the dashboard: write on events:manage, settings:manage kept as
  // a fallback.
  const canManageCalendarNotesResolved = canManageEvents || canManageCalendarNotes

  return (
    <EventsClient
      initialEvents={eventsResult.data ?? []}
      initialEventsError={eventsResult.data ? null : eventsResult.error ?? null}
      initialPagination={eventsResult.pagination}
      categories={categoriesResult.data ?? []}
      initialCalendarEvents={calEventsResult.data ?? []}
      initialCalendarEventsError={calEventsResult.data ? null : calEventsResult.error ?? null}
      initialCalendarBookings={'data' in bookingsResult && bookingsResult.data ? bookingsResult.data as VenueCalendarBooking[] : []}
      initialCalendarNotes={notesResult.data ?? []}
      calendarNotesError={notesResult.error ?? null}
      initialCalendarParking={'data' in parkingResult && parkingResult.data ? parkingResult.data as VenueCalendarParking[] : []}
      canManageCalendarNotes={canManageCalendarNotesResolved}
      calendarLayers={calendarLayers}
      todosPanel={
        <Suspense fallback={<EventTodosPanelFallback />}>
          <EventTodosPanel canManage={canManageEvents} />
        </Suspense>
      }
    />
  )
}
