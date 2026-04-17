'use client'

import { useState, type ReactNode } from 'react'
import { addMonths, addWeeks, subMonths, subWeeks, format } from 'date-fns'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Button } from '@/components/ui-v2/forms/Button'
import { cn } from '@/lib/utils'
import { ScheduleCalendarMonth } from './ScheduleCalendarMonth'
import { ScheduleCalendarWeek } from './ScheduleCalendarWeek'
import { ScheduleCalendarList } from './ScheduleCalendarList'
import type { CalendarEntry, CalendarEntryKind, ScheduleCalendarView } from './types'

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
    className?: string
}

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
    className,
}: ScheduleCalendarProps) {
    const [anchor, setAnchor] = useState<Date>(() => new Date())
    const isMobile = useMediaQuery('(max-width: 639px)')

    const effectiveView: ScheduleCalendarView = isMobile ? 'list' : view

    function goPrev() {
        if (effectiveView === 'month') setAnchor((d) => subMonths(d, 1))
        else if (effectiveView === 'week') setAnchor((d) => subWeeks(d, 1))
    }
    function goNext() {
        if (effectiveView === 'month') setAnchor((d) => addMonths(d, 1))
        else if (effectiveView === 'week') setAnchor((d) => addWeeks(d, 1))
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
                        <span className="ml-2 text-sm font-medium">
                            {effectiveView === 'month'
                                ? format(anchor, 'MMMM yyyy')
                                : `Week of ${format(anchor, 'd MMM yyyy')}`}
                        </span>
                    </div>
                )}
                <div className="flex-1" />
                {!isMobile && (
                    <div className="flex bg-muted rounded-md p-1 gap-1" role="group" aria-label="Calendar view">
                        {(['month', 'week', 'list'] as ScheduleCalendarView[]).map((v) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => onViewChange(v)}
                                className={cn(
                                    'px-3 py-1 text-xs rounded-sm capitalize',
                                    view === v
                                        ? 'bg-background shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                {v}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Legend */}
            {legendKinds && legendKinds.length > 0 && (
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
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
                />
            )}
            {effectiveView === 'week' && (
                <ScheduleCalendarWeek
                    entries={entries}
                    anchor={anchor}
                    firstDayOfWeek={firstDayOfWeek}
                    onEntryClick={onEntryClick}
                    renderTooltip={renderTooltip}
                />
            )}
            {effectiveView === 'list' && (
                <ScheduleCalendarList entries={entries} onEntryClick={onEntryClick} />
            )}
        </div>
    )
}

function kindColor(k: CalendarEntryKind): string {
    const map: Record<CalendarEntryKind, string> = {
        event: '#22c55e',
        private_booking: '#8b5cf6',
        calendar_note: '#0ea5e9',
        parking: '#14b8a6',
    }
    return map[k]
}

function kindLabel(k: CalendarEntryKind): string {
    const map: Record<CalendarEntryKind, string> = {
        event: 'Events',
        private_booking: 'Private bookings',
        calendar_note: 'Calendar notes',
        parking: 'Parking',
    }
    return map[k]
}
