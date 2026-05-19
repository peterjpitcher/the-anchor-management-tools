/**
 * SortableHeader — backward-compatible wrapper for sortable table headers
 * @deprecated Use ds/DataTable column.sortable instead
 */

import { cn } from '@/lib/utils'

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

const SortArrow = ({ direction }: { direction?: 'asc' | 'desc' }) => (
  <svg className="w-3 h-3 ml-1 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    {direction === 'asc' ? (
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    ) : direction === 'desc' ? (
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    ) : (
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
    )}
  </svg>
)

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
      <SortArrow direction={isActive ? currentDirection : undefined} />
    </button>
  )
}
