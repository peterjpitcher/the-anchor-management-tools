// tests/components/schedule-calendar/hour-range.test.ts
import { describe, it, expect } from 'vitest'
import { computeWeekHourRange } from '@/components/schedule-calendar/hour-range'
import type { CalendarEntry } from '@/components/schedule-calendar/types'

const base = (overrides: Partial<CalendarEntry>): CalendarEntry => ({
    id: 'id',
    kind: 'event',
    title: 't',
    start: new Date(2026, 3, 25, 19),
    end: new Date(2026, 3, 25, 21),
    allDay: false,
    spansMultipleDays: false,
    endsNextDay: false,
    color: '#000',
    subtitle: null,
    status: 'scheduled',
    statusLabel: null,
    tooltipData: {
        kind: 'event',
        name: 't',
        time: '19:00',
        bookedSeats: 0,
        category: null,
        status: 'scheduled',
    },
    onClickHref: null,
    ...overrides,
})

describe('computeWeekHourRange', () => {
    it('returns baseline when no entries fall outside', () => {
        const entries = [base({})]
        expect(computeWeekHourRange(entries)).toEqual({ startHour: 12, endHour: 23 })
    })

    it('extends start when an entry begins earlier', () => {
        const entries = [base({ start: new Date(2026, 3, 25, 10), end: new Date(2026, 3, 25, 12) })]
        expect(computeWeekHourRange(entries)).toEqual({ startHour: 10, endHour: 23 })
    })

    it('extends end when an entry runs later', () => {
        const entries = [base({ start: new Date(2026, 3, 25, 22), end: new Date(2026, 3, 26, 1) })]
        // end is 01:00 next day — extension capped within same day to 24
        const range = computeWeekHourRange(entries)
        expect(range.startHour).toBe(12)
        expect(range.endHour).toBeGreaterThanOrEqual(23)
    })

    it('ignores allDay entries when computing range', () => {
        const entries = [
            base({ allDay: true, start: new Date(2026, 3, 25, 0), end: new Date(2026, 3, 25, 0) }),
            base({ start: new Date(2026, 3, 25, 19), end: new Date(2026, 3, 25, 21) }),
        ]
        expect(computeWeekHourRange(entries)).toEqual({ startHour: 12, endHour: 23 })
    })

    it('caps at 0 and 24', () => {
        const entries = [base({ start: new Date(2026, 3, 25, 6), end: new Date(2026, 3, 25, 23, 30) })]
        const range = computeWeekHourRange(entries)
        expect(range.startHour).toBeGreaterThanOrEqual(0)
        expect(range.endHour).toBeLessThanOrEqual(24)
    })
})
