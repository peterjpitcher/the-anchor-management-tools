'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  Empty,
  Input,
  Select,
  Spinner,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { getMaintenanceCosts, getMaintenanceItems } from '@/app/actions/maintenance'
import type { MaintenanceListCursor } from '@/services/maintenance'
import {
  MAINTENANCE_KINDS,
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_RESPONSIBILITIES,
  MAINTENANCE_RESPONSIBILITY_LABELS,
  MAINTENANCE_STATUSES,
  MAINTENANCE_STATUS_LABELS,
  isMaintenanceItemOverdue,
  type MaintenanceArea,
  type MaintenanceCostSummary,
  type MaintenanceItem,
} from '@/types/maintenance'
import {
  DEFAULT_MAINTENANCE_FILTERS,
  MAINTENANCE_FILTERS_STORAGE_KEY,
  hasNarrowedMaintenanceFilters,
  maintenanceFiltersToInput,
  maintenanceFiltersToQuery,
  parseMaintenanceFilters,
  type MaintenanceFilterState,
  type MaintenanceStatusFilter,
} from './maintenanceFilters'
import {
  MAINTENANCE_PRIORITY_TONES,
  MAINTENANCE_RESPONSIBILITY_TONES,
  MAINTENANCE_STATUS_TONES,
  formatMaintenanceDate,
  formatPounds,
} from './maintenanceDisplay'

export interface MaintenanceListClientProps {
  areas: MaintenanceArea[]
  initialFilters: MaintenanceFilterState
  initialItems: MaintenanceItem[]
  initialNextCursor: MaintenanceListCursor | null
  initialHasMore: boolean
  initialCosts: MaintenanceCostSummary | null
  /** Today in London, resolved on the server so overdue never depends on the device clock. */
  todayIsoDate: string
  /** A load failure from the server render, shown rather than an empty list. */
  initialError?: string | null
}

const SEARCH_DEBOUNCE_MS = 300

const STATUS_FILTER_OPTIONS: Array<{ value: MaintenanceStatusFilter; label: string }> = [
  { value: 'open', label: 'Open only' },
  { value: 'all', label: 'All statuses' },
  ...MAINTENANCE_STATUSES.map(status => ({
    value: status as MaintenanceStatusFilter,
    label: MAINTENANCE_STATUS_LABELS[status],
  })),
]

function readStoredQuery(): string {
  try {
    return window.sessionStorage.getItem(MAINTENANCE_FILTERS_STORAGE_KEY) ?? ''
  } catch {
    // A browser with storage blocked simply does not remember the last view.
    return ''
  }
}

function writeStoredQuery(query: string): void {
  try {
    window.sessionStorage.setItem(MAINTENANCE_FILTERS_STORAGE_KEY, query)
  } catch {
    // Remembering the view is a convenience, never a requirement.
  }
}

