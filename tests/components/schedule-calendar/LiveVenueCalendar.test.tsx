import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { VenueCalendarMonthData } from '@/components/schedule-calendar/month-data'

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))
const { getVenueCalendarMonth } = vi.hoisted(() => ({ getVenueCalendarMonth: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => nav.params,
}))
vi.mock('@/app/actions/venue-calendar', () => ({ getVenueCalendarMonth }))

// The grid itself has its own tests. Here only what reaches it matters: whose events, and the
// message laid over it.
vi.mock('@/components/schedule-calendar/VenueCalendar', () => ({
  VenueCalendar: ({ events, overlay, onNotesChanged }: { events: Array<{ id: string }>; overlay: ReactNode; onNotesChanged: () => void }) => (
    <div>
      <span data-testid="events">{events.map((e) => e.id).join(',') || 'none'}</span>
      <div data-testid="overlay">{overlay}</div>
      <button type="button" onClick={onNotesChanged}>Notes changed</button>
    </div>
  ),
}))

import { LiveVenueCalendar } from '@/components/schedule-calendar/LiveVenueCalendar'

function monthData(month: string, eventId: string): VenueCalendarMonthData {
  return {
    month,
    startIso: `${month}-01`,
    endIso: `${month}-28`,
    events: [{ id: eventId, name: eventId, date: `${month}-10`, time: '19:00', bookedSeatsCount: 0, eventStatus: 'scheduled' }],
    repeatingEvents: [],
    privateBookings: [],
    balanceDueDates: [],
    employeeBirthdays: [],
    specialHours: [],
    calendarNotes: [],
    parkingBookings: [],
    marketingSends: [],
    dailyOps: { coversByDate: {}, staffByDate: {}, hireGuestsByDate: {} },
    warnings: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('LiveVenueCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nav.params = new URLSearchParams()
  })

  it('draws the month the server loaded without fetching it again', () => {
    nav.params = new URLSearchParams('calMonth=2026-03')
    render(<LiveVenueCalendar initialData={monthData('2026-03', 'march-quiz')} />)

    expect(screen.getByTestId('events')).toHaveTextContent('march-quiz')
    expect(screen.getByTestId('overlay')).toBeEmptyDOMElement()
    expect(getVenueCalendarMonth).not.toHaveBeenCalled()
  })

  it('opens on the month the server loaded when the URL names none', () => {
    render(<LiveVenueCalendar initialData={monthData('2026-03', 'march-quiz')} />)
    expect(screen.getByTestId('events')).toHaveTextContent('march-quiz')
    expect(getVenueCalendarMonth).not.toHaveBeenCalled()
  })

  it('shows a loading message over an unloaded month, never last month\'s items, then draws it', async () => {
    const reply = deferred<{ data: VenueCalendarMonthData }>()
    getVenueCalendarMonth.mockReturnValueOnce(reply.promise)
    nav.params = new URLSearchParams('calMonth=2026-04')

    render(<LiveVenueCalendar initialData={monthData('2026-03', 'march-quiz')} />)

    expect(getVenueCalendarMonth).toHaveBeenCalledWith({ month: '2026-04' })
    expect(screen.getByTestId('events')).toHaveTextContent('none')
    expect(screen.getByRole('status')).toHaveTextContent('Loading April 2026')

    await act(async () => reply.resolve({ data: monthData('2026-04', 'april-bingo') }))

    expect(screen.getByTestId('events')).toHaveTextContent('april-bingo')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows an error with Try Again when a month fails, and Try Again reloads it', async () => {
    getVenueCalendarMonth.mockResolvedValueOnce({ error: 'Unauthorized' })
    nav.params = new URLSearchParams('calMonth=2026-04')

    render(<LiveVenueCalendar initialData={null} />)

    expect(await screen.findByText(/April 2026 could not be loaded\. Unauthorized/)).toBeInTheDocument()
    expect(screen.getByTestId('events')).toHaveTextContent('none')

    getVenueCalendarMonth.mockResolvedValueOnce({ data: monthData('2026-04', 'april-bingo') })
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(await screen.findByText('april-bingo')).toBeInTheDocument()
    expect(getVenueCalendarMonth).toHaveBeenCalledTimes(2)
  })

  it('drops a slow reply for a month already paged past', async () => {
    const slowApril = deferred<{ data: VenueCalendarMonthData }>()
    const may = deferred<{ data: VenueCalendarMonthData }>()
    getVenueCalendarMonth.mockReturnValueOnce(slowApril.promise).mockReturnValueOnce(may.promise)

    nav.params = new URLSearchParams('calMonth=2026-04')
    const { rerender } = render(<LiveVenueCalendar initialData={null} />)

    nav.params = new URLSearchParams('calMonth=2026-05')
    rerender(<LiveVenueCalendar initialData={null} />)
    expect(getVenueCalendarMonth).toHaveBeenLastCalledWith({ month: '2026-05' })

    // April answers after the user has moved on: it must not land on May's grid.
    await act(async () => slowApril.resolve({ data: monthData('2026-04', 'april-bingo') }))
    expect(screen.getByTestId('events')).toHaveTextContent('none')
    expect(screen.getByRole('status')).toHaveTextContent('Loading May 2026')

    await act(async () => may.resolve({ data: monthData('2026-05', 'may-quiz') }))
    expect(screen.getByTestId('events')).toHaveTextContent('may-quiz')
  })

  it('reloads the month on screen when the page asks for a refresh', async () => {
    nav.params = new URLSearchParams('calMonth=2026-03')
    getVenueCalendarMonth.mockResolvedValueOnce({ data: monthData('2026-03', 'march-quiz-renamed') })

    const { rerender } = render(<LiveVenueCalendar initialData={monthData('2026-03', 'march-quiz')} refreshKey={0} />)
    expect(getVenueCalendarMonth).not.toHaveBeenCalled()

    rerender(<LiveVenueCalendar initialData={monthData('2026-03', 'march-quiz')} refreshKey={1} />)

    expect(await screen.findByText('march-quiz-renamed')).toBeInTheDocument()
    expect(getVenueCalendarMonth).toHaveBeenCalledWith({ month: '2026-03' })
  })

  it('reloads the month after a note is saved', async () => {
    nav.params = new URLSearchParams('calMonth=2026-03')
    getVenueCalendarMonth.mockResolvedValueOnce({ data: monthData('2026-03', 'with-new-note') })

    render(<LiveVenueCalendar initialData={monthData('2026-03', 'march-quiz')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Notes changed' }))

    expect(await screen.findByText('with-new-note')).toBeInTheDocument()
  })
})
