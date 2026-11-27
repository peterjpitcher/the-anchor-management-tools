import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEvents } from '@/app/actions/events'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { getVenueCalendarMonth } from '@/app/actions/venue-calendar'
import { currentCalendarMonth, isCalendarMonth } from '@/lib/calendar/month-window'
import { CAL_MONTH_PARAM } from '@/components/schedule-calendar/url-state'
import { getTodayIsoDate } from '@/lib/dateUtils'
import EventsClient from './_components/EventsClient'
import EventTodosPanel, { EventTodosPanelFallback } from './_components/EventTodosPanel'

export const metadata = {
  title: 'Events',
}

// AI SEO generation (generateEventSeoContent, opened from EventDrawer) runs to a ~90s budget; raise past Vercel's 15s default so the function isn't killed mid-generation.
export const maxDuration = 100

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [canViewEvents, canManageEvents, canManageCalendarNotes] = await Promise.all([
    checkUserPermission('events', 'view'),
    checkUserPermission('events', 'manage'),
    checkUserPermission('settings', 'manage'),
  ])

  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  // The calendar's month comes from the URL (calMonth). This one is loaded here for the first
  // paint; the calendar loads every other month itself as it is paged to.
  const params = await searchParams
  const requestedMonth = typeof params[CAL_MONTH_PARAM] === 'string' ? params[CAL_MONTH_PARAM] : null
  const calendarMonth = requestedMonth && isCalendarMonth(requestedMonth) ? requestedMonth : currentCalendarMonth()

  const [eventsResult, categoriesResult, calendarMonthResult] = await Promise.all([
    getEvents({ status: 'all', dateFrom: getTodayIsoDate(), page: 1, pageSize: 25 }),
    getActiveEventCategories(),
    getVenueCalendarMonth({ month: calendarMonth }).catch(() => ({ data: undefined })),
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
      initialCalendarMonth={calendarMonthResult.data ?? null}
      canManageCalendarNotes={canManageCalendarNotesResolved}
      canManageEvents={canManageEvents}
      todosPanel={
        <Suspense fallback={<EventTodosPanelFallback />}>
          <EventTodosPanel canManage={canManageEvents} />
        </Suspense>
      }
    />
  )
}
