'use client'

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { addDays, startOfWeek, isSameDay, format } from 'date-fns'
import { cn } from '@/lib/utils'
import type { CalendarEntry } from './types'
import { computeWeekHourRange } from './hour-range'
import { compareEntries } from './sort'

export interface ScheduleCalendarWeekProps {
    entries: CalendarEntry[]
    anchor: Date
    firstDayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6
    onEntryClick?: (entry: CalendarEntry) => void
    renderTooltip?: (entry: CalendarEntry) => ReactNode
}

const ROW_PX = 40

export function ScheduleCalendarWeek({
    entries,
    anchor,
    firstDayOfWeek,
    onEntryClick,
}: ScheduleCalendarWeekProps) {
    const weekStart = useMemo(
        () => startOfWeek(anchor, { weekStartsOn: firstDayOfWeek }),
        [anchor, firstDayOfWeek]
    )
    const days = useMemo(
        () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
        [weekStart]
    )

    // Scope auto-extend to the visible week only so a single outlier entry in
    // another week doesn't widen every other week's hour range.
    const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])
    const entriesInVisibleWeek = useMemo(
        () => entries.filter((e) => e.start >= weekStart && e.start < weekEnd),
        [entries, weekStart, weekEnd]
    )

    const { startHour, endHour } = useMemo(
        () => computeWeekHourRange(entriesInVisibleWeek),
        [entriesInVisibleWeek]
    )
    // Hour labels are inclusive of both startHour and endHour — the baseline
    // 12..23 renders 12 labels (12:00 through 23:00) so the gutter reads end
    // to end without a hidden final hour.
    const hours = useMemo(
        () => Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i),
        [startHour, endHour]
    )

    const sortedEntries = useMemo(() => [...entries].sort(compareEntries), [entries])
    const allDayBand = sortedEntries.filter((e) => e.allDay)
    const timedEntries = sortedEntries.filter((e) => !e.allDay)

    function entriesForDay(day: Date) {
        // Overnight entries render on their start day only. isSameDay enforces
        // that an entry appears exclusively in the column where it begins.
        return timedEntries.filter((e) => isSameDay(e.start, day))
    }

    function layoutEntry(entry: CalendarEntry) {
        const minutesFromStart =
            (entry.start.getHours() - startHour) * 60 + entry.start.getMinutes()
        // Event duration is fixed at 2h regardless of the underlying data.
        // Private bookings use wall-clock difference; if endsNextDay, add 24h
        // worth of minutes so the overnight block stays on the start day.
        const duration =
            entry.kind === 'event'
                ? 120
                : ((entry.endsNextDay ? 24 : 0) + entry.end.getHours()) * 60 +
                  entry.end.getMinutes() -
                  (entry.start.getHours() * 60 + entry.start.getMinutes())
        return {
            top: Math.max(0, (minutesFromStart * ROW_PX) / 60),
            height: Math.max(ROW_PX / 2, (duration * ROW_PX) / 60),
        }
    }

    return (
        <div className="border border-border rounded-md overflow-hidden">
            {/* All-day band */}
            {allDayBand.length > 0 && (
                <div className="grid grid-cols-[50px_repeat(7,_1fr)] bg-muted/30 border-b border-border">
                    <div className="text-[10px] text-muted-foreground p-1 text-right">All day</div>
                    <div className="col-span-7 p-1 flex flex-col gap-1">
                        {allDayBand.map((e) => (
                            <a
                                key={e.id}
                                href={e.onClickHref ?? '#'}
                                onClick={(ev) => {
                                    if (!e.onClickHref || !onEntryClick) return
                                    ev.preventDefault()
                                    onEntryClick(e)
                                }}
                                className="text-xs rounded-sm px-2 py-1 border-l-[3px] block"
                                style={{ borderLeftColor: e.color, background: `${e.color}15` }}
                            >
                                <span data-entry-title className="whitespace-normal break-words">
                                    {e.title}
                                </span>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Day headers */}
            <div className="grid grid-cols-[50px_repeat(7,_1fr)] bg-muted border-b border-border">
                <div />
                {days.map((d) => (
                    <div key={d.toISOString()} className="text-xs font-medium text-center py-2">
                        {format(d, 'EEE d')}
                    </div>
                ))}
            </div>

            {/* Hour grid */}
            <div className="grid grid-cols-[50px_repeat(7,_1fr)] relative">
                {/* Time gutter */}
                <div className="flex flex-col border-r border-border">
                    {hours.map((h) => (
                        <div
                            key={h}
                            className="text-[10px] text-muted-foreground text-right pr-1"
                            style={{ height: ROW_PX }}
                        >
                            {String(h).padStart(2, '0')}:00
                        </div>
                    ))}
                </div>

                {/* Day columns */}
                {days.map((day) => (
                    <div key={day.toISOString()} className="relative border-r border-border">
                        {/* Empty hour cells for grid lines */}
                        {hours.map((h) => (
                            <div
                                key={h}
                                style={{ height: ROW_PX }}
                                className="border-b border-border/40"
                            />
                        ))}
                        {/* Entry blocks */}
                        {entriesForDay(day).map((entry) => {
                            const { top, height } = layoutEntry(entry)
                            return (
                                <a
                                    key={entry.id}
                                    href={entry.onClickHref ?? '#'}
                                    onClick={(e) => {
                                        if (!entry.onClickHref || !onEntryClick) return
                                        e.preventDefault()
                                        onEntryClick(entry)
                                    }}
                                    className={cn(
                                        'absolute left-1 right-1 rounded-sm px-2 py-1 text-xs border-l-[3px] bg-background overflow-hidden',
                                        entry.status === 'cancelled' && 'line-through text-muted-foreground/80'
                                    )}
                                    style={{
                                        top,
                                        height,
                                        borderLeftColor: entry.color,
                                        background: `${entry.color}15`,
                                    }}
                                >
                                    <div className="font-semibold">
                                        {format(entry.start, 'HH:mm')}
                                        {'–'}
                                        {format(entry.end, 'HH:mm')}
                                    </div>
                                    <div data-entry-title className="whitespace-normal break-words">
                                        {entry.title}
                                    </div>
                                    {entry.subtitle && (
                                        <div className="text-muted-foreground text-[10px]">
                                            {entry.subtitle}
                                        </div>
                                    )}
                                    {entry.endsNextDay && (
                                        <div className="text-muted-foreground text-[10px]">+1 day</div>
                                    )}
                                </a>
                            )
                        })}
                    </div>
                ))}
            </div>
        </div>
    )
}
