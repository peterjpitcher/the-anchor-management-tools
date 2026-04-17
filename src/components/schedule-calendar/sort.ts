// src/components/schedule-calendar/sort.ts
import type { CalendarEntry, CalendarEntryKind, CalendarEntryStatus } from './types'

const kindPriority: Record<CalendarEntryKind, number> = {
    calendar_note: 0,
    private_booking: 1,
    event: 2,
    parking: 3,
}

const statusPriority: Record<string, number> = {
    confirmed: 0,
    scheduled: 0,
    draft: 1,
    sold_out: 2,
    postponed: 3,
    rescheduled: 3,
    cancelled: 4,
}

function statusRank(s: CalendarEntryStatus): number {
    if (!s) return 0
    return statusPriority[s] ?? 5
}

export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
    const byStart = a.start.getTime() - b.start.getTime()
    if (byStart !== 0) return byStart

    const byEnd = a.end.getTime() - b.end.getTime()
    if (byEnd !== 0) return byEnd

    const byKind = kindPriority[a.kind] - kindPriority[b.kind]
    if (byKind !== 0) return byKind

    const byStatus = statusRank(a.status) - statusRank(b.status)
    if (byStatus !== 0) return byStatus

    const byTitle = a.title.localeCompare(b.title)
    if (byTitle !== 0) return byTitle

    return a.id.localeCompare(b.id)
}
