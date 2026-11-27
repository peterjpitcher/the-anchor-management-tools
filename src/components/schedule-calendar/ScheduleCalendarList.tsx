'use client'

import { useMemo, useState } from 'react'
import { format, isPast, isSameDay } from 'date-fns'
import { Badge, Button, Card, CardHeader, Empty } from '@/ds'
import { cn } from '@/lib/utils'
import type { CalendarEntry, ScheduleDailyOps } from './types'
import type { ReactNode } from 'react'
import { compareEntries } from './sort'
import { CONTENT_GAP_LABELS, entryGaps } from './filters'
import { CALENDAR_BLACK, CALENDAR_WHITE, calendarColourNeedsLightText } from './appearance'
import { CalendarKindBadge } from './CalendarKindBadge'
import { CalendarEntryTooltip } from './CalendarEntryTooltip'
import { entryTooltipText } from './tooltip-text'

export interface ScheduleCalendarListProps {
    entries: CalendarEntry[]
    onEntryClick?: (entry: CalendarEntry) => void
    /**
     * The month on screen. Only its days are listed, so the list pages month by month like the
     * grid, and on a phone (where the list is the only view) every past month is reachable.
     * In the current month the days before today start folded away behind a button, so the
     * list opens on today without scrolling the page.
     */
    month?: Date
    /** Per-day covers booked + staff on rota, rendered as a small note per day. */
    dailyOps?: ScheduleDailyOps
    /**
     * Rich hover/focus detail. The list used not to accept this at all, so half
     * the calendar had no tooltips even once the month grid did.
     */
    renderTooltip?: (entry: CalendarEntry) => ReactNode
}

interface DateGroup {
    date: Date
    entries: CalendarEntry[]
}

