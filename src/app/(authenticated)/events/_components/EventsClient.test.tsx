import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// The calendar view is the default. When its events fail to load, the page says so as a danger
// Alert above the calendar with a way to try again, as the list and the board do, rather than
// an empty grid with an amber note underneath.

// The picture panel's storage client needs browser env vars; nothing here uploads.
vi.mock('@/components/providers/SupabaseProvider', () => ({ useSupabase: () => ({ storage: { from: () => ({}) } }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/app/actions/events', () => ({
  getEvents: vi.fn(),
  getCalendarEvents: vi.fn(),
  deleteEvent: vi.fn(),
}))
vi.mock('@/app/actions/private-bookings-dashboard', () => ({
  fetchPrivateBookingsForCalendar: vi.fn(async () => ({ data: [] })),
}))
vi.mock('@/app/actions/calendar-notes', () => ({
  listCalendarNotes: vi.fn(async () => ({ data: [] })),
}))
vi.mock('@/app/actions/parking', () => ({
  listParkingBookings: vi.fn(async () => ({ data: [] })),
}))
vi.mock('@/app/actions/event-series', () => ({
  listEventSeriesNights: vi.fn(async () => ({ success: true, data: [] })),
  markEventSeriesDateReplaced: vi.fn(async () => ({ success: true })),
}))

// The calendar itself is covered by its own tests; here only what it is handed matters.
vi.mock('@/components/schedule-calendar', () => ({
  VenueCalendar: ({
    datasetWarnings,
    events,
    specialHours,
  }: {
    datasetWarnings?: string[]
    events?: unknown[]
    specialHours?: unknown[]
  }) => (
    <div data-testid="venue-calendar">
      <span data-testid="calendar-warnings">{(datasetWarnings ?? []).join(' | ')}</span>
      <span data-testid="calendar-events">{JSON.stringify(events ?? [])}</span>
      <span data-testid="calendar-special-hours">{(specialHours ?? []).length}</span>
    </div>
  ),
}))
vi.mock('./EventDrawer', () => ({ EventDrawer: () => null }))

import EventsClient, { type EventsCalendarLayers } from './EventsClient'
import { getCalendarEvents, getEvents } from '@/app/actions/events'
import { listParkingBookings } from '@/app/actions/parking'
import type { CalendarEventRow } from '@/lib/events/calendar-events'

const mockGetCalendarEvents = vi.mocked(getCalendarEvents)
const mockGetEvents = vi.mocked(getEvents)

describe('EventsClient calendar events failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a danger Alert above the calendar, and Try Again loads the events again', async () => {
    mockGetCalendarEvents.mockResolvedValue({ error: 'Database unavailable' })

    render(
      <EventsClient
        initialEvents={[]}
        categories={[]}
        initialCalendarEvents={[]}
        initialCalendarEventsError="Database unavailable"
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Events could not be loaded')
    expect(alert).toHaveTextContent('Database unavailable')
    // Said once, in the Alert, not repeated among the calendar's layer warnings.
    expect(screen.getByTestId('venue-calendar')).not.toHaveTextContent('Events could not be loaded')

    // The page retries once on its own when the calendar opens with no events.
    await waitFor(() => expect(mockGetCalendarEvents).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))

    await waitFor(() => expect(mockGetCalendarEvents).toHaveBeenCalledTimes(2))
    // The calendar never falls back to the heavy list read.
    expect(mockGetEvents).not.toHaveBeenCalled()
    // Its parking read is windowed, not the newest 500 of all time.
    expect(vi.mocked(listParkingBookings)).toHaveBeenCalledWith(
      expect.objectContaining({ endingFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }),
    )
  })
})

function calendarRow(overrides: Partial<CalendarEventRow>): CalendarEventRow {
  return {
    id: 'event-1',
    name: 'Quiz Night',
    date: '2026-12-03',
    time: '19:00',
    event_status: 'scheduled',
    hero_image_url: null,
    poster_image_url: null,
    thumbnail_image_url: null,
    brief: null,
    short_description: null,
    long_description: null,
    booked_count: 0,
    ...overrides,
  }
}

describe('EventsClient calendar with trimmed rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the seat count and the three readiness flags through from the trimmed rows', () => {
    render(
      <EventsClient
        initialEvents={[]}
        categories={[]}
        initialCalendarEvents={[
          calendarRow({
            id: 'ready',
            booked_count: 42,
            poster_image_url: 'https://example.test/poster.jpg',
            brief: 'Pub quiz brief',
            long_description: 'All about the quiz',
          }),
          calendarRow({ id: 'bare', booked_count: 0, brief: '   ', short_description: '' }),
        ]}
      />,
    )

    const events = JSON.parse(screen.getByTestId('calendar-events').textContent ?? '[]')
    expect(events).toEqual([
      expect.objectContaining({ id: 'ready', bookedSeatsCount: 42, hasImage: true, hasBrief: true, hasDescription: true }),
      expect.objectContaining({ id: 'bare', bookedSeatsCount: 0, hasImage: false, hasBrief: false, hasDescription: false }),
    ])
    // Initial rows were supplied, so no extra fetch on mount.
    expect(mockGetCalendarEvents).not.toHaveBeenCalled()
  })

  it('paints the calendar before the streamed layers arrive, then shows them with their warnings', async () => {
    let resolveLayers: (layers: EventsCalendarLayers) => void = () => {}
    const calendarLayers = new Promise<EventsCalendarLayers>((resolve) => {
      resolveLayers = resolve
    })

    render(
      <EventsClient
        initialEvents={[]}
        categories={[]}
        initialCalendarEvents={[calendarRow({})]}
        calendarLayers={calendarLayers}
      />,
    )

    expect(screen.getByTestId('venue-calendar')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-special-hours')).toHaveTextContent('0')

    resolveLayers({
      specialHours: [{ id: 'sh-1' } as unknown as EventsCalendarLayers['specialHours'][number]],
      birthdays: [],
      balanceDues: [],
      dailyOps: null,
      marketingSends: [],
      warnings: ['Birthdays could not be loaded'],
    })

    expect(await screen.findByText('Birthdays could not be loaded')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-special-hours')).toHaveTextContent('1')
  })
})
