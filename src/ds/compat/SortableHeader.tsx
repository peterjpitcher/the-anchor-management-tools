/**
 * SortableHeader — backward-compatible wrapper for sortable table headers
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
        'text-gray-500 hover:text-gray-700 transition-colors',
        isActive && 'text-gray-900',
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
