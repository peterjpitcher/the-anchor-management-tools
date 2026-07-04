// src/components/schedule-calendar/__tests__/ScheduleCalendarList.test.tsx

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { addDays, format, subDays } from 'date-fns'
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
    color: '#22c55e',
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
const tomorrowLabel = format(tomorrow, 'EEEE d MMMM')

type ScrollIntoView = typeof Element.prototype.scrollIntoView
let scrollSpy: ReturnType<typeof vi.fn<ScrollIntoView>>

beforeEach(() => {
  // jsdom does not implement scrollIntoView
  scrollSpy = vi.fn<ScrollIntoView>()
  Element.prototype.scrollIntoView = scrollSpy
  // Run the component's requestAnimationFrame callback synchronously
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ScheduleCalendarList', () => {
  const pastAndFutureEntries = [
    makeEntry({ id: 'past', title: 'Past event', start: yesterday }),
    makeEntry({ id: 'future', title: 'Future event', start: tomorrow }),
  ]

  it('should render past date groups when hidePast is not set', () => {
    render(<ScheduleCalendarList entries={pastAndFutureEntries} />)
    expect(screen.getByText(yesterdayLabel)).toBeInTheDocument()
    expect(screen.getByText('Past event')).toBeInTheDocument()
    expect(screen.getByText(tomorrowLabel)).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('should hide pre-today date groups when hidePast is true', () => {
    render(<ScheduleCalendarList entries={pastAndFutureEntries} hidePast />)
    expect(screen.queryByText(yesterdayLabel)).not.toBeInTheDocument()
    expect(screen.queryByText('Past event')).not.toBeInTheDocument()
    expect(screen.getByText(tomorrowLabel)).toBeInTheDocument()
    expect(screen.getByText('Future event')).toBeInTheDocument()
  })

  it('should keep the Today group header and empty state when hidePast is true and today has no entries', () => {
    render(<ScheduleCalendarList entries={pastAndFutureEntries} hidePast />)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('No entries today.')).toBeInTheDocument()
  })

  it('should keep entries dated today when hidePast is true', () => {
    const entries = [
      makeEntry({ id: 'past', title: 'Past event', start: yesterday }),
      makeEntry({ id: 'today', title: 'Today event', start: atNoon(new Date()) }),
    ]
    render(<ScheduleCalendarList entries={entries} hidePast />)
    expect(screen.getByText('Today event')).toBeInTheDocument()
    expect(screen.queryByText('Past event')).not.toBeInTheDocument()
  })

  it('should scroll the Today group into view when hidePast is false', () => {
    render(<ScheduleCalendarList entries={pastAndFutureEntries} />)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('should not scroll when hidePast is true', () => {
    render(<ScheduleCalendarList entries={pastAndFutureEntries} hidePast />)
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})
