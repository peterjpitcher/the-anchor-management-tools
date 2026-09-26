import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// The calendar view is the default. When its events fail to load, the page says so as a danger
// Alert above the calendar with a way to try again, as the list and the board do, rather than
// an empty grid with an amber note underneath.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/app/actions/events', () => ({
  getEvents: vi.fn(),
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

// The calendar itself is covered by its own tests; here only what it is handed matters.
vi.mock('@/components/schedule-calendar', () => ({
  VenueCalendar: ({ datasetWarnings }: { datasetWarnings?: string[] }) => (
    <div data-testid="venue-calendar">{(datasetWarnings ?? []).join(' | ')}</div>
  ),
}))
vi.mock('./EventDrawer', () => ({ EventDrawer: () => null }))

import EventsClient from './EventsClient'
import { getEvents } from '@/app/actions/events'

const mockGetEvents = vi.mocked(getEvents)

describe('EventsClient calendar events failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a danger Alert above the calendar, and Try Again loads the events again', async () => {
    mockGetEvents.mockResolvedValue({ error: 'Database unavailable' } as Awaited<ReturnType<typeof getEvents>>)

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
    await waitFor(() => expect(mockGetEvents).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))

    await waitFor(() => expect(mockGetEvents).toHaveBeenCalledTimes(2))
  })
})
