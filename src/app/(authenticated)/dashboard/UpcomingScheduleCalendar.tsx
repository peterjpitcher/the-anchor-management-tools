'use client'

import { VenueCalendar } from '@/components/schedule-calendar'
import type {
  VenueCalendarEvent,
  VenueCalendarBooking,
  VenueCalendarBalanceDue,
  VenueCalendarEmployeeBirthday,
  VenueCalendarNote,
  VenueCalendarParking,
  VenueCalendarSpecialHours,
  ScheduleDailyOps,
} from '@/components/schedule-calendar'

// Thin wrapper around the shared VenueCalendar. The calendar-note flow
// (create, edit and delete, via the modal and the empty-day click) lives inside
// VenueCalendar so the dashboard and the events calendar behave identically.
// This component only forwards props.
export default function UpcomingScheduleCalendar({
  events,
  calendarNotes,
  privateBookings,
  balanceDueDates,
  employeeBirthdays,
  specialHours,
  parkingBookings,
  canManageCalendarNotes,
  dailyOps,
}: {
  events: VenueCalendarEvent[]
  calendarNotes: VenueCalendarNote[]
  privateBookings: VenueCalendarBooking[]
  balanceDueDates: VenueCalendarBalanceDue[]
  employeeBirthdays: VenueCalendarEmployeeBirthday[]
  specialHours: VenueCalendarSpecialHours[]
  parkingBookings: VenueCalendarParking[]
  canManageCalendarNotes?: boolean
  dailyOps?: ScheduleDailyOps
}) {
  return (
    <VenueCalendar
      events={events}
      calendarNotes={calendarNotes}
      privateBookings={privateBookings}
      balanceDueDates={balanceDueDates}
      employeeBirthdays={employeeBirthdays}
      specialHours={specialHours}
      parkingBookings={parkingBookings}
      canManageCalendarNotes={canManageCalendarNotes}
      dailyOps={dailyOps}
      // Owner decision: the dashboard gets the same filter bar as /events. It is
      // also the only way to reveal cancelled private hire, which is hidden by
      // default, and the only place the "N of M" line appears at all.
      showFilters
    />
  )
}
