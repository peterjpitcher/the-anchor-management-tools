'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/ds'
import {
    CONTENT_GAP_LABELS,
    EMPTY_CALENDAR_FILTERS,
    isFilterActive,
    type CalendarContentGap,
    type CalendarFilters,
} from './filters'
import type { CalendarEntryKind } from './types'
import { kindColor, kindLabel } from './ScheduleCalendar'

interface CalendarFilterBarProps {
    filters: CalendarFilters
    onChange: (filters: CalendarFilters) => void
    /** Only the kinds actually present and permitted, so the bar never offers an empty filter. */
    availableKinds: CalendarEntryKind[]
    /** Shown next to the reset control so the effect of a filter is obvious. */
    shownCount: number
    totalCount: number
    className?: string
}

const GAPS: CalendarContentGap[] = ['image', 'brief', 'description']

function Chip({
    active,
    onClick,
    children,
    swatch,
}: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
    swatch?: string
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                // 44px min height: this bar is used on the iPad behind the bar.
                'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 sm:py-1.5',
                active
                    ? 'border-primary bg-primary text-primary-fg'
                    : 'border-border bg-surface text-text hover:bg-surface-hover'
            )}
        >
            {swatch && (
                <span
                    className="inline-block h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: swatch }}
                    aria-hidden="true"
                />
            )}
            {children}
        </button>
    )
}

export function CalendarFilterBar({
    filters,
    onChange,
    availableKinds,
    shownCount,
    totalCount,
    className,
}: CalendarFilterBarProps) {
    const active = isFilterActive(filters)

    function toggleKind(kind: CalendarEntryKind) {
        const next = filters.kinds.includes(kind)
            ? filters.kinds.filter((k) => k !== kind)
            : [...filters.kinds, kind]
        onChange({ ...filters, kinds: next })
    }

    function toggleGap(gap: CalendarContentGap) {
        const next = filters.missing.includes(gap)
            ? filters.missing.filter((g) => g !== gap)
            : [...filters.missing, gap]
        onChange({ ...filters, missing: next })
    }

    return (
        <div className={cn('flex flex-col gap-2 rounded-md border border-border bg-surface p-3', className)}>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-text-muted">Show</span>
                {availableKinds.map((kind) => (
                    <Chip
                        key={kind}
                        active={filters.kinds.includes(kind)}
                        onClick={() => toggleKind(kind)}
                        swatch={kindColor(kind)}
                    >
                        {kindLabel(kind)}
                    </Chip>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-text-muted">Needs</span>
                {GAPS.map((gap) => (
                    <Chip key={gap} active={filters.missing.includes(gap)} onClick={() => toggleGap(gap)}>
                        {CONTENT_GAP_LABELS[gap]}
                    </Chip>
                ))}
                <Chip
                    active={filters.hideCancelled}
                    onClick={() => onChange({ ...filters, hideCancelled: !filters.hideCancelled })}
                >
                    Hide cancelled
                </Chip>
            </div>

            {active && (
                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
                    <span className="text-xs text-text-muted">
                        Showing {shownCount} of {totalCount}
                    </span>
                    <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => onChange(EMPTY_CALENDAR_FILTERS)}
                    >
                        Clear filters
                    </Button>
                </div>
            )}
        </div>
    )
}
