'use client'

import { useState, type ReactNode } from 'react'
import { addMonths, subMonths, format } from 'date-fns'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Button, Segmented, SHELL_MEDIA_QUERY } from '@/ds'
import { cn } from '@/lib/utils'
import { ScheduleCalendarMonth } from './ScheduleCalendarMonth'
import { ScheduleCalendarList } from './ScheduleCalendarList'
import type { CalendarEntry, CalendarEntryKind, ScheduleCalendarView, ScheduleDailyOps } from './types'
import { kindColor, kindLabel } from './appearance'

export interface ScheduleCalendarProps {
    entries: CalendarEntry[]
    view: ScheduleCalendarView
    onViewChange: (view: ScheduleCalendarView) => void
    canCreateCalendarNote?: boolean
    onEmptyDayClick?: (date: Date) => void
    onEntryClick?: (entry: CalendarEntry) => void
    renderTooltip?: (entry: CalendarEntry) => ReactNode
    firstDayOfWeek?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    legendKinds?: CalendarEntryKind[]
    dailyOps?: ScheduleDailyOps
    /**
     * Controlled month. Lifted so the owner can scope filter counts to the month
     * actually on screen, and keep it in the URL. Falls back to internal state
     * when not supplied.
     */
    anchor?: Date
    onAnchorChange?: (anchor: Date) => void
    /** Unfiltered entries, so closed days survive a filter. */
    closureEntries?: CalendarEntry[]
    className?: string
}

const CALENDAR_VIEW_OPTIONS: { id: ScheduleCalendarView; label: string }[] = [
    { id: 'month', label: 'Month' },
    { id: 'list', label: 'List' },
]

export function ScheduleCalendar({
    entries,
    view,
    onViewChange,
    canCreateCalendarNote,
    onEmptyDayClick,
    onEntryClick,
    renderTooltip,
    firstDayOfWeek = 1,
    legendKinds,
    dailyOps,
    anchor: controlledAnchor,
    onAnchorChange,
    closureEntries,
    className,
}: ScheduleCalendarProps) {
    const [uncontrolledAnchor, setUncontrolledAnchor] = useState<Date>(() => new Date())
    const anchor = controlledAnchor ?? uncontrolledAnchor
    const setAnchor = (next: Date | ((current: Date) => Date)) => {
        const value = typeof next === 'function' ? next(anchor) : next
        if (onAnchorChange) onAnchorChange(value)
        else setUncontrolledAnchor(value)
    }
    // Phone layout wherever the app shell is in its phone layout.
    const isMobile = useMediaQuery(SHELL_MEDIA_QUERY)

    const effectiveView: ScheduleCalendarView = isMobile ? 'list' : view

    function goPrev() {
        if (effectiveView === 'month') setAnchor((d) => subMonths(d, 1))
    }
    function goNext() {
        if (effectiveView === 'month') setAnchor((d) => addMonths(d, 1))
    }
    function goToday() {
        setAnchor(new Date())
    }

    return (
        <div className={cn('flex flex-col gap-3', className)}>
            {/* Controls + switcher */}
            <div className="flex items-center gap-2 flex-wrap">
                {!isMobile && effectiveView !== 'list' && (
                    <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" type="button" onClick={goPrev} aria-label="Previous">
                            {'\u2039'}
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={goToday}>
                            Today
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={goNext} aria-label="Next">
                            {'\u203A'}
                        </Button>
                        <span className="ml-2 text-sm font-medium">{format(anchor, 'MMMM yyyy')}</span>
                    </div>
                )}
                <div className="flex-1" />
                {!isMobile && (
                    <div role="group" aria-label="Calendar view">
                        <Segmented
                            size="sm"
                            options={CALENDAR_VIEW_OPTIONS}
                            value={view}
                            onChange={(id) => onViewChange(id as ScheduleCalendarView)}
                        />
                    </div>
                )}
            </div>

            {/* Legend, hidden on mobile to keep the schedule compact */}
            {!isMobile && legendKinds && legendKinds.length > 0 && (
                <div className="flex items-center gap-3 text-meta text-text-muted">
                    {legendKinds.map((k) => (
                        <span key={k} className="flex items-center gap-1">
                            <span
                                className="inline-block w-2 h-2 rounded-sm"
                                style={{ background: kindColor(k) }}
                            />
                            {kindLabel(k)}
                        </span>
                    ))}
                </div>
            )}

            {/* View */}
            {effectiveView === 'month' && (
                <ScheduleCalendarMonth
                    entries={entries}
                    anchor={anchor}
                    firstDayOfWeek={firstDayOfWeek}
                    onEntryClick={onEntryClick}
                    onEmptyDayClick={canCreateCalendarNote ? onEmptyDayClick : undefined}
                    renderTooltip={renderTooltip}
                    dailyOps={dailyOps}
                    closureEntries={closureEntries}
                />
            )}
            {effectiveView === 'list' && (
                <ScheduleCalendarList
                    entries={entries}
                    onEntryClick={onEntryClick}
                    hidePast={isMobile}
                    dailyOps={dailyOps}
                    renderTooltip={renderTooltip}
                />
            )}
        </div>
    )
}
