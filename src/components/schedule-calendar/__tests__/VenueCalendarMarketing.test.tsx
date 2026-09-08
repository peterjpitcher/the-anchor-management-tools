// Renders the real VenueCalendar with marketing sends, so the wiring between
// the reader's row shape, the adapter and the month grid is covered end to end.
// The adapter unit tests alone would still pass if the prop were never threaded
// through buildEntries.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { VenueCalendar, type VenueCalendarMarketingSend } from '../VenueCalendar'

// jsdom has no matchMedia. ScheduleCalendar uses it to force the list view on a
// phone; false keeps the desktop month grid, which is the view under test.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/events',
  // Anchored to September 2026 so the grid is deterministic wherever this runs.
  useSearchParams: () => new URLSearchParams('calMonth=2026-09'),
}))

vi.mock('@/app/actions/calendar-notes', () => ({
  createCalendarNote: vi.fn(),
  updateCalendarNote: vi.fn(),
  deleteCalendarNote: vi.fn(),
}))

// Two real production rows, copied from marketing_campaigns: one already sent
// and one still to go.
const SENDS: VenueCalendarMarketingSend[] = [
  {
    id: 'c04c3fb6-3bf1-4c33-bd73-bf43bb49aa7d',
    name: 'Welcome to September - guests - 2026',
    subject: 'Welcome to September at The Anchor',
    audience_type: 'customer',
    status: 'completed',
    send_at: '2026-09-08T15:00:30.851790+00:00',
    recipient_count: 252,
  },
  {
    id: 'a060c4ef-d4f8-418e-89bd-6da7b3af4976',
    name: 'Autumn Kick-Off Quiz Night - guests - 16 Sep 2026',
    subject: 'Quiz Night, 16 September: whose on your team?',
    audience_type: 'customer',
    status: 'scheduled',
    send_at: '2026-09-14T11:00:00+00:00',
    recipient_count: 252,
  },
]

function renderCalendar(marketingSends: VenueCalendarMarketingSend[]) {
  return render(
    <VenueCalendar
      events={[]}
      privateBookings={[]}
      calendarNotes={[]}
      parkingBookings={[]}
      marketingSends={marketingSends}
      showFilters
    />,
  )
}

describe('VenueCalendar marketing sends', () => {
  it('puts each send on the calendar with its status and audience size', () => {
    renderCalendar(SENDS)

    expect(screen.getAllByText('Welcome to September - guests - 2026').length).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Autumn Kick-Off Quiz Night - guests - 16 Sep 2026').length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Scheduled').length).toBeGreaterThan(0)
    expect(screen.getAllByText('252 recipients').length).toBe(2)
  })

  it('offers a Marketing emails filter only when there are sends', () => {
    const { unmount } = renderCalendar(SENDS)
    expect(screen.getByRole('button', { name: /Marketing emails/ })).toBeTruthy()
    unmount()

    renderCalendar([])
    expect(screen.queryByRole('button', { name: /Marketing emails/ })).toBeNull()
  })

  it('carries the campaign badge so a send is never mistaken for an event', () => {
    renderCalendar(SENDS)
    expect(screen.getAllByText('Email').length).toBeGreaterThan(0)
  })
})
