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
import { kindColor, kindLabel } from './appearance'

interface CalendarFilterBarProps {
    filters: CalendarFilters
    onChange: (filters: CalendarFilters) => void
    /** Only the kinds actually present and permitted, so the bar never offers an empty filter. */
    availableKinds: CalendarEntryKind[]
    /** Shown next to the reset control so the effect of a filter is obvious. */
    shownCount: number
    totalCount: number
    /**
     * How many entries each chip would match, from the UNFILTERED set. This is
     * what turns the bar from a filter into a report: a manager sees that four
     * events need a brief without having to click anything.
     */
    kindCounts?: Partial<Record<CalendarEntryKind, number>>
    gapCounts?: Partial<Record<CalendarContentGap, number>>
    /** What the counts are counting, e.g. "this month" or "the loaded range". */
    countScopeLabel?: string
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
                // Do NOT reintroduce `sm:min-h-0` here. sm: starts at 640px and an
                // iPad is 768px, so it cancelled the target on the one device the
                // comment names.
                'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
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
    kindCounts,
    gapCounts,
    countScopeLabel,
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
                        {kindCounts?.[kind] !== undefined && (
                            <span className="tabular-nums opacity-70">{kindCounts[kind]}</span>
                        )}
                    </Chip>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-text-muted">Needs</span>
                {GAPS.map((gap) => (
                    <Chip key={gap} active={filters.missing.includes(gap)} onClick={() => toggleGap(gap)}>
                        {CONTENT_GAP_LABELS[gap]}
                        {gapCounts?.[gap] !== undefined && (
                            <span className="tabular-nums opacity-70">{gapCounts[gap]}</span>
                        )}
                    </Chip>
                ))}
                <Chip
                    active={filters.hideCancelled}
                    onClick={() => onChange({ ...filters, hideCancelled: !filters.hideCancelled })}
                >
                    Hide cancelled
                </Chip>
                <Chip
                    active={filters.showCancelledPrivateHire}
                    onClick={() =>
                        onChange({
                            ...filters,
                            showCancelledPrivateHire: !filters.showCancelledPrivateHire,
                        })
                    }
                >
                    Show cancelled private hire
                </Chip>
            </div>

            {(active || shownCount !== totalCount) && (
                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
                    {/* Shown even with no filter selected, so the cancelled private hire
                        hidden by default is never dropped without a trace. */}
                    <span className="text-xs text-text-muted">
                        Showing {shownCount} of {totalCount}
                        {countScopeLabel ? ` in ${countScopeLabel}` : ''}
                    </span>
                    {active && (
                        <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={() => onChange(EMPTY_CALENDAR_FILTERS)}
                        >
                            Clear filters
                        </Button>
                    )}
                </div>
            )}
        </div>
    )
}
