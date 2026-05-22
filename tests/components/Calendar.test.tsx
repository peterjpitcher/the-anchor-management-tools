import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScheduleCalendarMonth } from '@/components/schedule-calendar/ScheduleCalendarMonth'
import type { CalendarEntry } from '@/components/schedule-calendar/types'

function entry(overrides: Partial<CalendarEntry>): CalendarEntry {
  const start = overrides.start ?? new Date(2026, 1, 7, 19, 0, 0, 0)
  const end = overrides.end ?? new Date(2026, 1, 7, 21, 0, 0, 0)

  return {
    id: 'evt-1',
    kind: 'event',
    title: 'Event',
    start,
    end,
    allDay: false,
    spansMultipleDays: false,
    endsNextDay: false,
    color: '#22c55e',
    subtitle: null,
    status: 'scheduled',
    statusLabel: null,
    tooltipData: {
      kind: 'event',
      name: 'Event',
      time: '19:00',
      bookedSeats: 0,
      category: null,
      status: 'scheduled',
    },
    onClickHref: null,
    ...overrides,
  }
}

describe('Calendar', () => {
  it('does not show a timed event on the next day when it ends at midnight', () => {
    const start = new Date(2026, 1, 7, 19, 0, 0, 0)
    const end = new Date(2026, 1, 8, 0, 0, 0, 0)

    render(
      <ScheduleCalendarMonth
        anchor={start}
        firstDayOfWeek={1}
        entries={[entry({ title: 'Ends at midnight', start, end })]}
      />,
    )

    expect(screen.getAllByText('Ends at midnight')).toHaveLength(1)
  })

  it('can force a timed event to only show on its start day in month view', () => {
    const start = new Date(2026, 1, 7, 19, 0, 0, 0)
    const end = new Date(2026, 1, 8, 1, 0, 0, 0)

    render(
      <ScheduleCalendarMonth
        anchor={start}
        firstDayOfWeek={1}
        entries={[entry({ id: 'evt-2', title: 'Private booking', start, end })]}
      />,
    )

    expect(screen.getAllByText('Private booking')).toHaveLength(1)
  })
})
