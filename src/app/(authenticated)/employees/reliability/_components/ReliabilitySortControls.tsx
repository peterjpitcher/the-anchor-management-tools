'use client'

import { useRouter } from 'next/navigation'
import { Select, TableHead } from '@/ds'
import type { TeamReliabilitySort } from '@/services/employee-reliability'
import { RELIABILITY_SORT_OPTIONS, reliabilitySortHref } from '../_shared/sort'

interface ReliabilitySortProps {
  activeSort: TeamReliabilitySort
  includeFormer: boolean
}

/**
 * A leaderboard column header that sorts the table: the DS sortable TableHead (a real button,
 * with aria-sort on the header), which loads the leaderboard sorted by this column.
 */
export function ReliabilitySortHead({
  sort,
  activeSort,
  includeFormer,
}: ReliabilitySortProps & { sort: TeamReliabilitySort }): React.JSX.Element {
  const router = useRouter()
  const option = RELIABILITY_SORT_OPTIONS.find((candidate) => candidate.sort === sort)
  return (
    <TableHead
      sortable
      sortDirection={sort === activeSort ? (option?.direction ?? 'desc') : null}
      onSort={() => router.push(reliabilitySortHref(sort, includeFormer))}
    >
      {option?.label ?? sort}
    </TableHead>
  )
}

/** Phones have no table headers, so the same sort orders are a select above the list. */
export function ReliabilitySortSelect({ activeSort, includeFormer }: ReliabilitySortProps): React.JSX.Element {
  const router = useRouter()
  return (
    <Select
      id="reliability-sort"
      label="Sort by"
      value={activeSort}
      onChange={(event) => router.push(reliabilitySortHref(event.target.value as TeamReliabilitySort, includeFormer))}
      options={RELIABILITY_SORT_OPTIONS.map((option) => ({ value: option.sort, label: option.label }))}
    />
  )
}
