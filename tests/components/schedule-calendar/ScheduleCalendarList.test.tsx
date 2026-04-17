// tests/components/schedule-calendar/ScheduleCalendarList.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScheduleCalendarList } from '@/components/schedule-calendar/ScheduleCalendarList'
import type { CalendarEntry } from '@/components/schedule-calendar/types'

function setFixedToday() {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 17, 12, 0)) // 17 Apr 2026
}

const e = (o: Partial<CalendarEntry>): CalendarEntry => ({
    id: 'x', kind: 'event', title: 't',
    start: new Date(2026, 3, 17, 19), end: new Date(2026, 3, 17, 21),
    allDay: false, spansMultipleDays: false, endsNextDay: false,
    color: '#22c55e', subtitle: '0 booked', status: 'scheduled', statusLabel: null,
    tooltipData: { kind: 'event', name: 't', time: '19:00', bookedSeats: 0, category: null, status: 'scheduled' },
    onClickHref: '/events/x', ...o,
})

describe('ScheduleCalendarList', () => {
    beforeEach(() => { setFixedToday() })

    it('groups entries by date with a Today header', () => {
        render(<ScheduleCalendarList entries={[e({ id: 'a' })]} />)
        expect(screen.getByRole('heading', { name: /Today/ })).toBeInTheDocument()
    })

    it('renders a synthetic Today header even when there are no entries today', () => {
        const entries = [e({ id: 'future', start: new Date(2026, 3, 24, 19) })]
        render(<ScheduleCalendarList entries={entries} />)
        expect(screen.getByRole('heading', { name: /Today/ })).toBeInTheDocument()
    })

    it('past entries carry muted-token class, not opacity-60', () => {
        const { container } = render(<ScheduleCalendarList entries={[e({ id: 'past', start: new Date(2026, 3, 10, 19), end: new Date(2026, 3, 10, 21) })]} />)
        const row = container.querySelector('[data-entry-row="past"]')
        expect(row).not.toBeNull()
        expect(row!.className).not.toMatch(/opacity-60/)
        expect(row!.className).toMatch(/text-muted-foreground/)
    })

    it('calls scrollIntoView on Today header on mount', () => {
        const scrollIntoView = vi.fn()
        Element.prototype.scrollIntoView = scrollIntoView
        render(<ScheduleCalendarList entries={[e({})]} />)
        // Component schedules the scroll via requestAnimationFrame; advance the
        // fake timers so the callback fires before we assert.
        vi.runAllTimers()
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    })
})
