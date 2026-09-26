import type { TeamReliabilitySort } from '@/services/employee-reliability'

/**
 * The reliability leaderboard's sort orders. The server sorts (getTeamReliabilityLeaderboard) and
 * the choice lives in the URL, so the page and its sort controls share this list. Pure module,
 * safe to import from server and client components.
 *
 * Each order runs one way only, best first: a higher score or manual accept rate, and a lower
 * reject rate, Couldn't Work count or late holiday count.
 */
export interface ReliabilitySortOption {
  sort: TeamReliabilitySort
  label: string
  direction: 'asc' | 'desc'
}

export const RELIABILITY_SORT_OPTIONS: readonly ReliabilitySortOption[] = [
  { sort: 'score', label: 'Score', direction: 'desc' },
  { sort: 'manual_accept_rate', label: 'Manual accept', direction: 'desc' },
  { sort: 'rejection_rate', label: 'Reject rate', direction: 'asc' },
  { sort: 'couldnt_work', label: "Couldn't Work", direction: 'asc' },
  { sort: 'late_holidays', label: 'Late holidays', direction: 'asc' },
]

export function normalizeReliabilitySort(value: string | string[] | undefined): TeamReliabilitySort {
  const raw = Array.isArray(value) ? value[0] : value
  return RELIABILITY_SORT_OPTIONS.find((option) => option.sort === raw)?.sort ?? 'score'
}

/** The leaderboard sorted by `sort`, keeping the Include Former choice. */
export function reliabilitySortHref(sort: TeamReliabilitySort, includeFormer: boolean): string {
  const params = new URLSearchParams({ sort })
  if (includeFormer) params.set('includeFormer', '1')
  return `/employees/reliability?${params.toString()}`
}
