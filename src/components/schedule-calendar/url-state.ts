import type { CalendarFilters } from './filters'
import type { CalendarEntryKind, ScheduleCalendarView } from './types'

/**
 * Calendar state carried in the URL.
 *
 * Deliberately namespaced `cal*`. The events page already owns a `view` concept
 * of its own (list, calendar, board), so a bare `?view=list` would be ambiguous
 * between the event table and the venue schedule, and the two would fight.
 *
 * Only filter state lives here. Never note text, customer names or anything
 * else personal: a URL gets pasted into messages.
 */
export const CAL_VIEW_PARAM = 'calView'
export const CAL_MONTH_PARAM = 'calMonth'
export const CAL_KINDS_PARAM = 'calKinds'
export const CAL_MISSING_PARAM = 'calMissing'
export const CAL_FLAGS_PARAM = 'calFlags'

const KINDS: CalendarEntryKind[] = [
    'event',
    'private_booking',
    'balance_due',
    'birthday',
    'special_hours',
    'calendar_note',
    'parking',
    'marketing_email',
]

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** Unknown or malformed values are ignored rather than throwing or clearing everything. */
export function parseCalendarView(value: string | null): ScheduleCalendarView | null {
    return value === 'month' || value === 'list' ? value : null
}

export function parseCalendarMonth(value: string | null): Date | null {
    if (!value || !MONTH_PATTERN.test(value)) return null
    const [year, month] = value.split('-').map(Number)
    const date = new Date(year, month - 1, 1)
    return Number.isNaN(date.getTime()) ? null : date
}

export function formatCalendarMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function parseCalendarFilters(params: URLSearchParams, fallback: CalendarFilters): CalendarFilters {
    const rawKinds = params.get(CAL_KINDS_PARAM)
    const rawMissing = params.get(CAL_MISSING_PARAM)
    const rawFlags = params.get(CAL_FLAGS_PARAM)

    if (rawKinds === null && rawMissing === null && rawFlags === null) return fallback

    const kinds = (rawKinds ?? '')
        .split(',')
        .filter((value): value is CalendarEntryKind => KINDS.includes(value as CalendarEntryKind))

    const missing = (rawMissing ?? '')
        .split(',')
        .filter((value): value is 'image' | 'brief' | 'description' =>
            value === 'image' || value === 'brief' || value === 'description',
        )

    const flags = (rawFlags ?? '').split(',')

    return {
        kinds,
        missing,
        hideCancelled: flags.includes('hideCancelled'),
        showCancelledPrivateHire: flags.includes('showCancelledHire'),
    }
}

export function calendarFiltersToParams(filters: CalendarFilters): Record<string, string | null> {
    const flags: string[] = []
    if (filters.hideCancelled) flags.push('hideCancelled')
    if (filters.showCancelledPrivateHire) flags.push('showCancelledHire')

    // null means "remove this parameter", so a cleared filter leaves a clean URL.
    return {
        [CAL_KINDS_PARAM]: filters.kinds.length > 0 ? filters.kinds.join(',') : null,
        [CAL_MISSING_PARAM]: filters.missing.length > 0 ? filters.missing.join(',') : null,
        [CAL_FLAGS_PARAM]: flags.length > 0 ? flags.join(',') : null,
    }
}

/**
 * Applies changes to a query string while leaving every unrelated parameter
 * alone. The calendar shares its URL with whatever page it is embedded in.
 */
export function withCalendarParams(
    current: URLSearchParams,
    updates: Record<string, string | null>,
): URLSearchParams {
    const next = new URLSearchParams(current.toString())
    for (const [key, value] of Object.entries(updates)) {
        if (value === null) next.delete(key)
        else next.set(key, value)
    }
    return next
}
