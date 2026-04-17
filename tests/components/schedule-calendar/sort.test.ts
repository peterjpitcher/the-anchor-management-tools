// tests/components/schedule-calendar/sort.test.ts
import { describe, it, expect } from 'vitest'
import { compareEntries } from '@/components/schedule-calendar/sort'
import type { CalendarEntry } from '@/components/schedule-calendar/types'

function e(overrides: Partial<CalendarEntry>): CalendarEntry {
    return {
        id: 'id',
        kind: 'event',
        title: 'Title',
        start: new Date(2026, 3, 25, 19, 0),
        end: new Date(2026, 3, 25, 21, 0),
        allDay: false,
        spansMultipleDays: false,
        endsNextDay: false,
        color: '#000',
        subtitle: null,
        status: 'scheduled',
        statusLabel: null,
        tooltipData: {
            kind: 'event',
            name: 'x',
            time: '19:00',
            bookedSeats: 0,
            category: null,
            status: 'scheduled',
        },
        onClickHref: null,
        ...overrides,
    }
}

describe('compareEntries', () => {
    it('orders by start ascending', () => {
        const a = e({ id: 'a', start: new Date(2026, 3, 25, 18) })
        const b = e({ id: 'b', start: new Date(2026, 3, 25, 19) })
        expect(compareEntries(a, b)).toBeLessThan(0)
    })

    it('breaks ties by end ascending', () => {
        const a = e({ id: 'a', end: new Date(2026, 3, 25, 20) })
        const b = e({ id: 'b', end: new Date(2026, 3, 25, 22) })
        expect(compareEntries(a, b)).toBeLessThan(0)
    })

    it('breaks ties by kind priority: note < private < event < parking', () => {
        const note = e({ id: 'n', kind: 'calendar_note' })
        const pb = e({ id: 'p', kind: 'private_booking' })
        const ev = e({ id: 'e', kind: 'event' })
        const park = e({ id: 'k', kind: 'parking' })
        expect(compareEntries(note, pb)).toBeLessThan(0)
        expect(compareEntries(pb, ev)).toBeLessThan(0)
        expect(compareEntries(ev, park)).toBeLessThan(0)
    })

    it('breaks ties by status priority: confirmed/scheduled < draft < sold_out < postponed/rescheduled < cancelled', () => {
        const confirmed = e({ id: 'c', status: 'confirmed' })
        const draft = e({ id: 'd', status: 'draft' })
        const cancelled = e({ id: 'x', status: 'cancelled' })
        expect(compareEntries(confirmed, draft)).toBeLessThan(0)
        expect(compareEntries(draft, cancelled)).toBeLessThan(0)
    })

    it('breaks ties by title, then id', () => {
        const a = e({ id: 'a', title: 'Alpha' })
        const b = e({ id: 'b', title: 'Beta' })
        const c = e({ id: 'aa', title: 'Alpha' })
        expect(compareEntries(a, b)).toBeLessThan(0)
        expect(compareEntries(a, c)).toBeLessThan(0)
    })
})
