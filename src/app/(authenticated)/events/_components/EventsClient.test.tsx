import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// The calendar loads its own month (LiveVenueCalendar, covered by its own tests). Here only what
// the page hands it matters: the month the server loaded, and a way to open a repeating event.

// The picture panel's storage client needs browser env vars; nothing here uploads.
vi.mock('@/components/providers/SupabaseProvider', () => ({ useSupabase: () => ({ storage: { from: () => ({}) } }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/app/actions/events', () => ({
  getEvents: vi.fn(),
  deleteEvent: vi.fn(),
}))
vi.mock('@/app/actions/event-series', () => ({
  markEventSeriesDateReplaced: vi.fn(async () => ({ success: true })),
}))
vi.mock('./RepeatingEventsPanel', () => ({
  RepeatingEventsPanel: ({ focusSeriesId }: { focusSeriesId: string | null }) => (
    <div data-testid="repeating-panel">{focusSeriesId}</div>
  ),
}))

vi.mock('@/components/schedule-calendar', () => ({
  LiveVenueCalendar: ({
    initialData,
    refreshKey,
    onRepeatingEventClick,
  }: {
    initialData?: { month: string } | null
    refreshKey?: number
    onRepeatingEventClick?: (seriesId: string) => void
  }) => (
    <div data-testid="venue-calendar">
      <span data-testid="calendar-month">{initialData?.month ?? 'none'}</span>
      <span data-testid="calendar-refresh">{refreshKey}</span>
      <button type="button" onClick={() => onRepeatingEventClick?.('series-1')}>
        Open repeating night
      </button>
    </div>
  ),
}))
vi.mock('./EventDrawer', () => ({ EventDrawer: () => null }))

import EventsClient from './EventsClient'
import { getEvents } from '@/app/actions/events'
import type { VenueCalendarMonthData } from '@/components/schedule-calendar'

function monthData(month: string): VenueCalendarMonthData {
  return {
    month,
    startIso: `${month}-01`,
    endIso: `${month}-28`,
    events: [],
    repeatingEvents: [],
    privateBookings: [],
    balanceDueDates: [],
    employeeBirthdays: [],
    specialHours: [],
    calendarNotes: [],
    parkingBookings: [],
    marketingSends: [],
    textMessages: [],
    dailyOps: { coversByDate: {}, staffByDate: {}, hireGuestsByDate: {} },
    warnings: [],
  }
}

describe('EventsClient calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens on the calendar with the month the server loaded, and reads no events list for it', () => {
    render(<EventsClient initialEvents={[]} categories={[]} initialCalendarMonth={monthData('2026-03')} />)

    expect(screen.getByTestId('calendar-month')).toHaveTextContent('2026-03')
    expect(screen.getByTestId('calendar-refresh')).toHaveTextContent('0')
    // The calendar never falls back to the heavy list read.
    expect(vi.mocked(getEvents)).not.toHaveBeenCalled()
  })

  it('opens the Repeating events tab on the repeating event whose night was clicked', () => {
    render(<EventsClient initialEvents={[]} categories={[]} initialCalendarMonth={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open repeating night' }))

    expect(screen.getByTestId('repeating-panel')).toHaveTextContent('series-1')
    expect(screen.queryByTestId('venue-calendar')).not.toBeInTheDocument()
  })
})
