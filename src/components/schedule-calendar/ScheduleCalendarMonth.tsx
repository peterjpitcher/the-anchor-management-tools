'use client'

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, isToday, format } from 'date-fns'
import { cn } from '@/lib/utils'
import type { CalendarEntry, ScheduleDailyOps } from './types'
import { compareEntries } from './sort'
import { CONTENT_GAP_LABELS, entryGaps } from './filters'
import { calendarColourNeedsLightText } from './appearance'
import { CalendarKindBadge } from './CalendarKindBadge'
import { CalendarEntryTooltip } from './CalendarEntryTooltip'
import { entryTooltipText } from './tooltip-text'

export interface ScheduleCalendarMonthProps {
    entries: CalendarEntry[]
    anchor: Date
    firstDayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6
    onEntryClick?: (entry: CalendarEntry) => void
    onEmptyDayClick?: (date: Date) => void
    renderTooltip?: (entry: CalendarEntry) => ReactNode
    /**
     * Covers booked and who is working. Previously reached the list view only,
     * so it was invisible on desktop, which is where the week actually gets
     * planned.
     */
    dailyOps?: ScheduleDailyOps
    /**
     * Unfiltered entries, used only to decide whether the venue or kitchen is
     * shut. Filters control which ENTRIES are listed; they must not change an
     * operational fact about the day. Filtering to "no brief" should not make a
     * closed day look open.
     */
    closureEntries?: CalendarEntry[]
}

export function ScheduleCalendarMonth({
    entries,
    anchor,
    firstDayOfWeek,
    onEntryClick,
    onEmptyDayClick,
    renderTooltip,
    dailyOps,
    closureEntries,
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
                                    const bandStyle = {
                                        borderColor: isCancelled ? '#111827' : entry.color,
                                        backgroundColor: isCancelled ? '#FFFFFF' : entry.color,
                                        color: lightText ? '#FFFFFF' : '#111827',
                                        marginLeft: `${(startCol / 7) * 100}%`,
                                        width: `${(span / 7) * 100}%`,
                                    }
                                    const bandClass = cn(
                                        'flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium whitespace-normal break-words',
                                        isCancelled && 'line-through',
                                        onEntryClick && 'text-left hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-1'
                                    )
                                    const bandBody = (
                                        <>
                                            <CalendarKindBadge kind={entry.kind} lightText={lightText} />
                                            <span>{entry.title}</span>
                                        </>
                                    )
                                    // A multi-day entry renders ONLY as a band here, so leaving the
                                    // band inert made a multi-day note unopenable in the month grid
                                    // even once single-day notes could be clicked.
                                    return onEntryClick ? (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            onClick={() => onEntryClick(entry)}
                                            className={bandClass}
                                            style={bandStyle}
                                            data-entry-kind={entry.kind}
                                            data-entry-title
                                            title={entryTooltipText(entry)}
                                        >
                                            {bandBody}
                                        </button>
                                    ) : (
                                        <div
                                            key={entry.id}
                                            className={bandClass}
                                            style={bandStyle}
                                            data-entry-kind={entry.kind}
                                            data-entry-title
                                            title={entryTooltipText(entry)}
                                        >
                                            {bandBody}
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {/* Day cells */}
                        {week.map((day, di) => {
                            const dayEntries = entriesForDay(day)
                            const inMonth = isSameMonth(day, anchor)
                            const closure = closureForDay(day, closureEntries ?? entries)
                            const iso = format(day, 'yyyy-MM-dd')
                            const covers = dailyOps?.coversByDate[iso] ?? 0
                            const staff = dailyOps?.staffByDate[iso] ?? []
                            return (
                                <div
                                    key={day.toISOString()}
                                    className={cn(
                                        'group bg-white p-1 flex flex-col gap-1 min-h-[80px]',
                                        di > 0 && 'border-l border-gray-200',
                                        !inMonth && 'bg-gray-50 text-gray-400',
                                        // Being shut is a property of the DAY, not one more
                                        // chip queued behind the events on it.
                                        closure === 'closed' && 'bg-gray-200',
                                        closure === 'kitchen' && 'bg-amber-50',
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
                                        {/* Text as well as colour: a colour-only
                                            treatment says nothing to a screen reader
                                            or in high contrast. */}
                                        {closure === 'closed' && (
                                            <span className="rounded bg-gray-900 px-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                                                Closed
                                            </span>
                                        )}
                                        {closure === 'kitchen' && (
                                            <span className="rounded bg-amber-200 px-1 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                                                No kitchen
                                            </span>
                                        )}
                                    </div>
                                    {(covers > 0 || staff.length > 0) && (
                                        <p className="text-[10px] leading-tight text-gray-500">
                                            {covers > 0 && <span>{covers} cover{covers === 1 ? '' : 's'}</span>}
                                            {covers > 0 && staff.length > 0 && <span aria-hidden> · </span>}
                                            {staff.length > 0 && <span>{staff.join(', ')}</span>}
                                        </p>
                                    )}
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
                                            // Was opacity-0 + group-hover. Opacity does not remove an
                                            // element from hit testing and touch never fires hover, so
                                            // every day cell carried an invisible but tappable button.
                                            // Now it is dimmed rather than hidden, and full strength on
                                            // hover or focus.
                                            className="mt-auto flex min-h-[24px] items-center gap-1 self-start rounded-sm px-1 py-0.5 text-[11px] text-text-muted opacity-40 transition-opacity hover:bg-surface-hover hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
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

/**
 * Whether the venue or just the kitchen is shut on a day, from the special-hours
 * entries already on the calendar. Venue closure wins over kitchen closure.
 */
function closureForDay(day: Date, entries: CalendarEntry[]): 'closed' | 'kitchen' | null {
    let kitchen = false
    for (const entry of entries) {
        if (entry.kind !== 'special_hours') continue
        if (!isSameDay(entry.start, day)) continue
        if (entry.tooltipData.kind !== 'special_hours') continue
        if (entry.tooltipData.isClosed) return 'closed'
        if (entry.tooltipData.isKitchenClosed) kitchen = true
    }
    return kitchen ? 'kitchen' : null
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

    const tooltipText = entryTooltipText(entry)

    const control = entry.onClickHref ? (
        <a
            href={entry.onClickHref}
            onClick={(e) => {
                if (!onClick) return
                // Let the browser handle modifier clicks so "open in new tab"
                // still works on a real link.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                e.preventDefault()
                onClick(entry)
            }}
            className={sharedClass}
            style={sharedStyle}
            data-entry-kind={entry.kind}
            title={tooltipText}
        >
            {content}
        </a>
    ) : (
        <button
            type="button"
            onClick={() => onClick?.(entry)}
            className={sharedClass}
            style={sharedStyle}
            data-entry-kind={entry.kind}
            title={tooltipText}
        >
            {content}
        </button>
    )

    if (!renderTooltip) return control

    return (
        <CalendarEntryTooltip content={renderTooltip(entry)} text={tooltipText}>
            {control}
        </CalendarEntryTooltip>
    )
}
