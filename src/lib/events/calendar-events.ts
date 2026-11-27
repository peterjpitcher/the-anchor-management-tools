/**
 * The trimmed event row the events calendar renders.
 *
 * Only what `toVenueCalendarEvent` in src/app/actions/venue-calendar.ts reads: no capacity snapshot and no
 * link clicks, which the calendar never shows. `booked_count` is the same
 * `totalSeats` figure `getEvents` reports, built from the embedded bookings.
 */
export interface CalendarEventRow {
  id: string
  name: string
  date: string
  time: string
  event_status: string | null
  hero_image_url: string | null
  poster_image_url: string | null
  thumbnail_image_url: string | null
  brief: string | null
  short_description: string | null
  long_description: string | null
  booked_count: number
}
