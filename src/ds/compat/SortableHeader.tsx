/**
 * SortableHeader: backward-compatible wrapper for sortable table headers
 * @deprecated Use ds/DataTable column.sortable instead
 */

import { cn } from '@/lib/utils'
import { Icon } from '../icons'

interface SortableHeaderProps {
  label: string
  sortKey?: string
  /** @deprecated Use `sortKey` instead */
  column?: string
  currentSort?: string
  /** @deprecated Use `currentSort` instead */
  currentColumn?: string
  currentDirection?: 'asc' | 'desc'
  onSort?: (key: string) => void
  className?: string
}

export function SortableHeader({
  label,
  sortKey,
  column,
  currentSort,
  currentColumn,
  currentDirection,
  onSort,
  className,
}: SortableHeaderProps) {
  const resolvedKey = sortKey ?? column ?? ''
  const resolvedCurrentSort = currentSort ?? currentColumn
  const isActive = resolvedCurrentSort === resolvedKey
  return (
    <button
      type="button"
      onClick={() => onSort?.(resolvedKey)}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider',
        'text-text-muted hover:text-text transition-colors',
        // Inset ring, as DataTable headers: a scrolling table would clip an outer one (A8).
        'focus-visible:outline-hidden focus-visible:shadow-ring-inset',
        isActive && 'text-text',
        className,
      )}
    >
      {label}
      <Icon
        name={isActive && currentDirection === 'asc' ? 'chevronUp' : 'chevronDown'}
        size={12}
        className="ml-1"
      />
    </button>
  )
}
