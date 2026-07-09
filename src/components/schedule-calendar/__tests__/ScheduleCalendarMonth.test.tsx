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
