// The list filters, in one place.
//
// The URL query string is the source of truth: the server page parses it and
// loads the first page from it, the client writes it back on every change, and
// the browser's own back button therefore restores whatever the user had set.
// A copy is also kept in sessionStorage so arriving at /maintenance with a bare
// URL (a nav click, rather than the back button) restores the last view.
//
// This module is imported by both a server component and a client one, so it must
// stay free of React and of anything browser only.

import {
  MAINTENANCE_OPEN_STATUSES,
  isMaintenanceKind,
  isMaintenancePriority,
  isMaintenanceResponsibility,
  isMaintenanceStatus,
  type MaintenanceKind,
  type MaintenancePriority,
  type MaintenanceResponsibility,
  type MaintenanceStatus,
} from '@/types/maintenance'

/**
 * 'all' clears the status filter, 'open' is the six statuses that are not done or
 * cancelled, and anything else is a single status.
 */
export type MaintenanceStatusFilter = 'all' | 'open' | MaintenanceStatus

export interface MaintenanceFilterState {
  kind: MaintenanceKind | ''
  status: MaintenanceStatusFilter
  areaId: string
  responsibility: MaintenanceResponsibility | ''
  priority: MaintenancePriority | ''
  overdueOnly: boolean
  search: string
}

/**
 * The tracker exists to show outstanding work, so the list opens on open items.
 * That is a visible choice, not a hidden one: the status control reads "Open
 * only" and "All statuses" is the next option down.
 */
export const DEFAULT_MAINTENANCE_FILTERS: MaintenanceFilterState = {
  kind: '',
  status: 'open',
  areaId: '',
  responsibility: '',
  priority: '',
  overdueOnly: false,
  search: '',
}

/** The key the last view is remembered under, for a return visit. */
export const MAINTENANCE_FILTERS_STORAGE_KEY = 'maintenance:list-filters'

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function isStatusFilter(value: string): value is MaintenanceStatusFilter {
  return value === 'all' || value === 'open' || isMaintenanceStatus(value)
}

/**
 * Read a filter state out of a query string. Anything unrecognised falls back to
 * the default rather than being passed to the server, so a hand-edited URL can
 * never put an invalid filter in front of the action's validation.
 */
export function parseMaintenanceFilters(
  params: Record<string, string | string[] | undefined> | URLSearchParams
): MaintenanceFilterState {
  const read = (key: string): string =>
    params instanceof URLSearchParams ? (params.get(key) ?? '') : firstValue(params[key])

  const kind = read('kind')
  const status = read('status')
  const areaId = read('area')
  const responsibility = read('responsibility')
  const priority = read('priority')
  const overdue = read('overdue')
  const search = read('q')

  return {
    kind: isMaintenanceKind(kind) ? kind : '',
    status: isStatusFilter(status) ? status : DEFAULT_MAINTENANCE_FILTERS.status,
    areaId: UUID_PATTERN.test(areaId) ? areaId : '',
    responsibility: isMaintenanceResponsibility(responsibility) ? responsibility : '',
    priority: isMaintenancePriority(priority) ? priority : '',
    overdueOnly: overdue === 'true',
    search: search.slice(0, 200),
  }
}

/** The query string for a filter state, without a leading question mark. */
export function maintenanceFiltersToQuery(state: MaintenanceFilterState): string {
  const params = new URLSearchParams()

  if (state.kind) params.set('kind', state.kind)
  if (state.status !== DEFAULT_MAINTENANCE_FILTERS.status) params.set('status', state.status)
  if (state.areaId) params.set('area', state.areaId)
  if (state.responsibility) params.set('responsibility', state.responsibility)
  if (state.priority) params.set('priority', state.priority)
  if (state.overdueOnly) params.set('overdue', 'true')
  if (state.search.trim()) params.set('q', state.search.trim())

  return params.toString()
}

/**
 * The shape the server actions take. Empty selections become undefined so the
 * filter is dropped rather than sent as a blank value.
 */
export interface MaintenanceFilterInput {
  kind?: MaintenanceKind
  statuses?: MaintenanceStatus[]
  areaId?: string
  responsibility?: MaintenanceResponsibility
  priority?: MaintenancePriority
  overdueOnly?: boolean
  search?: string
}

export function maintenanceFiltersToInput(state: MaintenanceFilterState): MaintenanceFilterInput {
  const input: MaintenanceFilterInput = {}

  if (state.kind) input.kind = state.kind
  if (state.status === 'open') {
    input.statuses = [...MAINTENANCE_OPEN_STATUSES]
  } else if (state.status !== 'all') {
    input.statuses = [state.status]
  }
  if (state.areaId) input.areaId = state.areaId
  if (state.responsibility) input.responsibility = state.responsibility
  if (state.priority) input.priority = state.priority
  if (state.overdueOnly) input.overdueOnly = true
  const search = state.search.trim()
  if (search) input.search = search

  return input
}

/** Whether the totals on screen are following anything narrower than the default. */
export function hasNarrowedMaintenanceFilters(state: MaintenanceFilterState): boolean {
  return maintenanceFiltersToQuery(state) !== ''
}

export function areMaintenanceFiltersEqual(
  a: MaintenanceFilterState,
  b: MaintenanceFilterState
): boolean {
  return maintenanceFiltersToQuery(a) === maintenanceFiltersToQuery(b)
}
