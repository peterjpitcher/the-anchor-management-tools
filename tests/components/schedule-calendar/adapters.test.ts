// tests/components/schedule-calendar/adapters.test.ts
import { describe, it, expect } from 'vitest'
import {
    eventToEntry,
    privateBookingToEntry,
    calendarNoteToEntry,
    parkingToEntry,
} from '@/components/schedule-calendar/adapters'

describe('eventToEntry', () => {
    it('builds an entry with 2h fixed duration', () => {
        const entry = eventToEntry({
            id: 'e1',
            name: 'Quiz Night',
            date: '2026-04-24',
            time: '19:00',
            daysUntil: 7,
            bookedSeatsCount: 22,
            category: { id: 'cat', name: 'Quiz', color: '#22c55e' },
            heroImageUrl: null,
            posterImageUrl: null,
            eventStatus: 'scheduled',
            bookingUrl: null,
            checklist: {
                completed: 0,
                total: 0,
                overdueCount: 0,
                dueTodayCount: 0,
                nextTask: null,
                outstanding: [],
            },
            statusBadge: { label: 'Scheduled', tone: 'info' },
        } as any)
        expect(entry.kind).toBe('event')
        expect(entry.id).toBe('evt:e1')
        expect(entry.title).toBe('Quiz Night')
        expect(entry.subtitle).toBe('22 booked')
        expect(entry.end.getTime() - entry.start.getTime()).toBe(2 * 60 * 60 * 1000)
        expect(entry.onClickHref).toBe('/events/e1')
        expect(entry.status).toBe('scheduled')
        expect(entry.tooltipData.kind).toBe('event')
    })

    it('subtitle handles 0 / 1 seats', () => {
        const zero = eventToEntry({
            id: 'e',
            name: 'n',
            date: '2026-04-24',
            time: '19:00',
            bookedSeatsCount: 0,
        } as any)
        const one = eventToEntry({
            id: 'e',
            name: 'n',
            date: '2026-04-24',
            time: '19:00',
            bookedSeatsCount: 1,
        } as any)
        expect(zero.subtitle).toBe('0 booked')
        expect(one.subtitle).toBe('1 booked')
    })
})

describe('privateBookingToEntry', () => {
    it('marks endsNextDay true when end_time_next_day is set', () => {
        const entry = privateBookingToEntry({
            id: 'pb1',
            customer_name: 'Raj & Priya',
            event_date: '2026-04-25',
            start_time: '14:00',
            end_time: '01:00',
            end_time_next_day: true,
            status: 'confirmed',
            event_type: 'Wedding Reception',
            guest_count: 120,
        })
        expect(entry.id).toBe('pb:pb1')
        expect(entry.endsNextDay).toBe(true)
        expect(entry.spansMultipleDays).toBe(false) // overnight is not multi-day
        expect(entry.subtitle).toBe('120 guests')
        expect(entry.onClickHref).toBe('/private-bookings/pb1')
    })

    it('defaults end to +2h when end_time is missing', () => {
        const entry = privateBookingToEntry({
            id: 'pb2',
            customer_name: 'x',
            event_date: '2026-04-25',
            start_time: '14:00',
            end_time: null,
            end_time_next_day: null,
            status: 'confirmed',
            event_type: null,
            guest_count: null,
        })
        expect(entry.end.getTime() - entry.start.getTime()).toBe(2 * 60 * 60 * 1000)
        expect(entry.subtitle).toBeNull()
    })
})

describe('calendarNoteToEntry', () => {
    it('marks allDay + spansMultipleDays for multi-day notes', () => {
        const entry = calendarNoteToEntry({
            id: 'n1',
            note_date: '2026-04-20',
            end_date: '2026-04-26',
            title: 'Pete & Bill On Holiday',
            notes: null,
            source: 'manual',
            start_time: null,
            end_time: null,
            color: '#0EA5E9',
        })
        expect(entry.id).toBe('note:n1')
        expect(entry.allDay).toBe(true)
        expect(entry.spansMultipleDays).toBe(true)
        expect(entry.onClickHref).toBeNull()
    })

    it('clamps corrupt end_date < note_date back to note_date', () => {
        const entry = calendarNoteToEntry({
            id: 'n2',
            note_date: '2026-04-25',
            end_date: '2026-04-20',
            title: 'x',
            notes: null,
            source: 'manual',
            start_time: null,
            end_time: null,
            color: '#0EA5E9',
        })
        expect(entry.start.getTime()).toEqual(entry.end.getTime())
        expect(entry.spansMultipleDays).toBe(false)
    })
})

describe('parkingToEntry', () => {
    it('routes clicks to /parking', () => {
        const entry = parkingToEntry({
            id: 'p1',
            reference: 'PARK-001',
            customer_first_name: 'Alex',
            customer_last_name: 'Jones',
            vehicle_registration: 'AB12 XYZ',
            start_at: '2026-04-25T10:00:00Z',
            end_at: '2026-04-25T18:00:00Z',
            status: 'confirmed',
            payment_status: 'paid',
        })
        expect(entry.id).toBe('park:p1')
        expect(entry.onClickHref).toBe('/parking')
        expect(entry.kind).toBe('parking')
    })
})
