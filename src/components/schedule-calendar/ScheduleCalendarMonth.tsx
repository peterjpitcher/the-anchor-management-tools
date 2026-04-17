'use client'

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, isToday, format } from 'date-fns'
import { cn } from '@/lib/utils'
import type { CalendarEntry } from './types'
import { compareEntries } from './sort'

export interface ScheduleCalendarMonthProps {
    entries: CalendarEntry[]
    anchor: Date
    firstDayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6
    onEntryClick?: (entry: CalendarEntry) => void
    onEmptyDayClick?: (date: Date) => void
    renderTooltip?: (entry: CalendarEntry) => ReactNode
}

export function ScheduleCalendarMonth({
    entries,
    anchor,
    firstDayOfWeek,
    onEntryClick,
    onEmptyDayClick,
    renderTooltip,
}: ScheduleCalendarMonthProps) {
    const weeks = useMemo(() => {
        const monthStart = startOfMonth(anchor)
        const gridStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
        const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: firstDayOfWeek })
        const weeksArr: Date[][] = []
        let day = gridStart
        while (day <= gridEnd) {
            const week: Date[] = []
            for (let i = 0; i < 7; i++) {
                week.push(day)
                day = addDays(day, 1)
            }
            weeksArr.push(week)
        }
        return weeksArr
    }, [anchor, firstDayOfWeek])

    const sortedEntries = useMemo(() => [...entries].sort(compareEntries), [entries])

    // Split entries: multi-day all-day (band) vs timed (per-day)
    const bandEntries = useMemo(
        () => sortedEntries.filter((e) => e.allDay && e.spansMultipleDays),
        [sortedEntries]
    )
    const timedEntries = useMemo(
        () => sortedEntries.filter((e) => !(e.allDay && e.spansMultipleDays)),
        [sortedEntries]
    )

    function entriesForDay(day: Date): CalendarEntry[] {
        return timedEntries.filter((e) => isSameDay(e.start, day))
    }

    function bandsForWeek(week: Date[]): Array<{ entry: CalendarEntry; startCol: number; span: number }> {
        const weekStart = week[0]
        const weekEnd = addDays(week[6], 1)
        return bandEntries
            .filter((e) => e.end >= weekStart && e.start < weekEnd)
            .map((e) => {
                const visibleStart = e.start < weekStart ? weekStart : e.start
                const visibleEnd = e.end > week[6] ? week[6] : e.end
                const startCol = week.findIndex((d) => isSameDay(d, visibleStart))
                const endCol = week.findIndex((d) => isSameDay(d, visibleEnd))
                const safeStart = startCol < 0 ? 0 : startCol
                const safeEnd = endCol < 0 ? 6 : endCol
                const span = Math.max(1, safeEnd - safeStart + 1)
                return { entry: e, startCol: safeStart, span }
            })
    }

    const weekDayNames = useMemo(() => {
        const sample = startOfWeek(new Date(), { weekStartsOn: firstDayOfWeek })
        return Array.from({ length: 7 }, (_, i) => format(addDays(sample, i), 'EEE'))
    }, [firstDayOfWeek])

    return (
        <div className="flex flex-col gap-px bg-border rounded-md overflow-hidden">
            <div className="grid grid-cols-7 gap-px bg-border">
                {weekDayNames.map((name) => (
                    <div
                        key={name}
                        className="bg-muted px-2 py-2 text-xs font-medium text-foreground text-center"
                    >
                        {name}
                    </div>
                ))}
            </div>

            {weeks.map((week, wi) => {
                const bands = bandsForWeek(week)
                return (
                    <div key={wi} className="grid grid-cols-7 gap-px bg-border">
                        {/* All-day band track */}
                        {bands.length > 0 && (
                            <div className="col-span-7 bg-background px-1 py-1 flex flex-col gap-1">
                                {bands.map(({ entry, startCol, span }) => {
                                    const isMuted =
                                        entry.status === 'cancelled' ||
                                        entry.status === 'postponed' ||
                                        entry.status === 'rescheduled'
                                    const isCancelled = entry.status === 'cancelled'
                                    return (
                                        <div
                                            key={entry.id}
                                            className={cn(
                                                'text-xs rounded-sm px-2 py-1 border-l-[3px] whitespace-normal break-words',
                                                isMuted && 'text-muted-foreground/80',
                                                isCancelled && 'line-through'
                                            )}
                                            style={{
                                                borderLeftColor: entry.color,
                                                background: `${entry.color}15`,
                                                marginLeft: `${(startCol / 7) * 100}%`,
                                                width: `${(span / 7) * 100}%`,
                                            }}
                                            data-entry-title
                                            title={
                                                renderTooltip
                                                    ? undefined
                                                    : entry.title
                                            }
                                        >
                                            {entry.title}
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {/* Day cells */}
                        {week.map((day) => {
                            const dayEntries = entriesForDay(day)
                            const inMonth = isSameMonth(day, anchor)
                            return (
                                <div
                                    key={day.toISOString()}
                                    className={cn(
                                        'bg-background p-1 flex flex-col gap-1 min-h-[80px]',
                                        !inMonth && 'bg-muted/40 text-muted-foreground'
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <button
                                            type="button"
                                            aria-label={
                                                onEmptyDayClick
                                                    ? `Add note for ${format(day, 'EEE d MMM')}`
                                                    : format(day, 'EEE d MMM')
                                            }
                                            className={cn(
                                                'text-xs font-medium rounded-full h-5 min-w-5 px-1.5 text-left',
                                                isToday(day) &&
                                                    'bg-primary text-primary-foreground text-center font-semibold'
                                            )}
                                            onClick={(ev) => {
                                                if (ev.target === ev.currentTarget && onEmptyDayClick) {
                                                    onEmptyDayClick(day)
                                                }
                                            }}
                                        >
                                            {format(day, 'd')}
                                        </button>
                                    </div>
                                    {dayEntries.map((entry) => (
                                        <EntryBlock
                                            key={entry.id}
                                            entry={entry}
                                            onClick={onEntryClick}
                                            renderTooltip={renderTooltip}
                                        />
                                    ))}
                                </div>
                            )
                        })}
                    </div>
                )
            })}
        </div>
    )
}

interface EntryBlockProps {
    entry: CalendarEntry
    onClick?: (entry: CalendarEntry) => void
    renderTooltip?: (entry: CalendarEntry) => ReactNode
}

function EntryBlock({ entry, onClick, renderTooltip }: EntryBlockProps) {
    const isMuted =
        entry.status === 'cancelled' ||
        entry.status === 'postponed' ||
        entry.status === 'rescheduled'
    const isCancelled = entry.status === 'cancelled'

    const content = (
        <>
            <div className="flex items-center gap-1">
                {!entry.allDay && (
                    <span className="font-semibold">{format(entry.start, 'HH:mm')}</span>
                )}
                <span
                    data-entry-title
                    className={cn(
                        'flex-1 whitespace-normal break-words',
                        isCancelled && 'line-through'
                    )}
                >
                    {entry.title}
                </span>
            </div>
            {entry.subtitle && (
                <div className="text-muted-foreground text-[11px]">{entry.subtitle}</div>
            )}
            {entry.endsNextDay && (
                <div className="text-muted-foreground text-[10px]">+1 day</div>
            )}
        </>
    )

    const sharedClass = cn(
        'block rounded-sm px-2 py-1 text-xs border-l-[3px] bg-background hover:bg-muted text-left w-full',
        isMuted && 'text-muted-foreground/80',
        isCancelled && 'line-through'
    )
    const sharedStyle = {
        borderLeftColor: entry.color,
        background: `${entry.color}10`,
    } as const

    if (entry.onClickHref) {
        return (
            <a
                href={entry.onClickHref}
                onClick={(e) => {
                    if (!onClick) return
                    e.preventDefault()
                    onClick(entry)
                }}
                className={sharedClass}
                style={sharedStyle}
                title={renderTooltip ? undefined : entry.title}
            >
                {content}
            </a>
        )
    }

    return (
        <button
            type="button"
            onClick={() => onClick?.(entry)}
            className={sharedClass}
            style={sharedStyle}
            title={renderTooltip ? undefined : entry.title}
        >
            {content}
        </button>
    )
}
