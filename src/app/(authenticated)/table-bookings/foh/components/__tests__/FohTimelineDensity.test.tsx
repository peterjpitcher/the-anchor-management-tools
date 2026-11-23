// The timeline after the owner's review of 22 November 2026: a narrow table column so the hours
// get the width, blocks that always have room for a name, an hour row no block can cover, a Now
// label that never sits on an hour label, and a Day or Now zoom.

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { FohBooking, FohScheduleResponse, TimelineRange } from '../../types'
import { FohTimeline } from '../FohTimeline'

// 12pm to 10pm, hourly ticks.
const timeline: TimelineRange = {
  startMin: 12 * 60,
  endMin: 22 * 60,
  ticks: Array.from({ length: 11 }, (_, index) => (12 + index) * 60),
}

function booking(overrides: Partial<FohBooking> = {}): FohBooking {
  return {
    id: 'booking-1',
    booking_reference: 'TB-0001',
    guest_name: 'Gareth Williams',
    booking_time: '19:00',
    party_size: 5,
    booking_type: 'regular',
    booking_purpose: 'food',
    status: 'confirmed',
    notes: null,
    // 21 November 2026 is in GMT, so these are also the London times.
    start_datetime: '2026-11-21T19:00:00.000Z',
    end_datetime: '2026-11-21T21:00:00.000Z',
    ...overrides,
  }
}

function schedule(bookings: FohBooking[]): NonNullable<FohScheduleResponse['data']> {
  return {
    date: '2026-11-21',
    service_window: { start_time: '12:00', end_time: '22:00', end_next_day: false, source: 'test' },
    lanes: [
      { table_id: 'table-1', table_name: 'Big Bay', table_number: '2', capacity: 6, area: 'Main Bar', bookings },
      { table_id: 'table-2', table_name: 'Snug', table_number: '3', capacity: 4, area: 'Main Bar', bookings: [] },
    ],
    unassigned_bookings: [],
  }
}

function renderTimeline(options: { bookings?: FohBooking[]; nowPct?: number | null; zoom?: 'day' | 'now'; onBookingClick?: () => void } = {}) {
  return render(
    <FohTimeline
      schedule={schedule(options.bookings ?? [booking()])}
      date="2026-11-21"
      timeline={timeline}
      canEdit
      loading={false}
      styleVariant="manager_kiosk"
      currentTimelineLeftPct={options.nowPct ?? null}
      zoom={options.zoom}
      sensors={[]}
      activeDragData={null}
      pointerPosition={null}
      liveSnapTime={null}
      isOutOfBounds={false}
      pendingMove={null}
      isSubmitting={false}
      confirmError={null}
      timelineRef={React.createRef<HTMLDivElement>()}
      onDragStart={vi.fn()}
      onDragMove={vi.fn()}
      onDragEnd={vi.fn()}
      onConfirmMove={vi.fn(async () => {})}
      onCancelMove={vi.fn()}
      onBookingClick={options.onBookingClick ?? vi.fn()}
      onLaneClick={vi.fn()}
    />
  )
}

const block = () => screen.getByTitle(/Gareth Williams · TB-0001/)

describe('the table column', () => {
  it('shows the table name and its seats, and nothing else', () => {
    renderTimeline()

    const label = screen.getByTitle('Big Bay · table 2 · 6 seats · Main Bar')
    expect(within(label).getByText('Big Bay')).toBeInTheDocument()
    expect(within(label).getByText('6 seats')).toBeInTheDocument()
    expect(label).not.toHaveTextContent('Main Bar')
    expect(label).not.toHaveTextContent('(2)')
  })

  it('is 160px wide, so the hours get the rest', () => {
    renderTimeline()

    expect(screen.getByTitle('Big Bay · table 2 · 6 seats · Main Bar').parentElement).toHaveClass('grid-cols-[160px_minmax(0,1fr)]')
  })
})

describe('booking blocks', () => {
  it('lead with the name and party size, and carry the full detail in the title', () => {
    renderTimeline()

    expect(block()).toHaveTextContent(/^Gareth Williams · 5/)
    expect(block()).toHaveAttribute('title', 'Gareth Williams · TB-0001 · 5 people · Booked · 7pm - 9pm')
  })

  it('keep room for a name even when the sitting was cut short', () => {
    // Marked as left ten minutes in: the sitting itself is a sliver.
    renderTimeline({
      bookings: [booking({ seated_at: '2026-11-21T19:00:00.000Z', left_at: '2026-11-21T19:10:00.000Z', end_datetime: '2026-11-21T19:10:00.000Z' })],
    })

    expect(block().style.minWidth).toBe('6rem')
    expect(block()).toHaveTextContent(/^Gareth Williams · 5/)
  })

  it('open the booking on a tap', () => {
    const onBookingClick = vi.fn()
    renderTimeline({ onBookingClick })

    block().click()

    expect(onBookingClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'booking-1' }), 'table-1', 'Big Bay')
  })
})

describe('the hour row', () => {
  it('labels each hour in 12 hour time', () => {
    renderTimeline()

    for (const label of ['12pm', '3pm', '4pm', '8pm', '10pm']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('is its own band above the lanes, so a block cannot cover a label', () => {
    renderTimeline()

    const hourRow = screen.getByText('3pm').closest('.grid')
    expect(hourRow).toHaveClass('z-20', 'bg-surface-2')
    // No booking block lives inside it.
    expect(hourRow?.contains(block())).toBe(false)
  })

  it('leaves out the hour label the Now label would sit on', () => {
    // 8:05pm: 485 of the 600 minutes shown.
    renderTimeline({ nowPct: (485 / 600) * 100 })

    expect(screen.getByText('Now')).toBeInTheDocument()
    expect(screen.queryByText('8pm')).toBeNull()
    expect(screen.getByText('7pm')).toBeInTheDocument()
    expect(screen.getByText('9pm')).toBeInTheDocument()
  })

  it('keeps every hour label when Now is clear of them', () => {
    // 8:45pm sits between 8pm and 9pm.
    renderTimeline({ nowPct: (525 / 600) * 100 })

    expect(screen.getByText('8pm')).toBeInTheDocument()
    expect(screen.getByText('9pm')).toBeInTheDocument()
  })
})

describe('Day and Now', () => {
  const inner = (container: HTMLElement) => container.querySelector('.overflow-x-auto > div') as HTMLElement

  it('draws the whole day across the width on Day', () => {
    const { container } = renderTimeline({ zoom: 'day', nowPct: 50 })

    expect(inner(container).style.width).toBe('')
  })

  it('draws about five hours across the width on Now, with the rest a scroll away', () => {
    const { container } = renderTimeline({ zoom: 'now', nowPct: 50 })

    // Ten hours shown, five across the screen: the track is twice as wide as the view.
    expect(inner(container).style.width).toMatch(/^calc\(160px \+ 2 \* \(100% - 160px\)\)$/)
  })

  it('keeps the Now line in the middle of the view on Now, and leaves Day alone', () => {
    // jsdom has no layout: a 920px view of an 1840px track, plus the 160px table column.
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2000)
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1080)
    try {
      const now = renderTimeline({ zoom: 'now', nowPct: 40 })
      // 40% of 1840px is 736px along; half the 920px view back from that.
      expect((now.container.querySelector('.overflow-x-auto') as HTMLElement).scrollLeft).toBe(276)
      now.unmount()

      const day = renderTimeline({ zoom: 'day', nowPct: 40 })
      expect((day.container.querySelector('.overflow-x-auto') as HTMLElement).scrollLeft).toBe(0)
    } finally {
      scrollWidth.mockRestore()
      clientWidth.mockRestore()
    }
  })
})
