'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { format, isPast, isSameDay } from 'date-fns'
import { cn } from '@/lib/utils'
import type { CalendarEntry } from './types'
import { compareEntries } from './sort'

export interface ScheduleCalendarListProps {
    entries: CalendarEntry[]
    onEntryClick?: (entry: CalendarEntry) => void
}

interface DateGroup {
    date: Date
    entries: CalendarEntry[]
}

export function ScheduleCalendarList({ entries, onEntryClick }: ScheduleCalendarListProps) {
    const sorted = useMemo(() => [...entries].sort(compareEntries), [entries])
    const groups = useMemo(() => groupByDate(sorted), [sorted])
    const today = useMemo(() => startOfToday(), [])

    // Ensure a Today group exists even when no entries land on today, so
    // scrollIntoView always has a target to anchor.
    const groupsWithToday = useMemo<DateGroup[]>(() => {
        if (groups.some((g) => isSameDay(g.date, today))) return groups
        const next: DateGroup[] = [...groups, { date: today, entries: [] }]
        next.sort((a, b) => a.date.getTime() - b.date.getTime())
        return next
    }, [groups, today])

    const todayRef = useRef<HTMLHeadingElement | null>(null)
    const hasAnchoredRef = useRef(false)

    useLayoutEffect(() => {
        if (hasAnchoredRef.current) return
        const el = todayRef.current
        if (!el) return
        // rAF lets the browser paint the grouped list first so scrollIntoView
        // lands on the final position rather than an intermediate layout.
        const raf = requestAnimationFrame(() => {
            el.scrollIntoView({ block: 'start', behavior: 'auto' })
            hasAnchoredRef.current = true
        })
        return () => cancelAnimationFrame(raf)
    }, [groupsWithToday.length])

    return (
        <div
            className="flex flex-col gap-3 overflow-y-auto bg-gray-50 rounded-md p-2"
            style={{ scrollMarginTop: '1rem' }}
        >
            {groupsWithToday.map((group) => {
                const isTodayGroup = isSameDay(group.date, today)
                return (
                    <section
                        key={group.date.toISOString()}
                        className={cn(
                            'rounded-md border overflow-hidden bg-white shadow-sm',
                            isTodayGroup ? 'border-green-400' : 'border-gray-200'
                        )}
                    >
                        <h2
                            ref={isTodayGroup ? todayRef : undefined}
                            className={cn(
                                'text-sm font-semibold sticky top-0 z-10 px-3 py-2 border-b',
                                isTodayGroup
                                    ? 'bg-green-50 text-green-900 border-green-300'
                                    : 'bg-gray-100 text-gray-700 border-gray-200'
                            )}
                        >
                            {isTodayGroup ? 'Today' : format(group.date, 'EEEE d MMMM')}
                        </h2>
                        {group.entries.length === 0 && isTodayGroup && (
                            <div className="text-xs text-gray-500 px-3 py-4 italic">
                                No entries today.
                            </div>
                        )}
                        {group.entries.length > 0 && (
                            <ul className="divide-y divide-gray-200">
                                {group.entries.map((entry) => {
                                    const isPastEntry = isPast(entry.end) && !isTodayGroup
                                    const isCancelled = entry.status === 'cancelled'
                                    const isFreedStatus =
                                        entry.status === 'cancelled' ||
                                        entry.status === 'postponed' ||
                                        entry.status === 'rescheduled'
                                    return (
                                        <li
                                            key={entry.id}
                                            data-entry-row={isPastEntry ? 'past' : 'future'}
                                            className={cn(
                                                'flex items-start gap-3 py-2 px-3 border-l-[3px] hover:bg-gray-50',
                                                isPastEntry && 'text-muted-foreground bg-gray-50/50',
                                                isFreedStatus && 'text-muted-foreground bg-gray-50/30'
                                            )}
                                            style={{ borderLeftColor: entry.color }}
                                        >
                                            <span className="text-xs font-mono w-14 shrink-0 text-gray-700 pt-0.5">
                                                {entry.allDay ? 'All day' : format(entry.start, 'HH:mm')}
                                            </span>
                                            <a
                                                href={entry.onClickHref ?? '#'}
                                                onClick={(ev) => {
                                                    if (!entry.onClickHref || !onEntryClick) return
                                                    ev.preventDefault()
                                                    onEntryClick(entry)
                                                }}
                                                className="flex-1 block"
                                            >
                                                <div
                                                    data-entry-title
                                                    className={cn(
                                                        'font-medium text-gray-900',
                                                        isCancelled && 'line-through'
                                                    )}
                                                >
                                                    {entry.title}
                                                    {entry.endsNextDay && (
                                                        <span className="ml-2 text-[10px] text-gray-500">+1 day</span>
                                                    )}
                                                </div>
                                                {entry.subtitle && (
                                                    <div className="text-xs text-gray-600">
                                                        {entry.subtitle}
                                                    </div>
                                                )}
                                            </a>
                                            {entry.statusLabel && (
                                                <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                                    {entry.statusLabel}
                                                </span>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </section>
                )
            })}
        </div>
    )
}

function startOfToday(): Date {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
}

function groupByDate(entries: CalendarEntry[]): DateGroup[] {
    const map = new Map<string, DateGroup>()
    for (const entry of entries) {
        const key = format(entry.start, 'yyyy-MM-dd')
        const bucket = map.get(key)
        if (bucket) {
            bucket.entries.push(entry)
        } else {
            const d = new Date(entry.start)
            d.setHours(0, 0, 0, 0)
            map.set(key, { date: d, entries: [entry] })
        }
    }
    return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
}
