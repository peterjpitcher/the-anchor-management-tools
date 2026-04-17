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
            className="flex flex-col gap-4 overflow-y-auto"
            style={{ scrollMarginTop: '1rem' }}
        >
            {groupsWithToday.map((group) => {
                const isTodayGroup = isSameDay(group.date, today)
                return (
                    <section key={group.date.toISOString()}>
                        <h2
                            ref={isTodayGroup ? todayRef : undefined}
                            className={cn(
                                'text-sm font-medium sticky top-0 z-10 bg-background py-2 border-b border-border',
                                isTodayGroup && 'bg-primary/10 text-primary'
                            )}
                        >
                            {isTodayGroup ? 'Today' : format(group.date, 'EEE d MMM')}
                        </h2>
                        {group.entries.length === 0 && isTodayGroup && (
                            <div className="text-xs text-muted-foreground p-2">
                                No entries today.
                            </div>
                        )}
                        <ul className="divide-y divide-border">
                            {group.entries.map((entry) => {
                                const isPastEntry = isPast(entry.end) && !isTodayGroup
                                return (
                                    <li
                                        key={entry.id}
                                        data-entry-row={isPastEntry ? 'past' : 'future'}
                                        className={cn(
                                            'flex items-start gap-3 py-2 px-2',
                                            isPastEntry && 'text-muted-foreground bg-muted/20'
                                        )}
                                    >
                                        <span className="text-xs font-mono w-14 shrink-0">
                                            {format(entry.start, 'HH:mm')}
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
                                            <div data-entry-title className="font-medium">
                                                {entry.title}
                                            </div>
                                            {entry.subtitle && (
                                                <div className="text-xs text-muted-foreground">
                                                    {entry.subtitle}
                                                </div>
                                            )}
                                        </a>
                                        {entry.statusLabel && (
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                                {entry.statusLabel}
                                            </span>
                                        )}
                                    </li>
                                )
                            })}
                        </ul>
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
