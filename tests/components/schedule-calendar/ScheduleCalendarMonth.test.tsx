import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScheduleCalendarMonth } from '@/components/schedule-calendar/ScheduleCalendarMonth'
import type { CalendarEntry } from '@/components/schedule-calendar/types'

const makeEntry = (overrides: Partial<CalendarEntry>): CalendarEntry => ({
    id: 'evt:a',
    kind: 'event',
    title: 'Event',
    start: new Date(2026, 3, 25, 19),
    end: new Date(2026, 3, 25, 21),
    allDay: false,
    spansMultipleDays: false,
    endsNextDay: false,
    color: '#22c55e',
    subtitle: '22 booked',
    status: 'scheduled',
    statusLabel: null,
    tooltipData: {
        kind: 'event',
        name: 'Event',
        time: '19:00',
        bookedSeats: 22,
        category: null,
        status: 'scheduled',
    },
    onClickHref: '/events/a',
    ...overrides,
})

describe('ScheduleCalendarMonth', () => {
    it('renders full titles on busy days without truncation', () => {
        const entries: CalendarEntry[] = [
            makeEntry({
                id: 'evt:1',
                title: '20:00 Open Mic Night with Nikki Manfredi',
                start: new Date(2026, 3, 25, 20),
                end: new Date(2026, 3, 25, 22),
            }),
            makeEntry({
                id: 'pb:1',
                kind: 'private_booking',
                title: 'Dawson 50th Birthday',
                color: '#8b5cf6',
                start: new Date(2026, 3, 25, 13),
                end: new Date(2026, 3, 25, 17),
                subtitle: '40 guests',
            }),
            makeEntry({
                id: 'pb:2',
                kind: 'private_booking',
                title: 'Raj and Priya Wedding Reception',
                color: '#8b5cf6',
                start: new Date(2026, 3, 25, 14),
                end: new Date(2026, 3, 26, 0),
                endsNextDay: true,
                subtitle: '120 guests',
            }),
        ]
        const { container } = render(
            <ScheduleCalendarMonth
                entries={entries}
                anchor={new Date(2026, 3, 17)}
                firstDayOfWeek={1}
            />
        )

        // No title element should carry truncate/text-ellipsis classes — this is the regression guard
        const titles = container.querySelectorAll('[data-entry-title]')
        titles.forEach((el) => {
            expect(el.className).not.toMatch(/truncate|text-ellipsis/)
        })

        // Full title text is present
        expect(screen.getByText(/Open Mic Night with Nikki Manfredi/)).toBeInTheDocument()
        expect(screen.getByText(/Raj and Priya Wedding Reception/)).toBeInTheDocument()
    })

    it('renders multi-day notes as a single bar not per-day repeats', () => {
        const entries: CalendarEntry[] = [
            makeEntry({
                id: 'note:1',
                kind: 'calendar_note',
                title: 'Pete & Bill On Holiday',
                start: new Date(2026, 3, 20),
                end: new Date(2026, 3, 26),
                allDay: true,
                spansMultipleDays: true,
                color: '#0ea5e9',
                subtitle: null,
                status: null,
                statusLabel: null,
                tooltipData: {
                    kind: 'calendar_note',
                    title: 'Pete & Bill On Holiday',
                    dateRange: '',
                    notes: null,
                    source: 'manual',
                },
                onClickHref: null,
            }),
        ]
        render(
            <ScheduleCalendarMonth
                entries={entries}
                anchor={new Date(2026, 3, 17)}
                firstDayOfWeek={1}
            />
        )
        // The title should appear exactly once in the month render
        const matches = screen.getAllByText('Pete & Bill On Holiday')
        expect(matches).toHaveLength(1)
    })

    it('renders cancelled entries with strikethrough class', () => {
        const entries: CalendarEntry[] = [
            makeEntry({
                id: 'evt:x',
                title: 'Cancelled Event',
                status: 'cancelled',
                statusLabel: 'Cancelled',
            }),
        ]
        const { container } = render(
            <ScheduleCalendarMonth
                entries={entries}
                anchor={new Date(2026, 3, 17)}
                firstDayOfWeek={1}
            />
        )
        const titleEl = container.querySelector('[data-entry-title]')
        expect(titleEl?.className).toMatch(/line-through/)
    })
})
