'use client'

import { useMemo, useState } from 'react'

export type SortDirection = 'asc' | 'desc'

export interface SortState<K extends string = string> {
  column: K
  direction: SortDirection
}

/**
 * Generic sorting hook for client-side table column sorting.
 * Returns sorted data and a toggle handler for column headers.
 */
export function useSort<T, K extends string = string>(
  data: T[],
  defaultColumn: K,
  defaultDirection: SortDirection,
  comparators: Record<K, (a: T, b: T) => number>
): {
  sortedData: T[]
  sort: SortState<K>
  toggleSort: (column: string) => void
} {
  const [sort, setSort] = useState<SortState<K>>({
    column: defaultColumn,
    direction: defaultDirection,
  })

  const sortedData = useMemo(() => {
    const comparator = comparators[sort.column]
    if (!comparator) return data
    const sorted = [...data].sort(comparator)
    return sort.direction === 'desc' ? sorted.reverse() : sorted
  }, [data, sort, comparators])

  function toggleSort(column: string): void {
    setSort((prev) => ({
      column: column as K,
      direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  return { sortedData, sort, toggleSort }
}
