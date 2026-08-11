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
     * Bring cancelled private hire back into view. Off by default: a cancelled
     * private booking is dead weight on the calendar and the owner does not want
     * to see it. A cancelled EVENT is different, it still matters, which is what
     * hideCancelled is for.
     */
    showCancelledPrivateHire: boolean
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
    showCancelledPrivateHire: false,
    missing: [],
}

/**
 * Private hire shows up on the calendar as the booking itself plus its
 * balance-due marker. Both come from the same private booking row and carry its
 * status, so both follow the same rule when the booking is cancelled: chasing a
 * balance for a hire that is not happening is noise too.
 */
const PRIVATE_HIRE_KINDS: readonly CalendarEntryKind[] = ['private_booking', 'balance_due']

export function isCancelledPrivateHire(entry: CalendarEntry): boolean {
    return entry.status === 'cancelled' && PRIVATE_HIRE_KINDS.includes(entry.kind)
}

/** True when the user has moved away from the defaults, so "Clear filters" has something to undo. */
export function isFilterActive(filters: CalendarFilters): boolean {
    return (
        filters.kinds.length > 0 ||
        filters.hideCancelled ||
        filters.showCancelledPrivateHire ||
        filters.missing.length > 0
    )
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
    // No early return on "no filters selected": cancelled private hire is hidden
    // by default, so this pass always has work to do.
    return entries.filter((entry) => {
        if (!filters.showCancelledPrivateHire && isCancelledPrivateHire(entry)) return false

        if (filters.kinds.length > 0 && !filters.kinds.includes(entry.kind)) return false
        // Deliberately not exempted by showCancelledPrivateHire, so "Hide cancelled"
        // wins: asking to hide everything cancelled beats asking to see cancelled hire.
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
