'use client'

import { LiveVenueCalendar } from '@/components/schedule-calendar'
import type { VenueCalendarMonthData } from '@/components/schedule-calendar'

// Thin wrapper around the shared month-loading calendar, so the dashboard and the events
// calendar load, show and edit exactly the same things.
export default function UpcomingScheduleCalendar({
  initialData,
  canManageCalendarNotes,
}: {
  initialData: VenueCalendarMonthData | null
  canManageCalendarNotes?: boolean
}) {
  return (
    <LiveVenueCalendar
      initialData={initialData}
      canManageCalendarNotes={canManageCalendarNotes}
      // Owner decision: the dashboard gets the same filter bar as /events.
      showFilters
    />
  )
}