export function ScheduleCalendarList({ entries, onEntryClick, month, dailyOps, renderTooltip }: ScheduleCalendarListProps) {
    const today = useMemo(() => startOfToday(), [])
    const sorted = useMemo(() => [...entries].sort(compareEntries), [entries])
    const groups = useMemo(() => {
        const all = groupByDate(sorted)
        if (!month) return all
        // A multi-day entry makes a group for every day it covers; keep this month's days only.
        return all.filter(
            (g) => g.date.getFullYear() === month.getFullYear() && g.date.getMonth() === month.getMonth()
        )
    }, [sorted, month])

    const monthHoldsToday =
        !month || (month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth())
    const [showEarlier, setShowEarlier] = useState(false)
    const earlierGroups = monthHoldsToday ? groups.filter((g) => g.date.getTime() < today.getTime()) : []
    const earlierCount = earlierGroups.reduce((sum, g) => sum + g.entries.length, 0)

    // Today always has a card in its own month, so there is somewhere to say "nothing today".
    const groupsWithToday = useMemo<DateGroup[]>(() => {
        if (!monthHoldsToday || groups.some((g) => isSameDay(g.date, today))) return groups
        const next: DateGroup[] = [...groups, { date: today, entries: [] }]
        next.sort((a, b) => a.date.getTime() - b.date.getTime())
        return next
    }, [groups, today, monthHoldsToday])

    const shownGroups =
        monthHoldsToday && !showEarlier
            ? groupsWithToday.filter((g) => g.date.getTime() >= today.getTime())
            : groupsWithToday

    if (groupsWithToday.length === 0) {
        return (
            <div className="rounded-lg bg-surface-2 p-2">
                <Empty size="sm" title={month ? `Nothing on the calendar in ${format(month, 'MMMM yyyy')}` : 'Nothing on the calendar'} />
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-2">
            {monthHoldsToday && earlierGroups.length > 0 && (
                <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    onClick={() => setShowEarlier((value) => !value)}
                    aria-expanded={showEarlier}
                    className="self-start"
                >
                    {showEarlier
                        ? 'Hide earlier days this month'
                        : `Show earlier days this month (${earlierCount} ${earlierCount === 1 ? 'item' : 'items'})`}
                </Button>
            )}
            {shownGroups.map((group) => {
                const isTodayGroup = isSameDay(group.date, today)
                return (
                    <div key={group.date.toISOString()}>
                    <Card className={isTodayGroup ? 'border-primary' : undefined}>
                        {/* A plain card header, not sticky. Each day is its own rounded,
                            overflow-hidden card, so a viewport-offset sticky header
                            (top-14 to clear the mobile chrome) pinned 56px into the card
                            and bisected the first event row. */}
                        <CardHeader
                            title={isTodayGroup ? 'Today' : format(group.date, 'EEEE d MMMM')}
                            className={isTodayGroup ? 'border-primary bg-primary-soft' : 'bg-surface-2'}
                        />
                        {(() => {
                            const iso = format(group.date, 'yyyy-MM-dd')
                            const covers = dailyOps?.coversByDate[iso] ?? 0
                            const hireGuests = dailyOps?.hireGuestsByDate?.[iso] ?? 0
                            const staff = dailyOps?.staffByDate[iso] ?? []
                            if (covers === 0 && hireGuests === 0 && staff.length === 0) return null
                            return (
                                <p className="text-meta leading-snug text-text-muted px-3 py-1 border-b border-border">
                                    {covers > 0 && (
                                        <span>{covers} cover{covers === 1 ? '' : 's'} booked</span>
                                    )}
                                    {covers > 0 && hireGuests > 0 && <span aria-hidden> · </span>}
                                    {hireGuests > 0 && (
                                        <span>{hireGuests} guest{hireGuests === 1 ? '' : 's'} at private hires</span>
                                    )}
                                    {(covers > 0 || hireGuests > 0) && staff.length > 0 && <span aria-hidden> · </span>}
                                    {staff.length > 0 && <span>Working: {staff.join(', ')}</span>}
                                </p>
                            )
                        })()}
                        {group.entries.length === 0 && isTodayGroup && (
                            <Empty size="sm" title="No entries today" />
                        )}
                        {group.entries.length > 0 && (
                            <ul className="space-y-1 p-1">
                                {group.entries.map((entry) => {
                                    const isPastEntry = isPast(entry.end) && !isTodayGroup
                                    const isCancelled = entry.status === 'cancelled'
                                    const lightText = !isCancelled && calendarColourNeedsLightText(entry.color)
                                    // Secondary text on the entry's own colour: the light or dark
                                    // text colour, softened.
                                    const secondaryTextClass = lightText ? 'text-on-dark-muted' : 'opacity-70'
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
                                                    <span className={cn('ml-2 text-2xs', secondaryTextClass)}>+1 day</span>
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
                                                        <Badge key={gap} size="sm">
                                                            {CONTENT_GAP_LABELS[gap]}
                                                        </Badge>
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
                                                (isPastEntry || entry.muted) && 'opacity-70'
                                            )}
                                            style={{
                                                borderColor: isCancelled ? CALENDAR_BLACK : entry.color,
                                                backgroundColor: isCancelled ? CALENDAR_WHITE : entry.color,
                                                color: lightText ? CALENDAR_WHITE : CALENDAR_BLACK,
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
                                                        // Preserve modifier clicks so a real
                                                        // link still opens in a new tab.
                                                        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return
                                                        ev.preventDefault()
                                                        onEntryClick(entry)
                                                    }}
                                                    className="block flex-1 rounded-sm focus-visible:outline-hidden focus-visible:shadow-ring"
                                                    title={entryTooltipText(entry)}
                                                >
                                                    {details}
                                                </a>
                                            ) : onEntryClick ? (
                                                // Entries without an href (calendar notes) used to
                                                // render as an inert div, so they could not be
                                                // opened at all in this view. A raw button: the
                                                // entry's multi-line details are the control, which
                                                // a DS Button (one line, fixed height) cannot hold.
                                                <button
                                                    type="button"
                                                    onClick={() => onEntryClick(entry)}
                                                    className="block min-w-0 flex-1 rounded-sm text-left focus-visible:outline-hidden focus-visible:shadow-ring"
                                                    title={entryTooltipText(entry)}
                                                >
                                                    {details}
                                                </button>
                                            ) : (
                                                <div className="min-w-0 flex-1" title={entryTooltipText(entry)}>
                                                    {details}
                                                </div>
                                            )}
                                            {entry.statusLabel && (
                                                <span
                                                    className={cn(
                                                        'rounded-sm px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide',
                                                        lightText ? 'bg-on-dark-active text-on-dark' : 'bg-text-strong/10 text-text-strong'
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
                    </Card>
                    </div>
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

/**
 * Days an entry should appear on.
 *
 * A multi-day entry used to be grouped on its START date only, so a note or a
 * private hire that began yesterday and runs through today was invisible in the
 * list from day two onwards, including for anyone on a phone, where the list is
 * the only view. The month grid already draws these as a band across every day,
 * so the two views disagreed.
 *
 * Capped so one corrupt or very long row cannot generate thousands of groups.
 */
const MAX_SPAN_DAYS = 400

function startOfDay(date: Date): Date {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return d
}

function daysCovered(entry: CalendarEntry): Date[] {
    const first = startOfDay(entry.start)
    if (!entry.spansMultipleDays) return [first]

    const last = startOfDay(entry.end)
    if (last.getTime() <= first.getTime()) return [first]

    const days: Date[] = []
    const cursor = new Date(first)
    while (cursor.getTime() <= last.getTime() && days.length < MAX_SPAN_DAYS) {
        days.push(new Date(cursor))
        cursor.setDate(cursor.getDate() + 1)
    }
    return days
}

function groupByDate(entries: CalendarEntry[]): DateGroup[] {
    const map = new Map<string, DateGroup>()
    for (const entry of entries) {
        for (const day of daysCovered(entry)) {
            const key = format(day, 'yyyy-MM-dd')
            const bucket = map.get(key)
            if (bucket) {
                bucket.entries.push(entry)
            } else {
                map.set(key, { date: day, entries: [entry] })
            }
        }
    }
    return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
}
