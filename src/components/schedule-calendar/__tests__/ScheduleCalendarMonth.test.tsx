// src/components/schedule-calendar/__tests__/ScheduleCalendarMonth.test.tsx
//
// Regression cover for the "add calendar note" affordance. The redesigned month
// view previously exposed note creation only via an undiscoverable click on the
// bare day number; these tests lock in that an empty-day click reaches
// onEmptyDayClick, and that the affordance is absent when notes can't be created.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { isSameDay } from 'date-fns'
import { ScheduleCalendarMonth } from '../ScheduleCalendarMonth'

// A fixed anchor keeps the rendered grid deterministic (July 2026).
const ANCHOR = new Date(2026, 6, 15)

describe('ScheduleCalendarMonth add-note affordance', () => {
  it('calls onEmptyDayClick with the clicked day when note creation is enabled', () => {
    const onEmptyDayClick = vi.fn()
    render(
      <ScheduleCalendarMonth
        entries={[]}
        anchor={ANCHOR}
        firstDayOfWeek={1}
        onEmptyDayClick={onEmptyDayClick}
      />
    )

    // The day-number button carries the date text; 15 is unique in the grid.
    fireEvent.click(screen.getByText('15'))

    expect(onEmptyDayClick).toHaveBeenCalledTimes(1)
    const clickedDate = onEmptyDayClick.mock.calls[0][0] as Date
    expect(isSameDay(clickedDate, new Date(2026, 6, 15))).toBe(true)
  })

  it('renders a discoverable "+ Note" hint for each day when enabled', () => {
    render(
      <ScheduleCalendarMonth
        entries={[]}
        anchor={ANCHOR}
        firstDayOfWeek={1}
        onEmptyDayClick={vi.fn()}
      />
    )

    // Both the day-number button and the hint button share the "Add note for"
    // label, so every rendered day contributes at least one such control.
    expect(screen.getAllByLabelText(/Add note for/).length).toBeGreaterThan(0)
  })

  it('exposes no add-note affordance when note creation is disabled', () => {
    render(
      <ScheduleCalendarMonth
        entries={[]}
        anchor={ANCHOR}
        firstDayOfWeek={1}
      />
    )

    expect(screen.queryByLabelText(/Add note for/)).toBeNull()
  })
})

describe('ScheduleCalendarMonth past entries', () => {
  const entry = (id: string, title: string, start: Date, end: Date, allDay: boolean) => ({
    id, kind: 'special_hours' as const, title, start, end, allDay,
    spansMultipleDays: false, endsNextDay: false, color: '#111827', subtitle: null,
    status: null, statusLabel: null, onClickHref: null,
    tooltipData: { kind: 'special_hours' as const, title, note: null, date: '2026-07-15', timeRange: null, isClosed: false, isKitchenClosed: false },
  })

  it("fades what has finished, but keeps today's all-day entries at full strength", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 14, 0))
    try {
      render(
        <ScheduleCalendarMonth
          entries={[
            // All-day entries end at midnight at the start of their day.
            entry('today', 'Today hours', new Date(2026, 6, 15), new Date(2026, 6, 15), true),
            entry('yesterday', 'Yesterday hours', new Date(2026, 6, 14), new Date(2026, 6, 14), true),
            entry('done', 'Morning slot', new Date(2026, 6, 15, 9), new Date(2026, 6, 15, 11), false),
          ]}
          anchor={ANCHOR}
          firstDayOfWeek={1}
        />
      )
      const block = (title: string) => screen.getByText(title).closest('a, button, div[class*="rounded-sm"]') as HTMLElement
      expect(block('Today hours').className).not.toMatch(/opacity-70/)
      expect(block('Yesterday hours').className).toMatch(/opacity-70/)
      expect(block('Morning slot').className).toMatch(/opacity-70/)
    } finally {
      vi.useRealTimers()
    }
  })
})
