// src/components/schedule-calendar/hour-range.ts
import type { CalendarEntry } from './types'

export interface HourRange {
    startHour: number
    endHour: number
}

const DEFAULT_BASELINE: HourRange = { startHour: 12, endHour: 23 }

export function computeWeekHourRange(
    entries: CalendarEntry[],
    baseline: HourRange = DEFAULT_BASELINE
): HourRange {
    let startHour = baseline.startHour
    let endHour = baseline.endHour

    for (const entry of entries) {
        if (entry.allDay) continue
        const s = entry.start.getHours()
        const e = entry.end.getHours() + (entry.end.getMinutes() > 0 ? 1 : 0)
        if (s < startHour) startHour = s
        if (e > endHour) endHour = e
    }

    if (startHour < 0) startHour = 0
    if (endHour > 24) endHour = 24
    return { startHour, endHour }
}
