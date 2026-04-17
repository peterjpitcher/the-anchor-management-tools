// tests/components/schedule-calendar/ScheduleCalendarWeek.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScheduleCalendarWeek } from '@/components/schedule-calendar/ScheduleCalendarWeek'
import type { CalendarEntry } from '@/components/schedule-calendar/types'

const base = (o: Partial<CalendarEntry>): CalendarEntry => ({
    id: 'e1', kind: 'event', title: 't',
    start: new Date(2026, 3, 24, 19), end: new Date(2026, 3, 24, 21),
    allDay: false, spansMultipleDays: false, endsNextDay: false,
    color: '#22c55e', subtitle: null, status: 'scheduled', statusLabel: null,
    tooltipData: { kind: 'event', name: 't', time: '19:00', bookedSeats: 0, category: null, status: 'scheduled' },
    onClickHref: null, ...o,
})

describe('ScheduleCalendarWeek', () => {
    it('renders hours 12-23 baseline', () => {
        render(<ScheduleCalendarWeek entries={[]} anchor={new Date(2026, 3, 24)} firstDayOfWeek={1} />)
        expect(screen.getByText('12:00')).toBeInTheDocument()
        expect(screen.getByText('23:00')).toBeInTheDocument()
        expect(screen.queryByText('03:00')).not.toBeInTheDocument()
    })

    it('extends start hour when an entry begins at 10:00', () => {
        const entries = [base({ start: new Date(2026, 3, 24, 10), end: new Date(2026, 3, 24, 12) })]
        render(<ScheduleCalendarWeek entries={entries} anchor={new Date(2026, 3, 24)} firstDayOfWeek={1} />)
        expect(screen.getByText('10:00')).toBeInTheDocument()
    })

    it('renders overnight booking on start day only with +1 day indicator', () => {
        const entries = [base({
            id: 'pb:1', kind: 'private_booking',
            title: 'Wedding Reception',
            start: new Date(2026, 3, 25, 20), end: new Date(2026, 3, 26, 1),
            endsNextDay: true, color: '#8b5cf6',
        })]
        render(<ScheduleCalendarWeek entries={entries} anchor={new Date(2026, 3, 20)} firstDayOfWeek={1} />)
        // Title appears exactly once (start day only)
        expect(screen.getAllByText(/Wedding Reception/)).toHaveLength(1)
        expect(screen.getByText('+1 day')).toBeInTheDocument()
    })
})
