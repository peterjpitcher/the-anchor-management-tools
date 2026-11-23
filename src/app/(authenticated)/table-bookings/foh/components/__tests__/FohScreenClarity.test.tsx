// The parts of the floor screen added for clarity (owner decisions, 22 November 2026): the "last
// updated" line and its stale warning, the name search, today's no-shows, the party size stepper,
// the timeline markers, and the header's Add booking and Food Order.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FohBooking, FohScheduleResponse } from '../../types'
import { FohFreshness } from '../FohFreshness'
import { FohBookingSearch } from '../FohBookingSearch'
import { FohNoShowList } from '../FohNoShowList'
import { FohPartySizeStepper } from '../FohPartySizeStepper'
import { FohHeader } from '../FohHeader'
import { BookingBlockContent, BookingMarkers } from '../FohTimeline'
import { getFohPanelActions, isFohScheduleStale, searchFohBookings } from '../../utils'

function booking(overrides: Partial<FohBooking> = {}): FohBooking {
  return {
    id: 'booking-1',
    booking_reference: 'TB-0001',
    guest_name: 'Jo Bloggs',
    booking_time: '19:00',
    party_size: 4,
    booking_type: 'regular',
    booking_purpose: 'food',
    status: 'confirmed',
    notes: null,
    start_datetime: '2026-11-21T19:00:00.000Z',
    end_datetime: '2026-11-21T21:00:00.000Z',
    ...overrides,
  }
}

function schedule(overrides: Partial<NonNullable<FohScheduleResponse['data']>> = {}): NonNullable<FohScheduleResponse['data']> {
  return {
    date: '2026-11-21',
    service_window: { start_time: '12:00', end_time: '23:00', end_next_day: false, source: 'test' },
    lanes: [
      { table_id: 'table-1', table_name: 'Table 1', capacity: 4, area: 'Bar', bookings: [booking()] },
      {
        table_id: 'table-2',
        table_name: 'Table 2',
        capacity: 6,
        area: 'Bar',
        // Joined across two tables: found once.
        bookings: [booking(), booking({ id: 'booking-2', guest_name: 'Sam Carter', booking_reference: 'TB-0002', booking_time: '18:00' })],
      },
    ],
    unassigned_bookings: [booking({ id: 'booking-3', guest_name: 'Joanna Hill', booking_reference: 'TB-0003', booking_time: '20:00' })],
    no_show_bookings: [booking({ id: 'booking-4', guest_name: 'Nora Late', booking_reference: 'TB-0004', status: 'no_show', booking_time: '17:00' })],
    ...overrides,
  }
}

