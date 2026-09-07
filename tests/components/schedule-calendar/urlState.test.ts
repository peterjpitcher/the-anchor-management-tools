import { describe, it, expect } from 'vitest'
import {
    calendarFiltersToParams,
    formatCalendarMonth,
    parseCalendarFilters,
    parseCalendarMonth,
    parseCalendarView,
    withCalendarParams,
} from '@/components/schedule-calendar/url-state'
import { EMPTY_CALENDAR_FILTERS } from '@/components/schedule-calendar/filters'

describe('calendar URL state', () => {
    it('accepts the two real views and ignores anything else', () => {
        expect(parseCalendarView('month')).toBe('month')
        expect(parseCalendarView('list')).toBe('list')
        expect(parseCalendarView('board')).toBeNull()
        expect(parseCalendarView(null)).toBeNull()
    })

    it('round-trips a month', () => {
        const parsed = parseCalendarMonth('2026-12')
        expect(parsed).not.toBeNull()
        expect(formatCalendarMonth(parsed!)).toBe('2026-12')
    })

    it('rejects a malformed or impossible month rather than guessing', () => {
        expect(parseCalendarMonth('2026-13')).toBeNull()
        expect(parseCalendarMonth('2026-00')).toBeNull()
        expect(parseCalendarMonth('december')).toBeNull()
        expect(parseCalendarMonth(null)).toBeNull()
    })

    it('falls back when no filter parameters are present at all', () => {
        const filters = parseCalendarFilters(new URLSearchParams('other=1'), EMPTY_CALENDAR_FILTERS)
        expect(filters).toEqual(EMPTY_CALENDAR_FILTERS)
    })

    it('reads kinds, content gaps and flags', () => {
        const filters = parseCalendarFilters(
            new URLSearchParams('calKinds=event,parking&calMissing=brief&calFlags=hideCancelled'),
            EMPTY_CALENDAR_FILTERS,
        )
        expect(filters.kinds).toEqual(['event', 'parking'])
        expect(filters.missing).toEqual(['brief'])
        expect(filters.hideCancelled).toBe(true)
        expect(filters.showCancelledPrivateHire).toBe(false)
    })

    it('drops unknown values instead of failing the whole parse', () => {
        const filters = parseCalendarFilters(
            new URLSearchParams('calKinds=event,dragons&calMissing=brief,haircut'),
            EMPTY_CALENDAR_FILTERS,
        )
        expect(filters.kinds).toEqual(['event'])
        expect(filters.missing).toEqual(['brief'])
    })

    it('removes parameters for cleared filters rather than leaving empty ones', () => {
        const params = calendarFiltersToParams(EMPTY_CALENDAR_FILTERS)
        expect(params.calKinds).toBeNull()
        expect(params.calMissing).toBeNull()
        expect(params.calFlags).toBeNull()
    })

    it('leaves unrelated query parameters alone', () => {
        const next = withCalendarParams(new URLSearchParams('page=3&q=quiz&calKinds=event'), {
            calKinds: null,
            calView: 'list',
        })
        expect(next.get('page')).toBe('3')
        expect(next.get('q')).toBe('quiz')
        expect(next.get('calKinds')).toBeNull()
        expect(next.get('calView')).toBe('list')
    })
})
