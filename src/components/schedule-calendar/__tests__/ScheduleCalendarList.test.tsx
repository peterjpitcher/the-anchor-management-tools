// src/components/schedule-calendar/__tests__/ScheduleCalendarList.test.tsx

import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { addDays, addMonths, format, subDays } from 'date-fns'
import { ScheduleCalendarList } from '../ScheduleCalendarList'
import type { CalendarEntry } from '../types'

function atNoon(date: Date): Date {
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  return d
}

function makeEntry(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  const start = overrides.start ?? atNoon(new Date())
  const end = overrides.end ?? new Date(start.getTime() + 60 * 60 * 1000)
  return {
    id: 'entry-1',
    kind: 'event',
    title: 'Test event',
    start,
    end,
    allDay: false,
    spansMultipleDays: false,
    endsNextDay: false,
    color: '#1E3A8A',
    subtitle: null,
    status: 'scheduled',
    statusLabel: null,
    onClickHref: null,
    tooltipData: {
      kind: 'event',
      name: 'Test event',
      time: '12:00',
      bookedSeats: 0,
      category: null,
      status: 'scheduled',
    },
    ...overrides,
  }
}

const yesterday = atNoon(subDays(new Date(), 1))
const tomorrow = atNoon(addDays(new Date(), 1))
const yesterdayLabel = format(yesterday, 'EEEE d MMMM')

describe('ScheduleCalendarList', () => {
  const pastAndFutureEntries = [
    makeEntry({ id: 'past', title: 'Past event', start: yesterday }),
    makeEntry({ id: 'future', title: 'Future event', start: tomorrow }),
  ]

  it('lists every day of a past month, with no Today card', () => {
    const lastMonth = addMonths(new Date(), -1)
    const day = atNoon(new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 10))
    render(
      <ScheduleCalendarList
        entries={[makeEntry({ id: 'old', title: 'Old event', start: day })]}
        month={new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1)}
      />
    )
    expect(screen.getByText('Old event')).toBeInTheDocument()
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('leaves out days of other months, including the spill-over of a multi-day entry', () => {
    const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const nextMonthDay = atNoon(addMonths(thisMonth, 1))
    render(
      <ScheduleCalendarList
        entries={[makeEntry({ id: 'next', title: 'Next month event', start: nextMonthDay })]}
        month={thisMonth}
      />
    )
    expect(screen.queryByText('Next month event')).not.toBeInTheDocument()
  })

  it('opens the current month on today, with earlier days behind a button that shows them', () => {
    const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const entries = [makeEntry({ id: 'future', title: 'Future event', start: tomorrow })]
    // Only add the earlier entry when yesterday is in this month (not on the 1st).
    if (yesterday.getMonth() === thisMonth.getMonth()) {
      entries.push(makeEntry({ id: 'past', title: 'Past event', start: yesterday }))
    }
    render(<ScheduleCalendarList entries={entries} month={thisMonth} />)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('No entries today')).toBeInTheDocument()
    if (yesterday.getMonth() === thisMonth.getMonth()) {
      expect(screen.queryByText('Past event')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Show earlier days this month \(1 item\)/ }))
      expect(screen.getByText(yesterdayLabel)).toBeInTheDocument()
      expect(screen.getByText('Past event')).toBeInTheDocument()
    }
  })

  it('says so when a month has nothing on it', () => {
    const lastYear = new Date(new Date().getFullYear() - 1, 0, 1)
    render(<ScheduleCalendarList entries={[]} month={lastYear} />)
    expect(screen.getByText(`Nothing on the calendar in ${format(lastYear, 'MMMM yyyy')}`)).toBeInTheDocument()
  })

  it('shows an icon-backed item type label as well as the colour', () => {
    render(<ScheduleCalendarList entries={[makeEntry({ title: 'Accessible event' })]} />)
    expect(screen.getByText('Event')).toBeInTheDocument()
    expect(screen.getByText('Accessible event').closest('[data-entry-kind]')).toHaveAttribute('data-entry-kind', 'event')
  })

  it('shows cancelled items as white with a black border', () => {
    render(
      <ScheduleCalendarList
        entries={[makeEntry({ title: 'Cancelled event', status: 'cancelled', statusLabel: 'Cancelled' })]}
      />
    )
    const row = screen.getByText('Cancelled event').closest('[data-entry-kind]')
    expect(row).toHaveStyle({ backgroundColor: '#FFFFFF', borderColor: '#111827' })
  })
})
