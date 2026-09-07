import { describe, it, expect } from 'vitest'
import { eventToEntry, parkingToEntry } from '@/components/schedule-calendar/adapters'
import { entryGaps } from '@/components/schedule-calendar/filters'

const baseEvent = {
    id: 'e1',
    name: 'Quiz Night',
    date: '2026-09-10',
    time: '19:00',
    daysUntil: 3,
    bookedSeatsCount: 4,
    category: null,
    heroImageUrl: null,
    posterImageUrl: null,
    eventStatus: 'scheduled',
    bookingUrl: null,
    checklist: { completed: 0, total: 0, overdueCount: 0, dueTodayCount: 0, nextTask: null, outstanding: [] },
    statusBadge: { label: '', tone: 'neutral' as const },
}

describe('event content readiness', () => {
    it('claims no gaps when the caller supplied no readiness flags', () => {
        // The dashboard does not load brief/description/image columns. Before this
        // guard, every event it rendered showed all three "needs work" pills.
        const entry = eventToEntry({ ...baseEvent })
        expect(entry.content).toBeUndefined()
        expect(entryGaps(entry)).toEqual([])
    })

    it('reports the real gaps when flags are supplied', () => {
        const entry = eventToEntry({
            ...baseEvent,
            hasImage: false,
            hasBrief: true,
            hasDescription: false,
        })
        expect(entryGaps(entry)).toEqual(['image', 'description'])
    })

    it('reports nothing when everything is present', () => {
        const entry = eventToEntry({
            ...baseEvent,
            hasImage: true,
            hasBrief: true,
            hasDescription: true,
        })
        expect(entryGaps(entry)).toEqual([])
    })

    it('only claims gaps for the flags it was actually given', () => {
        // A partial record must not invent gaps for the fields it never saw.
        const entry = eventToEntry({ ...baseEvent, hasBrief: false })
        expect(entryGaps(entry)).toEqual(['brief'])
    })

    it('ignores image URLs, because a caller that never loaded them passes null', () => {
        const entry = eventToEntry({ ...baseEvent, heroImageUrl: null, posterImageUrl: null })
        expect(entry.content).toBeUndefined()
    })
})

describe('parking entries', () => {
    const baseParking = {
        id: 'p1',
        reference: 'PK-1',
        customer_first_name: 'Ada',
        customer_last_name: 'Lovelace',
        vehicle_registration: 'AB12 CDE',
        status: 'confirmed',
        payment_status: 'paid',
    }

    it('carries the real status so a cancelled booking can be struck through and filtered', () => {
        const entry = parkingToEntry({
            ...baseParking,
            status: 'cancelled',
            start_at: '2026-09-10T18:00:00+01:00',
            end_at: '2026-09-10T20:00:00+01:00',
        })
        expect(entry?.status).toBe('cancelled')
        expect(entry?.statusLabel).toBe('Cancelled')
    })

    it('returns null rather than parking an undated booking on today', () => {
        expect(parkingToEntry({ ...baseParking, start_at: null, end_at: null })).toBeNull()
    })

    it('does not label a long booking as ending next day', () => {
        const entry = parkingToEntry({
            ...baseParking,
            start_at: '2026-09-01T09:00:00+01:00',
            end_at: '2026-09-26T09:00:00+01:00',
        })
        expect(entry?.spansMultipleDays).toBe(true)
        expect(entry?.endsNextDay).toBe(false)
    })

    it('places a late-evening booking on its London day, not the host-local one', () => {
        // 23:30 London on 10 September. Under TZ=UTC this instant is 22:30 UTC on
        // the same day, but the point is that the entry must report the LONDON
        // calendar day in both runs, which is what npm run test:utc checks.
        const entry = parkingToEntry({
            ...baseParking,
            start_at: '2026-09-10T23:30:00+01:00',
            end_at: '2026-09-11T01:00:00+01:00',
        })
        expect(entry).not.toBeNull()
        expect(entry!.start.getDate()).toBe(10)
        expect(entry!.start.getMonth()).toBe(8)
        expect(entry!.start.getHours()).toBe(23)
        expect(entry!.endsNextDay).toBe(true)
    })
})
