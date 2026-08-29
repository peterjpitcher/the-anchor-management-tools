'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { format, isPast, isSameDay } from 'date-fns'
import { cn } from '@/lib/utils'
import type { CalendarEntry, ScheduleDailyOps } from './types'
import { compareEntries } from './sort'
import { CONTENT_GAP_LABELS, entryGaps } from './filters'
import { calendarColourNeedsLightText } from './appearance'
import { CalendarKindBadge } from './CalendarKindBadge'

export interface ScheduleCalendarListProps {
    entries: CalendarEntry[]
    onEntryClick?: (entry: CalendarEntry) => void
    /**
     * Hide date groups before today. Used on mobile where the list is the only
     * view — without it, months of past entries render above Today and the
     * page loads scrolled halfway down.
     */
    hidePast?: boolean
    /** Per-day covers booked + staff on rota, rendered as a small note per day. */
    dailyOps?: ScheduleDailyOps
}

interface DateGroup {
    date: Date
    entries: CalendarEntry[]
}

export function ScheduleCalendarList({ entries, onEntryClick, hidePast = false, dailyOps }: ScheduleCalendarListProps) {
    const today = useMemo(() => startOfToday(), [])
    const sorted = useMemo(() => [...entries].sort(compareEntries), [entries])
    const groups = useMemo(() => groupByDate(sorted), [sorted])

    // Ensure a Today group exists even when no entries land on today, so
    // scrollIntoView always has a target to anchor. When hidePast is set,
    // pre-today groups are dropped first (group dates and `today` are both
    // local-midnight Dates, so the comparison is exact).
    const groupsWithToday = useMemo<DateGroup[]>(() => {
        const base = hidePast
            ? groups.filter((g) => g.date.getTime() >= today.getTime())
            : groups
        if (base.some((g) => isSameDay(g.date, today))) return base
        const next: DateGroup[] = [...base, { date: today, entries: [] }]
        next.sort((a, b) => a.date.getTime() - b.date.getTime())
        return next
    }, [groups, today, hidePast])

    const todayRef = useRef<HTMLHeadingElement | null>(null)
    const hasAnchoredRef = useRef(false)

    useLayoutEffect(() => {
        // With past groups hidden, Today is already at the top — scrolling
        // would just yank the document down past any page header.
        if (hidePast) return
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
    }, [groupsWithToday.length, hidePast])

    return (
        <div className="flex flex-col gap-3 bg-gray-50 rounded-md p-2">
            {groupsWithToday.map((group) => {
                const isTodayGroup = isSameDay(group.date, today)
                return (
                    <section
                        key={group.date.toISOString()}
                        className={cn(
                            'rounded-md border overflow-hidden bg-white shadow-sm',
                            isTodayGroup ? 'border-gray-950' : 'border-gray-200'
                        )}
                    >
                        <h2
                            ref={isTodayGroup ? todayRef : undefined}
                            className={cn(
                                // Plain card header — not sticky. Each day is its own
                                // rounded, overflow-hidden card, so a viewport-offset
                                // sticky header (top-14 to clear the mobile chrome) pinned
                                // 56px into the card and bisected the first event row.
                                'text-sm font-semibold px-3 py-2 border-b',
                                isTodayGroup
                                    ? 'border-gray-950 bg-gray-950 text-white'
                                    : 'bg-gray-100 text-gray-700 border-gray-200'
                            )}
                        >
                            {isTodayGroup ? 'Today' : format(group.date, 'EEEE d MMMM')}
                        </h2>
                        {(() => {
                            const iso = format(group.date, 'yyyy-MM-dd')
                            const covers = dailyOps?.coversByDate[iso] ?? 0
                            const staff = dailyOps?.staffByDate[iso] ?? []
                            if (covers === 0 && staff.length === 0) return null
                            return (
                                <p className="text-[11px] leading-snug text-gray-500 px-3 py-1 border-b border-gray-100">
                                    {covers > 0 && (
                                        <span>{covers} cover{covers === 1 ? '' : 's'} booked</span>
                                    )}
                                    {covers > 0 && staff.length > 0 && <span aria-hidden> · </span>}
                                    {staff.length > 0 && <span>Working: {staff.join(', ')}</span>}
                                </p>
                            )
                        })()}
                        {group.entries.length === 0 && isTodayGroup && (
                            <div className="text-xs text-gray-500 px-3 py-4 italic">
                                No entries today.
                            </div>
                        )}
                        {group.entries.length > 0 && (
                            <ul className="space-y-1 p-1">
                                {group.entries.map((entry) => {
                                    const isPastEntry = isPast(entry.end) && !isTodayGroup
                                    const isCancelled = entry.status === 'cancelled'
                                    const lightText = !isCancelled && calendarColourNeedsLightText(entry.color)
                                    const secondaryTextClass = lightText ? 'text-white/80' : 'text-black/70'
                                    const details = (
                                        <>
                                            <div
                                                data-entry-title
                                                className={cn(
                                                    'font-semibold',
                                                    isCancelled && 'line-through'
                                                )}
                                            >
                                                {entry.title}
                                                {entry.endsNextDay && (
                                                    <span className={cn('ml-2 text-[10px]', secondaryTextClass)}>+1 day</span>
                                                )}
                                            </div>
                                            {entry.subtitle && (
                                                <div className={cn('text-xs', secondaryTextClass)}>
                                                    {entry.subtitle}
                                                </div>
                                            )}
                                            {entryGaps(entry).length > 0 && (
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {entryGaps(entry).map((gap) => (
                                                        <span
                                                            key={gap}
                                                            className="rounded border border-black/20 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-950"
                                                        >
                                                            {CONTENT_GAP_LABELS[gap]}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    )
                                    return (
                                        <li
                                            key={entry.id}
                                            data-entry-row={isPastEntry ? 'past' : 'future'}
                                            data-entry-kind={entry.kind}
                                            className={cn(
                                                'flex items-start gap-3 rounded-sm border px-3 py-2 transition-[filter,opacity] hover:brightness-95',
                                                isPastEntry && 'opacity-70'
                                            )}
                                            style={{
                                                borderColor: isCancelled ? '#111827' : entry.color,
                                                backgroundColor: isCancelled ? '#FFFFFF' : entry.color,
                                                color: lightText ? '#FFFFFF' : '#111827',
                                            }}
                                        >
                                            <div className="flex w-20 shrink-0 flex-col items-start gap-1 pt-0.5">
                                                <CalendarKindBadge kind={entry.kind} lightText={lightText} />
                                                <span className={cn('font-mono text-xs', secondaryTextClass)}>
                                                    {entry.allDay ? 'All day' : format(entry.start, 'HH:mm')}
                                                </span>
                                            </div>
                                            {entry.onClickHref ? (
                                                <a
                                                    href={entry.onClickHref}
                                                    onClick={(ev) => {
                                                        if (!onEntryClick) return
                                                        ev.preventDefault()
                                                        onEntryClick(entry)
                                                    }}
                                                    className="block flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1"
                                                >
                                                    {details}
                                                </a>
                                            ) : (
                                                <div className="min-w-0 flex-1">{details}</div>
                                            )}
                                            {entry.statusLabel && (
                                                <span
                                                    className={cn(
                                                        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                                        lightText ? 'bg-white/20 text-white' : 'bg-black/10 text-gray-950'
                                                    )}
                                                >
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
