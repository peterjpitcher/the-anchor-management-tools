import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { HireNightView } from '@/services/private-bookings/night-clashes'

/**
 * Review BK-070 and BK-071, owner decision D24: the private booking page lists the diners and event
 * places already in the hire's rooms that night, and the events on the date, with links; the event
 * form and page list the private hires on the event's date and say when a whole-pub hire has
 * stopped ticket sales. Nothing is refused; staff decide.
 */

vi.mock('@/app/actions/venue-night', () => ({ getEventNightNotice: vi.fn(), getDateHoursNotice: vi.fn() }))

import { getDateHoursNotice, getEventNightNotice } from '@/app/actions/venue-night'
import { HireDateHoursNotice } from '@/components/private-bookings/HireDateHoursNotice'
import { HireNightPanel } from '@/app/(authenticated)/private-bookings/[id]/HireNightPanel'
import { EventNightNotice } from '@/app/(authenticated)/events/_components/EventNightNotice'

function night(overrides: Partial<HireNightView> = {}): HireNightView {
  return { date: '2026-11-27', wholePub: false, holdsRoom: true, dinerClashes: [], events: [], hours: null, hasCatering: false, ...overrides }
}

const QUIZ = { id: 'event-1', name: 'Quiz Night', time: '19:00', bookingMode: 'general', status: 'scheduled', ticketsSold: 12, salesStopped: true, closedByThisHire: true }

describe('the clashes on this night panel (private booking page)', () => {
  it('lists each diner and event place in the rooms, with a link and the tables', () => {
    render(
      <HireNightPanel
        view={night({
          dinerClashes: [
            {
              kind: 'table_booking', tableBookingId: 'tb-1', eventBookingId: null, eventId: null, eventName: null,
              reference: 'TB-1234', guestName: 'Ann Diner', covers: 4,
              startsAt: '2026-11-27T19:00:00+00:00', endsAt: '2026-11-27T21:00:00+00:00', tableNames: 'Table 1, Table 4',
            },
            {
              kind: 'event_seats', tableBookingId: null, eventBookingId: 'eb-1', eventId: 'event-1', eventName: 'Quiz Night',
              reference: null, guestName: 'Ben Seats', covers: 1,
              startsAt: '2026-11-27T19:00:00+00:00', endsAt: '2026-11-27T22:00:00+00:00', tableNames: 'Table 2',
            },
          ],
        })}
      />,
    )

    expect(screen.getByText('Clashes on this night')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'TB-1234: Ann Diner, 4 guests' })).toHaveAttribute('href', '/table-bookings/tb-1')
    expect(screen.getByRole('link', { name: 'Quiz Night: Ben Seats, 1 place' })).toHaveAttribute('href', '/events/event-1')
    // London times: 7pm to 9pm GMT in November.
    expect(screen.getByText(/19:00 to 21:00, Table 1, Table 4/)).toBeInTheDocument()
  })

  it('lists the events on the date, and says when this whole-pub hire has stopped ticket sales', () => {
    render(<HireNightPanel view={night({ wholePub: true, events: [QUIZ] })} />)

    expect(screen.getByText('Events on this date')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Quiz Night' })).toHaveAttribute('href', '/events/event-1')
    expect(screen.getByText(/general admission, 12 tickets sold\. Ticket sales have stopped because this hire takes the whole pub\./)).toBeInTheDocument()
  })

  it('says sales will stop once a whole-pub draft holds its room', () => {
    render(<HireNightPanel view={night({ wholePub: true, holdsRoom: false, events: [{ ...QUIZ, salesStopped: false }] })} />)

    expect(screen.getByText(/Ticket sales will stop once this whole-pub hire is confirmed or its deposit is paid\./)).toBeInTheDocument()
  })

  it('says when the pub is closed on the hire date, or the kitchen is with catering booked', () => {
    const { rerender } = render(<HireNightPanel view={night({ hours: { closed: true, kitchenClosed: true } })} />)
    expect(screen.getByText('Closed on this date')).toBeInTheDocument()

    rerender(<HireNightPanel view={night({ hours: { closed: false, kitchenClosed: true }, hasCatering: true })} />)
    expect(screen.getByText('Kitchen closed on this date')).toBeInTheDocument()
  })

  it('shows nothing on a clear night, and says so plainly when the night could not be checked', () => {
    const { container } = render(<HireNightPanel view={night()} />)
    expect(container).toBeEmptyDOMElement()

    render(<HireNightPanel view={null} loadFailed />)
    expect(screen.getByText('Night not checked')).toBeInTheDocument()
  })
})

