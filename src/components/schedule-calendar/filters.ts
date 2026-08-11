import type { CalendarEntry, CalendarEntryKind } from './types'

/**
 * What the calendar filter bar can narrow by.
 *
 * Deliberately one model shared by the month and list views, so the two can
 * never drift into showing different things for the same filter.
 */
export interface CalendarFilters {
    /** Entry kinds to show. Empty means show every kind. */
    kinds: CalendarEntryKind[]
    /** Hide anything cancelled. Off by default, since a cancelled event is still worth seeing. */
    hideCancelled: boolean
    /**
     * Content gaps to surface, events only. Selecting more than one shows events
     * missing ANY of them, which is what "what still needs work" means in
     * practice.
     */
    missing: CalendarContentGap[]
}

export type CalendarContentGap = 'image' | 'brief' | 'description'

export const CONTENT_GAP_LABELS: Record<CalendarContentGap, string> = {
    image: 'No artwork',
    brief: 'No brief',
    description: 'No description',
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = {
    kinds: [],
    hideCancelled: false,
    missing: [],
}

export function isFilterActive(filters: CalendarFilters): boolean {
    return filters.kinds.length > 0 || filters.hideCancelled || filters.missing.length > 0
}

function hasGap(entry: CalendarEntry, gap: CalendarContentGap): boolean {
    if (!entry.content) return false
    if (gap === 'image') return !entry.content.hasImage
    if (gap === 'brief') return !entry.content.hasBrief
    return !entry.content.hasDescription
}

export function applyCalendarFilters(
    entries: CalendarEntry[],
    filters: CalendarFilters
): CalendarEntry[] {
    if (!isFilterActive(filters)) return entries

    return entries.filter((entry) => {
        if (filters.kinds.length > 0 && !filters.kinds.includes(entry.kind)) return false
        if (filters.hideCancelled && entry.status === 'cancelled') return false

        if (filters.missing.length > 0) {
            // Content gaps only apply to events. Anything with no content record
            // is filtered out rather than treated as complete, so "No artwork"
            // shows a list of events to fix and nothing else.
            if (!entry.content) return false
            if (!filters.missing.some((gap) => hasGap(entry, gap))) return false
        }

        return true
    })
}

/** The gaps an entry actually has, for rendering warning chips on its card. */
export function entryGaps(entry: CalendarEntry): CalendarContentGap[] {
    if (!entry.content) return []
    return (['image', 'brief', 'description'] as CalendarContentGap[]).filter((gap) =>
        hasGap(entry, gap)
    )
}