export function MaintenanceListClient({
  areas,
  initialFilters,
  initialItems,
  initialNextCursor,
  initialHasMore,
  initialCosts,
  todayIsoDate,
  initialError = null,
}: MaintenanceListClientProps): React.JSX.Element {
  const router = useRouter()
  const pathname = usePathname()

  const [filters, setFilters] = useState<MaintenanceFilterState>(initialFilters)
  const [searchDraft, setSearchDraft] = useState(initialFilters.search)
  const [items, setItems] = useState<MaintenanceItem[]>(initialItems)
  const [cursor, setCursor] = useState<MaintenanceListCursor | null>(initialNextCursor)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [costs, setCosts] = useState<MaintenanceCostSummary | null>(initialCosts)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  const query = maintenanceFiltersToQuery(filters)
  const lastLoadedQuery = useRef(maintenanceFiltersToQuery(initialFilters))
  const requestId = useRef(0)

  // A bare /maintenance means the user navigated here rather than pressing back,
  // so restore whatever they last had set. An explicit query in the URL always
  // wins, and so does a link that deliberately clears the filters.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (typeof window === 'undefined') return
    if (window.location.search) return

    const stored = readStoredQuery()
    if (!stored) return

    const storedFilters = parseMaintenanceFilters(new URLSearchParams(stored))
    if (maintenanceFiltersToQuery(storedFilters) === lastLoadedQuery.current) return

    setFilters(storedFilters)
    setSearchDraft(storedFilters.search)
  }, [])

  // Debounced search. The draft is what the user is typing; it only becomes a
  // filter, and therefore a query, once they pause.
  useEffect(() => {
    if (searchDraft === filters.search) return
    const timer = window.setTimeout(() => {
      setFilters(current => ({ ...current, search: searchDraft }))
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchDraft, filters.search])

  const load = useCallback(
    async (nextFilters: MaintenanceFilterState) => {
      const id = ++requestId.current
      setLoading(true)
      setError(null)

      const input = maintenanceFiltersToInput(nextFilters)
      const [itemsResult, costsResult] = await Promise.all([
        getMaintenanceItems({ filters: input }),
        getMaintenanceCosts(input),
      ])

      // A later request has already answered; drop this one.
      if (id !== requestId.current) return

      if (!itemsResult.success || !itemsResult.data) {
        setError(itemsResult.error ?? 'Could not load the maintenance list.')
        setLoading(false)
        return
      }

      setItems(itemsResult.data.items)
      setCursor(itemsResult.data.nextCursor)
      setHasMore(itemsResult.data.hasMore)
      // A totals failure must not blank the list, so it is reported on its own.
      setCosts(costsResult.success && costsResult.data ? costsResult.data : null)
      setLoading(false)
    },
    []
  )

  // Filters changed: rewrite the URL, remember the view, and reload from the top.
  useEffect(() => {
    if (query === lastLoadedQuery.current) return
    lastLoadedQuery.current = query

    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    writeStoredQuery(query)
    void load(filters)
  }, [query, filters, load, pathname, router])

  // Remember the starting view too, so a first visit that already carries a query
  // is what a later bare visit restores.
  useEffect(() => {
    writeStoredQuery(maintenanceFiltersToQuery(initialFilters))
  }, [initialFilters])

  const handleLoadMore = useCallback(async () => {
    if (!cursor) return
    setLoadingMore(true)
    const result = await getMaintenanceItems({
      filters: maintenanceFiltersToInput(filters),
      cursor,
    })
    setLoadingMore(false)

    if (!result.success || !result.data) {
      setError(result.error ?? 'Could not load any more items.')
      return
    }

    setItems(current => [...current, ...result.data!.items])
    setCursor(result.data.nextCursor)
    setHasMore(result.data.hasMore)
  }, [cursor, filters])

  const update = useCallback(<K extends keyof MaintenanceFilterState>(
    key: K,
    value: MaintenanceFilterState[K]
  ) => {
    setFilters(current => ({ ...current, [key]: value }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_MAINTENANCE_FILTERS)
    setSearchDraft('')
  }, [])

  const narrowed = hasNarrowedMaintenanceFilters(filters)

  return (
    <div className="space-y-4">
      {error && (
        <Alert tone="danger" title="Something went wrong">
          <p>{error}</p>
          <p className="mt-2">
            <Button size="sm" onClick={() => void load(filters)}>
              Try again
            </Button>
          </p>
        </Alert>
      )}

      <section aria-labelledby="maintenance-totals-heading">
        <h2 id="maintenance-totals-heading" className="sr-only">
          Totals
        </h2>
        <Card>
          <CardBody>
            {costs ? (
              <>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <Stat label="Open" value={String(costs.openCount)} hint="Not done or cancelled" />
                  <Stat
                    label="Overdue"
                    value={String(costs.overdueCount)}
                    hint="Target date already passed"
                  />
                  <Stat
                    label="Our open estimate"
                    value={formatPounds(costs.ourOpenEstimate)}
                    hint="Pounds including VAT"
                  />
                  <Stat
                    label="Uncosted"
                    value={String(costs.ourUncostedCount)}
                    hint="Open items of ours with no estimate. Not counted as nil."
                  />
                </div>
                <dl className="mt-4 grid grid-cols-1 gap-2 border-t border-border pt-4 text-[13px] sm:grid-cols-2">
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted">Greene King open estimate</dt>
                    <dd className="text-text">
                      {formatPounds(costs.greeneKingOpenEstimate)}
                      {', '}
                      {costs.greeneKingUncostedCount} uncosted
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted">To confirm open estimate</dt>
                    <dd className="text-text">
                      {formatPounds(costs.toConfirmOpenEstimate)}
                      {', '}
                      {costs.toConfirmUncostedCount} uncosted
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-text-muted">
                  {narrowed
                    ? 'These totals follow the filters you have set. Greene King and to-confirm amounts are shown on their own and are never added to ours.'
                    : 'Greene King and to-confirm amounts are shown on their own and are never added to ours.'}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-text-muted">
                The totals are unavailable at the moment. The list below is unaffected.
              </p>
            )}
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="maintenance-filters-heading">
        <h2 id="maintenance-filters-heading" className="sr-only">
          Filters
        </h2>
        <Card>
          <CardBody>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                label="Search"
                type="search"
                value={searchDraft}
                onChange={event => setSearchDraft(event.target.value)}
                placeholder="Title or reference"
                hint="Searches the title and the reference"
                maxLength={200}
              />
              <Select
                label="Type"
                value={filters.kind}
                onChange={event =>
                  update('kind', event.target.value as MaintenanceFilterState['kind'])
                }
              >
                <option value="">All types</option>
                {MAINTENANCE_KINDS.map(kind => (
                  <option key={kind} value={kind}>
                    {MAINTENANCE_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
              <Select
                label="Status"
                value={filters.status}
                onChange={event => update('status', event.target.value as MaintenanceStatusFilter)}
              >
                {STATUS_FILTER_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Select
                label="Area"
                value={filters.areaId}
                onChange={event => update('areaId', event.target.value)}
              >
                <option value="">All areas</option>
                {areas.map(area => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>
              <Select
                label="Responsibility"
                value={filters.responsibility}
                onChange={event =>
                  update(
                    'responsibility',
                    event.target.value as MaintenanceFilterState['responsibility']
                  )
                }
              >
                <option value="">Anyone</option>
                {MAINTENANCE_RESPONSIBILITIES.map(value => (
                  <option key={value} value={value}>
                    {MAINTENANCE_RESPONSIBILITY_LABELS[value]}
                  </option>
                ))}
              </Select>
              <Select
                label="Priority"
                value={filters.priority}
                onChange={event =>
                  update('priority', event.target.value as MaintenanceFilterState['priority'])
                }
              >
                <option value="">Any priority</option>
                {MAINTENANCE_PRIORITIES.map(value => (
                  <option key={value} value={value}>
                    {MAINTENANCE_PRIORITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Checkbox
                label="Overdue only"
                checked={filters.overdueOnly}
                onChange={checked => update('overdueOnly', checked)}
              />
              {narrowed && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Loading the maintenance list'
          : `Showing ${items.length} item${items.length === 1 ? '' : 's'}${hasMore ? ', more available' : ''}`}
      </p>

      {loading ? (
        <Card>
          <CardBody>
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-muted">
              <Spinner size="md" />
              <span>Loading the list</span>
            </div>
          </CardBody>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardBody>
            {narrowed ? (
              <Empty
                title="Nothing matches those filters"
                description="Try widening the status, area or search."
                action={
                  <Button size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <Empty
                title="Nothing logged yet"
                description="Log the first issue or improvement and it will appear here."
                action={
                  <Link
                    href="/maintenance/new"
                    className="text-[13px] font-medium text-primary underline"
                  >
                    Log an issue
                  </Link>
                }
              />
            )}
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Mobile: one card per item. Same information as the table below it. */}
          <ul className="space-y-3 lg:hidden">
            {items.map(item => {
              const overdue = isMaintenanceItemOverdue(item, todayIsoDate)
              return (
                <li key={item.id}>
                  <Card>
                    <CardBody>
                      <Link
                        href={`/maintenance/${item.id}`}
                        className="text-sm font-semibold text-text underline-offset-2 hover:underline"
                      >
                        {item.title}
                      </Link>
                      <p className="mt-1 text-xs text-text-muted">
                        {item.reference}
                        {', '}
                        {MAINTENANCE_KIND_LABELS[item.kind]}
                        {', '}
                        {item.areaName ?? 'No area'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone={MAINTENANCE_STATUS_TONES[item.status]}>
                          {MAINTENANCE_STATUS_LABELS[item.status]}
                        </Badge>
                        <Badge tone={MAINTENANCE_PRIORITY_TONES[item.priority]}>
                          {MAINTENANCE_PRIORITY_LABELS[item.priority]}
                        </Badge>
                        <Badge tone={MAINTENANCE_RESPONSIBILITY_TONES[item.responsibility]}>
                          {MAINTENANCE_RESPONSIBILITY_LABELS[item.responsibility]}
                        </Badge>
                        {overdue && <Badge tone="danger">Overdue</Badge>}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <dt className="text-text-muted">Target date</dt>
                        <dd className="text-text">{formatMaintenanceDate(item.targetDate)}</dd>
                        <dt className="text-text-muted">Estimate</dt>
                        <dd className="text-text">
                          {item.estimatedCost === null
                            ? 'Not costed'
                            : formatPounds(item.estimatedCost)}
                        </dd>
                      </dl>
                    </CardBody>
                  </Card>
                </li>
              )
            })}
          </ul>

          {/* Desktop: the same rows as a table. */}
          <div className="hidden lg:block">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Responsibility</TableHead>
                    <TableHead>Target date</TableHead>
                    <TableHead>Estimate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => {
                    const overdue = isMaintenanceItemOverdue(item, todayIsoDate)
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className="text-xs text-text-muted">{item.reference}</span>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/maintenance/${item.id}`}
                            className="font-medium text-text underline-offset-2 hover:underline"
                          >
                            {item.title}
                          </Link>
                        </TableCell>
                        <TableCell>{MAINTENANCE_KIND_LABELS[item.kind]}</TableCell>
                        <TableCell>{item.areaName ?? 'No area'}</TableCell>
                        <TableCell>
                          <Badge tone={MAINTENANCE_STATUS_TONES[item.status]}>
                            {MAINTENANCE_STATUS_LABELS[item.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge tone={MAINTENANCE_PRIORITY_TONES[item.priority]}>
                            {MAINTENANCE_PRIORITY_LABELS[item.priority]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge tone={MAINTENANCE_RESPONSIBILITY_TONES[item.responsibility]}>
                            {MAINTENANCE_RESPONSIBILITY_LABELS[item.responsibility]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {formatMaintenanceDate(item.targetDate)}
                          {overdue && (
                            <span className="ml-2">
                              <Badge tone="danger">Overdue</Badge>
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.estimatedCost === null
                            ? 'Not costed'
                            : formatPounds(item.estimatedCost)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button onClick={() => void handleLoadMore()} loading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default MaintenanceListClient
