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

// Thin wrapper around the shared VenueCalendar. The "add calendar note" flow
// (modal + empty-day click) now lives inside VenueCalendar so the dashboard and
// the events calendar behave identically — this component only forwards props.
export default function UpcomingScheduleCalendar({
  events,
  calendarNotes,
  privateBookings,
  balanceDueDates,
  employeeBirthdays,
  specialHours,
  parkingBookings,
  canCreateCalendarNote,
  dailyOps,
}: {
  events: VenueCalendarEvent[]
  calendarNotes: VenueCalendarNote[]
  privateBookings: VenueCalendarBooking[]
  balanceDueDates: VenueCalendarBalanceDue[]
  employeeBirthdays: VenueCalendarEmployeeBirthday[]
  specialHours: VenueCalendarSpecialHours[]
  parkingBookings: VenueCalendarParking[]
  canCreateCalendarNote?: boolean
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
      canCreateCalendarNote={canCreateCalendarNote}
      dailyOps={dailyOps}
    />
  )
}
