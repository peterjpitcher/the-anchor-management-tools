'use client'

import { CALENDAR_FIRST_YEAR, CALENDAR_YEARS_AHEAD } from '@/lib/calendar/month-window'
import { useState, type ReactNode } from 'react'
import { addMonths, subMonths, format } from 'date-fns'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Button, Icon, IconButton, Segmented, Select, SHELL_MEDIA_QUERY } from '@/ds'
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
    /**
     * Laid over the month while it loads or after it failed, with the month dimmed underneath,
     * so an unloaded month never reads as a quiet one.
     */
    overlay?: ReactNode
    /** Earliest year the month picker offers. */
    firstYear?: number
    /** How many years past this one the month picker offers. */
    yearsAhead?: number
    className?: string
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

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
    overlay,
    firstYear = CALENDAR_FIRST_YEAR,
    yearsAhead = CALENDAR_YEARS_AHEAD,
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
        setAnchor((d) => subMonths(d, 1))
    }
    function goNext() {
        setAnchor((d) => addMonths(d, 1))
    }
    function goToday() {
        setAnchor(new Date())
    }

    const lastYear = new Date().getFullYear() + yearsAhead
    const yearOptions = []
    for (let year = firstYear; year <= Math.max(lastYear, anchor.getFullYear()); year += 1) {
        yearOptions.push({ value: String(year), label: String(year) })
    }
    const atFirstMonth = anchor.getFullYear() <= firstYear && anchor.getMonth() === 0
    const atLastMonth = anchor.getFullYear() >= lastYear && anchor.getMonth() === 11

    return (
        <div className={cn('flex flex-col gap-3', className)}>
            {/* Month controls on every view and on phones: the past is always one tap away. */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 flex-wrap">
                    <IconButton
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={goPrev}
                        disabled={atFirstMonth}
                        label="Previous month"
                        icon={<Icon name="chevronLeft" size={16} />}
                    />
                    <Button size="sm" variant="ghost" type="button" onClick={goToday}>
                        Today
                    </Button>
                    <IconButton
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={goNext}
                        disabled={atLastMonth}
                        label="Next month"
                        icon={<Icon name="chevronRight" size={16} />}
                    />
                    {/* Jump straight to any month rather than clicking back one at a time. */}
                    <div className="ml-1 flex items-center gap-1">
                        <Select
                            aria-label="Month"
                            value={String(anchor.getMonth())}
                            onChange={(e) => setAnchor(new Date(anchor.getFullYear(), Number(e.target.value), 1))}
                            options={MONTH_NAMES.map((name, index) => ({ value: String(index), label: name }))}
                        />
                        <Select
                            aria-label="Year"
                            value={String(anchor.getFullYear())}
                            onChange={(e) => setAnchor(new Date(Number(e.target.value), anchor.getMonth(), 1))}
                            options={yearOptions}
                        />
                    </div>
                </div>
                <div className="flex-1" />
                {!isMobile && (
                    <Segmented
                        size="sm"
                        aria-label="Calendar view"
                        options={CALENDAR_VIEW_OPTIONS}
                        value={view}
                        onChange={(id) => onViewChange(id as ScheduleCalendarView)}
                    />
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
            <div className="relative" aria-busy={overlay ? true : undefined}>
                <div className={cn(overlay && 'pointer-events-none opacity-40')}>
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
                            month={anchor}
                            dailyOps={dailyOps}
                            renderTooltip={renderTooltip}
                        />
                    )}
                </div>
                {overlay && (
                    <div className="absolute inset-x-0 top-6 flex justify-center px-4">{overlay}</div>
                )}
            </div>
        </div>
    )
}
