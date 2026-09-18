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
  /** Classes for the header cell: padding, alignment, and responsive display such as `hidden sm:table-cell`. */
  className?: string
}

/**
 * A `<th>` holding the sort button, so it can sit straight inside a `<tr>`. A bare button
 * there is invalid HTML: browsers bundled the buttons into the first column, screen readers
 * found no column headers, and React reported a hydration error (18 Sep 2026).
 */
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
  // Matches DataTable: 'none' on the columns that can sort but are not the current sort.
  const ariaSort = isActive ? (currentDirection === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th scope="col" aria-sort={ariaSort} className={className}>
      <button
        type="button"
        onClick={() => onSort?.(resolvedKey)}
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider',
          'text-text-muted hover:text-text transition-colors',
          // Inset ring, as DataTable headers: a scrolling table would clip an outer one (A8).
          'focus-visible:outline-hidden focus-visible:shadow-ring-inset',
          isActive && 'text-text',
        )}
      >
        {label}
        <Icon
          name={isActive && currentDirection === 'asc' ? 'chevronUp' : 'chevronDown'}
          size={12}
          className="ml-1"
        />
      </button>
    </th>
  )
}
