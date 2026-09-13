import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEvents } from '@/app/actions/events'
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
import { getChecklistTodos } from '@/app/actions/event-checklist'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { VenueCalendarBooking, VenueCalendarParking } from '@/components/schedule-calendar'
import EventsClient from './_components/EventsClient'
import EventTodosWidget from './_components/EventTodosWidget'

export const metadata = {
  title: 'Events',
}

// AI SEO generation (generateEventSeoContent, opened from EventDrawer) runs to a ~90s budget; raise past Vercel's 15s default so the function isn't killed mid-generation.
export const maxDuration = 100

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
    canManageCalendarNotes,
    specialHoursResult,
    birthdaysResult,
    balanceDuesResult,
    dailyOpsResult,
    marketingSendsResult,
  ] = await Promise.all([
    getEvents({ status: 'all', dateFrom: getTodayIsoDate(), page: 1, pageSize: 25 }),
    getActiveEventCategories(),
    getEvents({ status: 'all', page: 1, pageSize: 500 }),
    fetchPrivateBookingsForCalendar(),
    listCalendarNotes(),
    // Live bookings only; a cancelled or expired one is not something the
    // calendar should show as an arriving car.
    listParkingBookings({ limit: 500, statuses: ['pending_payment', 'confirmed', 'completed'] }),
    getChecklistTodos().catch(
      () =>
        ({ success: false, error: 'Unable to load outstanding todos' }) as Awaited<
          ReturnType<typeof getChecklistTodos>
        >,
    ),
    checkUserPermission('events', 'manage'),
    checkUserPermission('settings', 'manage'),
    // The datasets the events calendar used to lack. Each gates itself and
    // returns 'denied' rather than an error, so a user who may not see one of
    // them simply does not get that layer.
    fetchCalendarSpecialHours(),
    fetchCalendarBirthdays(),
    fetchCalendarBalanceDues(),
    fetchCalendarDailyOps(),
    fetchCalendarMarketingSends(),
  ])

  // Same rule as the dashboard: write on events:manage, settings:manage kept as
  // a fallback.
  const canManageCalendarNotesResolved = canManageEvents || canManageCalendarNotes

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
            calendarNotesError={notesResult.error ?? null}
            initialCalendarParking={'data' in parkingResult && parkingResult.data ? parkingResult.data as VenueCalendarParking[] : []}
            canManageCalendarNotes={canManageCalendarNotesResolved}
            initialSpecialHours={specialHoursResult.data}
            initialBirthdays={birthdaysResult.data}
            initialBalanceDues={balanceDuesResult.data}
            initialDailyOps={dailyOpsResult.data[0] ?? null}
            initialMarketingSends={marketingSendsResult.data}
            calendarDatasetWarnings={[
              specialHoursResult.status === 'failed' ? specialHoursResult.message : null,
              birthdaysResult.status === 'failed' ? birthdaysResult.message : null,
              balanceDuesResult.status === 'failed' ? balanceDuesResult.message : null,
              dailyOpsResult.status === 'failed' ? dailyOpsResult.message : null,
              marketingSendsResult.status === 'failed' ? marketingSendsResult.message : null,
            ].filter((message): message is string => Boolean(message))}
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
