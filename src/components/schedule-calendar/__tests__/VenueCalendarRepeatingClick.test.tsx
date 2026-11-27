// A repeating event's night on the calendar used to do nothing when clicked, which read as
// broken. Renders the real VenueCalendar so the click is covered from the month grid's button
// through to the callback the Events page uses to open the Repeating events tab.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { VenueCalendar } from '../VenueCalendar'

const push = vi.fn()

// jsdom has no matchMedia. false keeps the desktop month grid, the view under test.
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
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/events',
  // Anchored to December 2026 so the grid is the same wherever this runs.
  useSearchParams: () => new URLSearchParams('calMonth=2026-12'),
}))

vi.mock('@/app/actions/calendar-notes', () => ({
  createCalendarNote: vi.fn(),
  updateCalendarNote: vi.fn(),
  deleteCalendarNote: vi.fn(),
}))

const NIGHT = { seriesId: 'series-1', name: 'Ladies Darts Night', date: '2026-12-10', startTime: '19:00', endTime: '22:00' }

describe('VenueCalendar repeating event nights', () => {
  it('hands the repeating event to the page when its night is clicked, and navigates nowhere', () => {
    const onRepeatingEventClick = vi.fn()
    render(
      <VenueCalendar
        events={[]}
        privateBookings={[]}
        calendarNotes={[]}
        parkingBookings={[]}
        repeatingEvents={[NIGHT]}
        onRepeatingEventClick={onRepeatingEventClick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Ladies Darts Night/ }))

    expect(onRepeatingEventClick).toHaveBeenCalledWith('series-1')
    expect(push).not.toHaveBeenCalled()
  })
})