describe('the private hire notice on the event form and page', () => {
  it('lists the hires on the date without the customer name, and says when sales have stopped', async () => {
    vi.mocked(getEventNightNotice).mockResolvedValue({
      success: true,
      data: {
        date: '2026-11-27',
        ticketSalesStopped: true,
        hours: null,
        hires: [{ id: 'hire-1', status: 'confirmed', startTime: '18:00', endTime: '23:00', guestCount: 120, roomNames: ['Entire Pub'], wholePub: true, holdsRoom: true }],
      },
    })

    render(<EventNightNotice date="2026-11-27" eventId="event-1" />)

    await waitFor(() => expect(screen.getByText('Private hire on this date')).toBeInTheDocument())
    expect(screen.getByText('Ticket sales for this event have stopped: a whole-pub private hire takes the night.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entire Pub, 18:00 to 23:00, 120 guests (confirmed)' })).toHaveAttribute('href', '/private-bookings/hire-1')
    expect(getEventNightNotice).toHaveBeenCalledWith('2026-11-27', 'event-1')
  })

  it('warns that a whole-pub hire will stop sales, and stays quiet on a clear date', async () => {
    vi.mocked(getEventNightNotice).mockResolvedValueOnce({
      success: true,
      data: {
        date: '2026-11-28',
        ticketSalesStopped: false,
        hours: null,
        hires: [{ id: 'hire-2', status: 'draft', startTime: '19:00', endTime: null, guestCount: null, roomNames: ['Entire Pub'], wholePub: true, holdsRoom: false }],
      },
    })
    render(<EventNightNotice date="2026-11-28" />)
    await waitFor(() => expect(screen.getByText(/stops ticket sales for any event it overlaps/)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Entire Pub, 19:00 (enquiry)' })).toBeInTheDocument()

    vi.mocked(getEventNightNotice).mockResolvedValueOnce({ success: true, data: { date: '2026-11-29', ticketSalesStopped: false, hours: { known: true, closed: false, kitchenClosed: false }, hires: [] } })
    const { container } = render(<EventNightNotice date="2026-11-29" />)
    await waitFor(() => expect(getEventNightNotice).toHaveBeenCalledWith('2026-11-29', null))
    expect(container).toBeEmptyDOMElement()
  })

  // BK-076, D24: an event on a closed day is warned about, not refused; a closed kitchen is said.
  it('warns when the pub is closed on the date, and notes a closed kitchen', async () => {
    vi.mocked(getEventNightNotice).mockResolvedValueOnce({
      success: true,
      data: { date: '2026-12-25', ticketSalesStopped: false, hours: { known: true, closed: true, kitchenClosed: true }, hires: [] },
    })
    render(<EventNightNotice date="2026-12-25" />)
    await waitFor(() => expect(screen.getByText('Closed on this date')).toBeInTheDocument())
    expect(screen.getByText('The pub is closed on this date. Check the opening hours before putting an event on.')).toBeInTheDocument()

    vi.mocked(getEventNightNotice).mockResolvedValueOnce({
      success: true,
      data: { date: '2026-12-28', ticketSalesStopped: false, hours: { known: true, closed: false, kitchenClosed: true }, hires: [] },
    })
    render(<EventNightNotice date="2026-12-28" />)
    await waitFor(() => expect(screen.getByText('Kitchen closed on this date')).toBeInTheDocument())
  })

  it('says the date was not checked when the lookup fails', async () => {
    vi.mocked(getEventNightNotice).mockResolvedValueOnce({ error: 'Could not check private hires on this date.' })
    render(<EventNightNotice date="2026-11-30" />)
    await waitFor(() => expect(screen.getByText('Private hires not checked')).toBeInTheDocument())
  })
})

describe('the closed-day notice on the private booking forms', () => {
  it('warns on a closed day, notes a closed kitchen, and says nothing on an open day or without a date', async () => {
    vi.mocked(getDateHoursNotice).mockResolvedValueOnce({ success: true, data: { known: true, closed: true, kitchenClosed: true } })
    const { rerender, container } = render(<HireDateHoursNotice date="2026-12-25" />)
    await waitFor(() => expect(screen.getByText('Closed on this date')).toBeInTheDocument())
    expect(getDateHoursNotice).toHaveBeenCalledWith('2026-12-25')

    vi.mocked(getDateHoursNotice).mockResolvedValueOnce({ success: true, data: { known: true, closed: false, kitchenClosed: true } })
    rerender(<HireDateHoursNotice date="2026-12-28" />)
    await waitFor(() => expect(screen.getByText('Kitchen closed on this date')).toBeInTheDocument())

    vi.mocked(getDateHoursNotice).mockResolvedValueOnce({ success: true, data: { known: true, closed: false, kitchenClosed: false } })
    rerender(<HireDateHoursNotice date="2026-12-29" />)
    await waitFor(() => expect(getDateHoursNotice).toHaveBeenCalledWith('2026-12-29'))
    expect(container).toBeEmptyDOMElement()

    vi.mocked(getDateHoursNotice).mockClear()
    rerender(<HireDateHoursNotice date={null} />)
    expect(getDateHoursNotice).not.toHaveBeenCalled()
  })
})
