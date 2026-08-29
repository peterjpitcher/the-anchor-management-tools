'use client'

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, isToday, format } from 'date-fns'
import { cn } from '@/lib/utils'
import type { CalendarEntry } from './types'
import { compareEntries } from './sort'
import { CONTENT_GAP_LABELS, entryGaps } from './filters'
import { calendarColourNeedsLightText } from './appearance'
import { CalendarKindBadge } from './CalendarKindBadge'

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
        <div className="flex flex-col border border-gray-300 rounded-md overflow-hidden bg-white">
            <div className="grid grid-cols-7 border-b border-gray-300 bg-gray-100">
                {weekDayNames.map((name, i) => (
                    <div
                        key={name}
                        className={cn(
                            'px-2 py-2 text-xs font-semibold text-gray-700 text-center',
                            i > 0 && 'border-l border-gray-300'
                        )}
                    >
                        {name}
                    </div>
                ))}
            </div>

            {weeks.map((week, wi) => {
                const bands = bandsForWeek(week)
                return (
                    <div
                        key={wi}
                        className={cn(
                            'grid grid-cols-7',
                            wi > 0 && 'border-t border-gray-300'
                        )}
                    >
                        {/* All-day band track */}
                        {bands.length > 0 && (
                            <div className="col-span-7 bg-white px-1 py-1 flex flex-col gap-1 border-b border-gray-200">
                                {bands.map(({ entry, startCol, span }) => {
                                    const isCancelled = entry.status === 'cancelled'
                                    const lightText = !isCancelled && calendarColourNeedsLightText(entry.color)
                                    return (
                                        <div
                                            key={entry.id}
                                            className={cn(
                                                'flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium whitespace-normal break-words',
                                                isCancelled && 'line-through'
                                            )}
                                            style={{
                                                borderColor: isCancelled ? '#111827' : entry.color,
                                                backgroundColor: isCancelled ? '#FFFFFF' : entry.color,
                                                color: lightText ? '#FFFFFF' : '#111827',
                                                marginLeft: `${(startCol / 7) * 100}%`,
                                                width: `${(span / 7) * 100}%`,
                                            }}
                                            data-entry-kind={entry.kind}
                                            data-entry-title
                                            title={
                                                renderTooltip
                                                    ? undefined
                                                    : entry.title
                                            }
                                        >
                                            <CalendarKindBadge kind={entry.kind} lightText={lightText} />
                                            <span>{entry.title}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {/* Day cells */}
                        {week.map((day, di) => {
                            const dayEntries = entriesForDay(day)
                            const inMonth = isSameMonth(day, anchor)
                            return (
                                <div
                                    key={day.toISOString()}
                                    className={cn(
                                        'group bg-white p-1 flex flex-col gap-1 min-h-[80px]',
                                        di > 0 && 'border-l border-gray-200',
                                        !inMonth && 'bg-gray-50 text-gray-400',
                                        onEmptyDayClick && 'cursor-pointer'
                                    )}
                                    onClick={
                                        onEmptyDayClick
                                            ? (ev) => {
                                                  // Only a click on the empty part of the cell adds a
                                                  // note — clicks on entries or buttons handle themselves.
                                                  if (ev.target === ev.currentTarget) onEmptyDayClick(day)
                                              }
                                            : undefined
                                    }
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
                                                    'bg-primary text-primary-fg text-center font-semibold'
                                            )}
                                            onClick={
                                                onEmptyDayClick
                                                    ? (ev) => {
                                                          ev.stopPropagation()
                                                          onEmptyDayClick(day)
                                                      }
                                                    : undefined
                                            }
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
                                    {onEmptyDayClick && (
                                        <button
                                            type="button"
                                            aria-label={`Add note for ${format(day, 'EEE d MMM')}`}
                                            onClick={(ev) => {
                                                ev.stopPropagation()
                                                onEmptyDayClick(day)
                                            }}
                                            className="mt-auto flex items-center gap-1 self-start rounded-sm px-1 py-0.5 text-[11px] text-text-muted opacity-0 transition-opacity hover:bg-surface-hover group-hover:opacity-100 focus-visible:opacity-100"
                                        >
                                            <span aria-hidden="true">+</span> Note
                                        </button>
                                    )}
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
    const isCancelled = entry.status === 'cancelled'
    const lightText = !isCancelled && calendarColourNeedsLightText(entry.color)
    const secondaryTextClass = lightText ? 'text-white/80' : 'text-black/70'

    const content = (
        <>
            <div className="mb-0.5 flex min-w-0 items-center gap-1">
                <CalendarKindBadge kind={entry.kind} lightText={lightText} />
                {!entry.allDay && (
                    <span className="font-semibold leading-none">{format(entry.start, 'HH:mm')}</span>
                )}
            </div>
            <div
                data-entry-title
                className={cn(
                    'whitespace-normal break-words leading-tight',
                    isCancelled && 'line-through'
                )}
            >
                {entry.title}
            </div>
            {entry.subtitle && (
                <div className={cn('text-[11px] leading-tight', secondaryTextClass)}>{entry.subtitle}</div>
            )}
            {/*
              Status and content gaps on the card itself. The month grid is
              where the week is planned, so "is this confirmed" and "does this
              still need artwork" have to be readable without opening anything.
            */}
            {(entry.statusLabel || entryGaps(entry).length > 0) && (
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {entry.statusLabel && (
                        <span
                            className={cn(
                                'rounded px-1 py-px text-[10px] font-semibold uppercase leading-tight tracking-wide',
                                lightText ? 'bg-white/20 text-white' : 'bg-black/10 text-gray-950',
                            )}
                        >
                            {entry.statusLabel}
                        </span>
                    )}
                    {entryGaps(entry).map((gap) => (
                        <span
                            key={gap}
                            className="rounded border border-black/20 bg-white px-1 py-px text-[10px] font-medium leading-tight text-gray-950"
                        >
                            {CONTENT_GAP_LABELS[gap]}
                        </span>
                    ))}
                </div>
            )}
            {entry.endsNextDay && (
                <div className={cn('text-[10px] leading-tight', secondaryTextClass)}>+1 day</div>
            )}
        </>
    )

    const sharedClass = cn(
        'block w-full rounded-sm border px-2 py-1 text-left text-xs transition-[filter,box-shadow] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-1',
        isCancelled && 'line-through'
    )
    const sharedStyle = {
        borderColor: isCancelled ? '#111827' : entry.color,
        backgroundColor: isCancelled ? '#FFFFFF' : entry.color,
        color: lightText ? '#FFFFFF' : '#111827',
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
                data-entry-kind={entry.kind}
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
            data-entry-kind={entry.kind}
            title={renderTooltip ? undefined : entry.title}
        >
            {content}
        </button>
    )
}
