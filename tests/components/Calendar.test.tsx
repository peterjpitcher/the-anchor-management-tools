import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Calendar } from '@/components/ui-v2/display/Calendar'

describe('Calendar', () => {
  it('does not show a timed event on the next day when it ends at midnight', () => {
    const start = new Date(2026, 1, 7, 19, 0, 0, 0)
    const end = new Date(2026, 1, 8, 0, 0, 0, 0)

    render(
      <Calendar
        value={start}
        view="month"
        showNavigation={false}
        showTodayButton={false}
        showViewSelector={false}
        showEventTime={false}
        selectable={false}
        events={[
          {
            id: 'evt-1',
            title: 'Ends at midnight',
            start,
            end,
          },
        ]}
      />,
    )

    expect(screen.getAllByText('Ends at midnight')).toHaveLength(1)
  })

  it('can force a timed event to only show on its start day in month view', () => {
    const start = new Date(2026, 1, 7, 19, 0, 0, 0)
    const end = new Date(2026, 1, 8, 1, 0, 0, 0)

    render(
      <Calendar
        value={start}
        view="month"
        showNavigation={false}
        showTodayButton={false}
        showViewSelector={false}
        showEventTime={false}
        selectable={false}
        events={[
          {
            id: 'evt-2',
            title: 'Private booking',
            start,
            end,
            showOnStartDayOnly: true,
          },
        ]}
      />,
    )

    expect(screen.getAllByText('Private booking')).toHaveLength(1)
  })
})