describe('the screen says how fresh it is', () => {
  const updated = new Date('2026-11-21T19:42:00.000Z')

  it('shows when it was last updated, in 12 hour time', () => {
    render(<FohFreshness lastUpdatedAt={updated} now={new Date('2026-11-21T19:43:00.000Z')} refreshing={false} onRefresh={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('Last updated 7:42pm')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('warns, with Refresh now, once the last refresh is more than two minutes old', async () => {
    const onRefresh = vi.fn()
    render(<FohFreshness lastUpdatedAt={updated} now={new Date('2026-11-21T19:45:00.000Z')} refreshing={false} onRefresh={onRefresh} />)

    const warning = screen.getByRole('alert')
    expect(warning).toHaveTextContent('This screen may be out of date')
    expect(warning).toHaveTextContent('Last updated 7:42pm')

    await userEvent.click(within(warning).getByRole('button', { name: 'Refresh now' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not warn at exactly two minutes, or before the first load', () => {
    expect(isFohScheduleStale(updated, new Date('2026-11-21T19:44:00.000Z'))).toBe(false)
    expect(isFohScheduleStale(updated, new Date('2026-11-21T19:44:01.000Z'))).toBe(true)
    expect(isFohScheduleStale(null, new Date('2026-11-21T19:44:01.000Z'))).toBe(false)
  })

  it('shows the refresh as working while it runs', () => {
    render(<FohFreshness lastUpdatedAt={updated} now={new Date('2026-11-21T19:50:00.000Z')} refreshing onRefresh={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Refreshing...' })).toBeDisabled()
  })
})

describe('finding a booking by name or reference', () => {
  it('matches the guest name or the reference, whatever the case, once per booking', () => {
    expect(searchFohBookings(schedule(), 'jo').map((result) => result.booking.id)).toEqual(['booking-1', 'booking-3'])
    expect(searchFohBookings(schedule(), 'tb-0002').map((result) => result.booking.id)).toEqual(['booking-2'])
    expect(searchFohBookings(schedule(), '  ')).toEqual([])
    expect(searchFohBookings(null, 'jo')).toEqual([])
  })

  it('includes a no-show, so a late guest can be found and put back', () => {
    expect(searchFohBookings(schedule(), 'nora').map((result) => result.booking.id)).toEqual(['booking-4'])
  })

  it('lists what it finds and opens the one tapped, on the table it sits on', async () => {
    const onOpen = vi.fn()
    render(<FohBookingSearch schedule={schedule()} onOpen={onOpen} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Find a booking by name or reference' }), 'carter')

    const found = screen.getByRole('region', { name: 'Bookings found' })
    expect(within(found).getByText('Sam Carter')).toBeInTheDocument()
    expect(within(found).getByText(/6pm · 4 people · Booked · Table 2 · TB-0002/)).toBeInTheDocument()

    await userEvent.click(within(found).getByRole('button', { name: /Sam Carter/ }))

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ laneTableId: 'table-2', laneTableName: 'Table 2' }))
    expect(screen.queryByRole('region', { name: 'Bookings found' })).toBeNull()
  })

  it('says when nothing matches', async () => {
    render(<FohBookingSearch schedule={schedule()} onOpen={vi.fn()} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Find a booking by name or reference' }), 'zzz')

    expect(screen.getByText('No booking with that name or reference on this day.')).toBeInTheDocument()
  })
})

describe("today's no-shows", () => {
  it('lists them greyed with Undo no-show', async () => {
    const onUndo = vi.fn()
    const noShow = booking({ id: 'booking-4', guest_name: 'Nora Late', status: 'no_show', booking_time: '17:00' })
    render(<FohNoShowList bookings={[noShow]} canEdit busyBookingId={null} styleVariant="manager_kiosk" onUndo={onUndo} />)

    const list = screen.getByRole('region', { name: 'No-shows today' })
    expect(list).toHaveTextContent('Nora Late · 4 people · 5pm · No-show')

    await userEvent.click(within(list).getByRole('button', { name: 'Undo no-show' }))
    expect(onUndo).toHaveBeenCalledWith(noShow)
  })

  it('shows nothing when there are none, and no undo without edit permission', () => {
    const { container, rerender } = render(
      <FohNoShowList bookings={[]} canEdit busyBookingId={null} styleVariant="default" onUndo={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()

    rerender(<FohNoShowList bookings={[booking({ status: 'no_show' })]} canEdit={false} busyBookingId={null} styleVariant="default" onUndo={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Undo no-show' })).toBeNull()
  })
})

describe('party size with plus and minus', () => {
  function Harness({ initial }: { initial: string }) {
    const [value, setValue] = React.useState(initial)
    return <FohPartySizeStepper label="Party size" value={value} onChange={setValue} min={1} max={50} />
  }

  it('steps by one each way and can still be typed', async () => {
    render(<Harness initial="2" />)
    const input = screen.getByLabelText('Party size')

    await userEvent.click(screen.getByRole('button', { name: 'One more: party size' }))
    await userEvent.click(screen.getByRole('button', { name: 'One more: party size' }))
    expect(input).toHaveValue(4)

    await userEvent.click(screen.getByRole('button', { name: 'One fewer: party size' }))
    expect(input).toHaveValue(3)

    fireEvent.change(input, { target: { value: '12' } })
    expect(input).toHaveValue(12)
  })

  it('never goes below one or above the most allowed', () => {
    const { unmount } = render(<Harness initial="1" />)
    expect(screen.getByRole('button', { name: 'One fewer: party size' })).toBeDisabled()
    unmount()

    render(<Harness initial="50" />)
    expect(screen.getByRole('button', { name: 'One more: party size' })).toBeDisabled()
  })

  it('starts from one when the box is empty', async () => {
    render(<Harness initial="" />)

    await userEvent.click(screen.getByRole('button', { name: 'One more: party size' }))

    expect(screen.getByLabelText('Party size')).toHaveValue(1)
  })
})

describe('timeline markers', () => {
  it('marks a deposit that is paid, a Christmas booking and an allergy, in words', () => {
    render(
      <BookingMarkers
        booking={booking({ booking_type: 'christmas', party_size: 6, payment_status: 'completed', allergies: ['peanuts'] })}
      />
    )

    expect(screen.getByText('Allergy')).toBeInTheDocument()
    expect(screen.getByTitle('Deposit paid')).toHaveTextContent('£ paid')
    expect(screen.getByTitle('Christmas booking')).toHaveTextContent('Xmas')
    expect(screen.queryByTitle('Deposit owed')).toBeNull()
  })

  it('marks a deposit that is owed', () => {
    render(<BookingMarkers booking={booking({ party_size: 16, status: 'pending_payment', payment_status: 'pending' })} />)

    expect(screen.getByTitle('Deposit owed')).toHaveTextContent('£ owed')
    expect(screen.queryByTitle('Deposit paid')).toBeNull()
  })

  it('puts the allergy first, so it survives a narrow block', () => {
    const { container } = render(
      <BookingMarkers booking={booking({ booking_type: 'christmas', party_size: 6, payment_status: 'completed', allergies: ['peanuts'], high_chair_count: 1 })} />
    )

    const labels = Array.from(container.querySelectorAll('span > span')).map((node) => node.textContent)
    expect(labels[0]).toBe('Allergy')
    expect(labels.indexOf('£ paid')).toBeLessThan(labels.indexOf('Xmas'))
  })

  it('shows nothing for an ordinary booking', () => {
    const { container } = render(<BookingMarkers booking={booking()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('what the panel offers, worked out from the booking', () => {
  const before = new Date('2026-11-21T18:00:00.000Z')
  const after = new Date('2026-11-21T19:30:00.000Z')

  it('follows the booking through its states', () => {
    expect(getFohPanelActions(booking(), before)).toMatchObject({ primary: 'seated', canNoShow: false })
    expect(getFohPanelActions(booking(), after)).toMatchObject({ primary: 'seated', canNoShow: true })
    expect(getFohPanelActions(booking({ seated_at: '2026-11-21T18:50:00.000Z' }), before)).toMatchObject({ primary: 'left', canNoShow: false })
    expect(getFohPanelActions(booking({ seated_at: 'x', left_at: 'y' }), after)).toMatchObject({ primary: null, canReseat: true })
    expect(getFohPanelActions(booking({ status: 'no_show' }), after)).toMatchObject({ primary: 'undo_no_show' })
    expect(getFohPanelActions(booking({ status: 'cancelled' }), after)).toMatchObject({ primary: null, canReseat: false, canNoShow: false })
  })
})

describe('the header', () => {
  function renderHeader(overrides: Partial<React.ComponentProps<typeof FohHeader>> = {}) {
    const props: React.ComponentProps<typeof FohHeader> = {
      date: '2026-11-28',
      setDate: vi.fn(),
      canEdit: true,
      styleVariant: 'manager_kiosk',
      clockNow: new Date('2026-11-21T19:00:00.000Z'),
      serviceDateNow: '2026-11-21',
      totals: { bookings: 3, covers: 12 },
      viewMode: 'inside',
      outsideCount: 0,
      onViewModeChange: vi.fn(),
      nextUpcomingEvent: null,
      upcomingEventsLoaded: true,
      submittingFoodOrderAlert: false,
      statusMessage: null,
      errorMessage: null,
      lastInteractionAtMsRef: { current: 0 },
      onSendFoodOrderAlert: vi.fn(),
      onOpenCreateModal: vi.fn(),
      ...overrides,
    }
    render(<FohHeader {...props} />)
    return props
  }

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('keeps the date being viewed when adding a booking', async () => {
    const props = renderHeader()

    await userEvent.click(screen.getByRole('button', { name: 'Add booking' }))

    expect(props.onOpenCreateModal).toHaveBeenCalledWith({ mode: 'booking' })
    expect(props.setDate).not.toHaveBeenCalled()
  })

  it('goes back to today for a walk-in', async () => {
    const props = renderHeader()

    await userEvent.click(screen.getByRole('button', { name: 'Walk-in' }))

    expect(props.setDate).toHaveBeenCalledWith('2026-11-21')
    expect(props.onOpenCreateModal).toHaveBeenCalledWith({ mode: 'walk_in' })
  })

  it('asks before texting the kitchen, and sends only on the second tap', async () => {
    const props = renderHeader()

    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Food order: text the kitchen' }))
    expect(props.onSendFoodOrderAlert).not.toHaveBeenCalled()

    const question = screen.getByRole('group', { name: 'Text the kitchen?' })
    await userEvent.click(within(question).getByRole('button', { name: 'Send' }))

    expect(props.onSendFoodOrderAlert).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('group', { name: 'Text the kitchen?' })).toBeNull()
  })

  it('sends nothing when the question is cancelled or left alone', async () => {
    const props = renderHeader()

    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Food order: text the kitchen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Text the kitchen?' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Food order: text the kitchen' }))
    expect(screen.getByRole('group', { name: 'Text the kitchen?' })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(8000) })

    expect(screen.queryByRole('group', { name: 'Text the kitchen?' })).toBeNull()
    expect(props.onSendFoodOrderAlert).not.toHaveBeenCalled()
  })

  it('names the day being viewed in words', () => {
    renderHeader()

    expect(screen.getByText('Saturday 28 November')).toBeInTheDocument()
  })

  // Owner review, 22 November 2026: one compact toolbar, so the tables start higher up.
  it('keeps the everyday controls on the toolbar and the rare ones behind More', async () => {
    renderHeader({
      canManageSettings: true,
      nextUpcomingEvent: { id: 'event-1', name: 'Quiz Night', date: '2026-11-25', time: '19:30', start_datetime: null },
    })

    for (const name of ['Previous day', 'Next day', 'Today', 'Walk-in', 'Add booking', 'More']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // Not on the toolbar itself.
    expect(screen.queryByRole('link', { name: 'Checklists' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Food order: text the kitchen' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'More' }))

    const menu = await screen.findByRole('dialog', { name: 'More' })
    expect(within(menu).getByRole('link', { name: 'Checklists' })).toHaveAttribute('href', '/checklists')
    expect(within(menu).getByRole('link', { name: 'Vouchers' })).toHaveAttribute('href', '/vouchers/foh')
    expect(within(menu).getByRole('link', { name: 'Table Setup' })).toHaveAttribute('href', '/settings/table-bookings')
    expect(within(menu).getByRole('button', { name: 'Book guests for Quiz Night' })).toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: 'Food order: text the kitchen' })).toBeInTheDocument()
  })

  it('books guests onto the next event from More', async () => {
    const props = renderHeader({
      nextUpcomingEvent: { id: 'event-1', name: 'Quiz Night', date: '2026-11-25', time: '19:30', start_datetime: null },
    })

    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Book guests for Quiz Night' }))

    expect(props.onOpenCreateModal).toHaveBeenCalledWith({
      mode: 'booking',
      prefill: { booking_date: '2026-11-25', purpose: 'event', event_id: 'event-1' },
    })
  })

  it('leaves Table Setup out without settings access', async () => {
    renderHeader()

    await userEvent.click(screen.getByRole('button', { name: 'More' }))

    await screen.findByRole('link', { name: 'Checklists' })
    expect(screen.queryByRole('link', { name: 'Table Setup' })).toBeNull()
  })

  it('shows the counts, the hours and the next event as one line of plain text', () => {
    renderHeader({
      totals: { bookings: 3, covers: 12, privateHireGuests: 20 },
      openHoursLabel: 'Open 12pm to 10pm',
      nextUpcomingEvent: { id: 'event-1', name: 'Quiz Night', date: '2026-11-25', time: '19:30', start_datetime: null },
    })

    expect(screen.getByText('3 bookings · 12 covers · 20 private hire guests')).toBeInTheDocument()
    expect(screen.getByText('Open 12pm to 10pm')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Next event reminder' })).toHaveTextContent('Next event: Quiz Night · 4 Days Left to Book')
  })

  it('switches the timeline between Day and Now', async () => {
    const onTimelineZoomChange = vi.fn()
    renderHeader({ timelineZoom: 'day', onTimelineZoomChange })

    const zoom = screen.getByRole('group', { name: 'Timeline zoom' })
    expect(within(zoom).getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(zoom).getByRole('button', { name: 'Now' })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(within(zoom).getByRole('button', { name: 'Now' }))

    expect(onTimelineZoomChange).toHaveBeenCalledWith('now')
  })

  it('keeps every toolbar control at the 44px touch height', () => {
    renderHeader({ onTimelineZoomChange: vi.fn() })

    for (const name of ['Today', 'Walk-in', 'Add booking', 'More', 'Day', 'Now', 'Inside']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-touch')
    }
    for (const name of ['Previous day', 'Next day']) {
      expect(screen.getByRole('button', { name })).toHaveClass('size-11')
    }
  })
})

// Owner review, 22 November 2026: "You can't really read any of the names on the bookings."
describe('what a timeline block says', () => {
  it('puts the name first, then the party size', () => {
    const { container } = render(<BookingBlockContent booking={booking({ guest_name: 'Gareth Williams', party_size: 5 })} />)

    expect(container.firstElementChild).toHaveTextContent('Gareth Williams · 5')
    // The name may run onto a second line before it is cut.
    expect(container.firstElementChild).toHaveClass('line-clamp-2')
  })

  it('says the state in one short word beside a dot, with the markers on the same line', () => {
    const { container } = render(
      <BookingBlockContent booking={booking({ seated_at: '2026-11-21T19:05:00.000Z', allergies: ['peanuts'] })} />
    )

    const statusLine = container.children[1]
    expect(statusLine).toHaveTextContent('Seated')
    expect(statusLine).toHaveTextContent('Allergy')
    expect(statusLine).toHaveTextContent('7pm - 9pm')
    // The whole line is left off a block too narrow for it: name and size only.
    expect(statusLine).toHaveClass('hidden', '@min-[7rem]:flex')
  })

  it('uses short words for each state', () => {
    const word = (overrides: Partial<FohBooking>) => {
      const { container, unmount } = render(<BookingBlockContent booking={booking(overrides)} />)
      const text = container.children[1].textContent ?? ''
      unmount()
      return text
    }

    expect(word({})).toContain('Booked')
    expect(word({ seated_at: 'x', left_at: 'y' })).toContain('Left')
    expect(word({ status: 'no_show' })).toContain('No-show')
    expect(word({ status: 'pending_payment' })).toContain('Unpaid')
  })

  it('shows that the guest confirmed as a tick with a name, not a pill', () => {
    render(<BookingBlockContent booking={booking({ guest_confirmed_at: '2026-11-20T10:00:00.000Z' })} />)

    expect(screen.getByRole('img', { name: 'Confirmed by guest' })).toHaveTextContent('✓')
    expect(screen.queryByText(/Confirmed ✓/)).toBeNull()
  })

  it('names a private hire and leaves out the party size', () => {
    const { container } = render(
      <BookingBlockContent booking={booking({ is_private_block: true, status: 'private_block', guest_name: 'Smith party' })} />
    )

    expect(container.firstElementChild).toHaveTextContent(/^Smith party$/)
    expect(container.children[1]).toHaveTextContent('Private hire')
  })
})
