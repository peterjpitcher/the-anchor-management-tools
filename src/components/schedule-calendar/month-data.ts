import type { RepeatingEventNight } from './adapters'
import type { ScheduleDailyOps } from './types'
import type {
  VenueCalendarBalanceDue,
  VenueCalendarBooking,
  VenueCalendarEmployeeBirthday,
  VenueCalendarEvent,
  VenueCalendarMarketingSend,
  VenueCalendarNote,
  VenueCalendarParking,
  VenueCalendarSpecialHours,
} from './VenueCalendar'

/**
 * Everything the venue calendar shows for one month, as one payload.
 *
 * Both calendars (the dashboard and /events) load exactly this, from one server action, one
 * month at a time. They used to load from today, the last 90 days or the last 12 months,
 * differently per page and per kind of item, so anything older simply fell off the calendar.
 * A layer the user may not see comes back empty; a layer that failed to load comes back empty
 * with a line in `warnings`, so an outage never looks like a quiet month.
 */
export interface VenueCalendarMonthData {
  /** YYYY-MM */
  month: string
  /** First and last date on the month grid, YYYY-MM-DD. */
  startIso: string
  endIso: string
  events: VenueCalendarEvent[]
  repeatingEvents: RepeatingEventNight[]
  privateBookings: VenueCalendarBooking[]
  balanceDueDates: VenueCalendarBalanceDue[]
  employeeBirthdays: VenueCalendarEmployeeBirthday[]
  specialHours: VenueCalendarSpecialHours[]
  calendarNotes: VenueCalendarNote[]
  parkingBookings: VenueCalendarParking[]
  marketingSends: VenueCalendarMarketingSend[]
  dailyOps: ScheduleDailyOps
  warnings: string[]
}
