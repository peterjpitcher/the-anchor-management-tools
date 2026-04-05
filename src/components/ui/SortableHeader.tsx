'use client'

import type { SortDirection } from '@/hooks/useSort'

interface SortableHeaderProps {
  label: string
  column: string
  currentColumn: string
  currentDirection: SortDirection
  onSort: (column: string) => void
  className?: string
}

export function SortableHeader({
  label,
  column,
  currentColumn,
  currentDirection,
  onSort,
  className = '',
}: SortableHeaderProps): React.ReactElement {
  const isActive = currentColumn === column

  return (
    <th
      scope="col"
      className={`cursor-pointer select-none hover:bg-gray-100 ${className}`}
      onClick={() => onSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-gray-400">
          {isActive ? (currentDirection === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </span>
    </th>
  )
}
