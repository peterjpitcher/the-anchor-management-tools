'use client'

import { useState, useTransition, useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Button,
  IconButton,
  Input,
  Badge,
  Stat,
  Empty,
  ConfirmDialog,
  TablePagination,
  toast,
} from '@/ds'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/ds'
import {
  getTrips,
  getTripStats,
  deleteTrip,
  exportMileageTripsCsv,
  type MileageTrip,
  type MileageDestination,
} from '@/app/actions/mileage'
import {
  REDUCED_RATE,
  getStandardRate,
  type TaxYearStats,
} from '@/lib/mileage/hmrcRates'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { TripForm } from './TripForm'
import { formatDateInLondon } from '@/lib/dateUtils'
import { useSort } from '@/hooks/useSort'
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  MapPinIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline'

interface MileageClientProps {
  initialTrips: MileageTrip[]
  initialTotal: number
  initialPage: number
  initialPageSize: number
  initialStats: TaxYearStats
  destinations: MileageDestination[]
  canManage: boolean
}

function formatCurrency(amount: number): string {
  return `£${amount.toFixed(2)}`
}

export function MileageClient({
  initialTrips,
  initialTotal,
  initialPage,
  initialPageSize,
  initialStats,
  destinations,
  canManage,
}: MileageClientProps): React.JSX.Element {
  const searchParams = useSearchParams()
  const [trips, setTrips] = useState(initialTrips)
  const [totalTrips, setTotalTrips] = useState(initialTotal)
  const [page, setPage] = useState(initialPage)
  const [pageSize] = useState(initialPageSize)
  const [stats, setStats] = useState(initialStats)
  const [isPending, startTransition] = useTransition()
  const [isExporting, setIsExporting] = useState(false)

  // Trip form state
  const [showTripForm, setShowTripForm] = useState(false)
  const [editingTrip, setEditingTrip] = useState<MileageTrip | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MileageTrip | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------

  type TripSortKey = 'date' | 'route' | 'miles' | 'rate' | 'amount' | 'source'

  const tripComparators = useMemo(
    () => ({
      date: (a: MileageTrip, b: MileageTrip) => a.tripDate.localeCompare(b.tripDate),
      route: (a: MileageTrip, b: MileageTrip) => a.routeSummary.localeCompare(b.routeSummary),
      miles: (a: MileageTrip, b: MileageTrip) => a.totalMiles - b.totalMiles,
      rate: (a: MileageTrip, b: MileageTrip) => a.milesAtStandardRate - b.milesAtStandardRate,
      amount: (a: MileageTrip, b: MileageTrip) => a.amountDue - b.amountDue,
      source: (a: MileageTrip, b: MileageTrip) => a.source.localeCompare(b.source),
    }),
    []
  )

  const {
    sortedData: sortedTrips,
    sort: tripSort,
    toggleSort: toggleTripSort,
  } = useSort<MileageTrip, TripSortKey>(trips, 'date', 'desc', tripComparators)

  // Filter state — initialised from URL search params if present
  const [showFilters, setShowFilters] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') ?? '')
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') ?? '')
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') ?? '')

  const refreshMileage = useCallback(
    (filters?: { dateFrom?: string; dateTo?: string; searchTerm?: string; page?: number }) => {
      startTransition(async () => {
        const requestedPage = filters?.page ?? page
        const [tripsResult, statsResult] = await Promise.all([
          getTrips({
            dateFrom: filters?.dateFrom || undefined,
            dateTo: filters?.dateTo || undefined,
            searchTerm: filters?.searchTerm || undefined,
            page: requestedPage,
            pageSize,
          }),
          getTripStats(),
        ])
        if (tripsResult.data) {
          setTrips(tripsResult.data)
          setTotalTrips(tripsResult.pageInfo?.total ?? tripsResult.data.length)
          setPage(tripsResult.pageInfo?.page ?? requestedPage)
        }
        if (statsResult.data) {
          setStats(statsResult.data)
        }
      })
    },
    [page, pageSize]
  )

  const refreshTrips = useCallback(
    (filters?: { dateFrom?: string; dateTo?: string; searchTerm?: string; page?: number }) => {
      startTransition(async () => {
        const requestedPage = filters?.page ?? page
        const result = await getTrips({
          dateFrom: filters?.dateFrom || undefined,
          dateTo: filters?.dateTo || undefined,
          searchTerm: filters?.searchTerm || undefined,
          page: requestedPage,
          pageSize,
        })
        if (result.data) {
          setTrips(result.data)
          setTotalTrips(result.pageInfo?.total ?? result.data.length)
          setPage(result.pageInfo?.page ?? requestedPage)
        }
      })
    },
    [page, pageSize]
  )

  // Apply URL search params as initial filters on mount
  useEffect(() => {
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const q = searchParams.get('q')
    if (from || to || q) {
      setShowFilters(true)
      refreshTrips({ dateFrom: from ?? undefined, dateTo: to ?? undefined, searchTerm: q ?? undefined, page: 1 })
    }
  }, [])

  function openNewTrip(): void {
    setEditingTrip(null)
    setShowTripForm(true)
  }

  function openEditTrip(trip: MileageTrip): void {
    setEditingTrip(trip)
    setShowTripForm(true)
  }

  function handleTripFormSuccess(): void {
    refreshMileage({ dateFrom, dateTo, searchTerm, page })
  }

  function handleDelete(): void {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteTrip(deleteTarget.id)
      if (result.error) {
        setDeleteError(result.error)
        return
      }
      setDeleteTarget(null)
      setDeleteError(null)
      refreshMileage({ dateFrom, dateTo, searchTerm, page })
    })
  }

  function applyFilters(): void {
    refreshTrips({ dateFrom, dateTo, searchTerm, page: 1 })
  }

  function clearFilters(): void {
    setDateFrom('')
    setDateTo('')
    setSearchTerm('')
    refreshTrips({ page: 1 })
  }

  function handlePageChange(nextPage: number): void {
    refreshTrips({ dateFrom, dateTo, searchTerm, page: nextPage })
  }

  async function handleExport(): Promise<void> {
    setIsExporting(true)
    const result = await exportMileageTripsCsv({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      searchTerm: searchTerm || undefined,
    })
    setIsExporting(false)

    if (result.error || !result.data || !result.filename) {
      toast.error(result.error ?? 'Failed to export mileage trips.')
      return
    }

    const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = result.filename
    link.click()
    URL.revokeObjectURL(url)
    toast.success('Mileage export downloaded.')
  }

  const totalPages = Math.max(1, Math.ceil(totalTrips / pageSize))

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="This Quarter"
          value={`${stats.quarterTotalMiles.toFixed(1)} mi`}
          hint={formatCurrency(stats.quarterAmountDue)}
        />
        <Stat
          label="Tax Year Total"
          value={`${stats.taxYearTotalMiles.toFixed(1)} mi`}
          hint={formatCurrency(stats.taxYearAmountDue)}
        />
        <Stat
          label="Miles to Threshold"
          value={`${stats.milesToThreshold.toFixed(1)} mi`}
          hint={
            stats.milesToThreshold > 0
              ? `${stats.milesToThreshold.toLocaleString()} mi left at £${getStandardRate(getTodayIsoDate()).toFixed(2)}`
              : `Now at reduced rate (£${REDUCED_RATE.toFixed(2)}/mi)`
          }
        />
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="primary" size="sm" icon={<PlusIcon className="h-4 w-4" />} onClick={openNewTrip}>
              New Trip
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<FunnelIcon className="h-4 w-4" />}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filter
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowDownTrayIcon className="h-4 w-4" />}
            onClick={handleExport}
            loading={isExporting}
          >
            Export
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowPathIcon className="h-4 w-4" />}
          onClick={() => refreshTrips({ dateFrom, dateTo, searchTerm, page })}
          loading={isPending}
        >
          Refresh
        </Button>
      </div>

      {/* Filter row */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-1 p-4">
          <div className="min-w-64 flex-1">
            <label htmlFor="filter-search" className="block text-xs font-medium text-text-muted mb-1">
              Search
            </label>
            <Input
              id="filter-search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Route or description"
            />
          </div>
          <div>
            <label htmlFor="filter-from" className="block text-xs font-medium text-text-muted mb-1">
              From
            </label>
            <Input
              id="filter-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="filter-to" className="block text-xs font-medium text-text-muted mb-1">
              To
            </label>
            <Input
              id="filter-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <Button variant="primary" size="sm" onClick={applyFilters}>
            Apply
          </Button>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        </div>
      )}

      {/* Error banner */}
      {deleteError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{deleteError}</div>
      )}

      {/* Trip list */}
      {trips.length === 0 ? (
        <Empty
          icon={<MapPinIcon className="h-12 w-12" />}
          title="No trips recorded"
          description="Add your first trip to start tracking mileage."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table className="[--spacing-row-h:10px] mx-0 px-0">
            <TableHeader>
              <TableRow>
                <TableHead sortable sortDirection={tripSort.column === 'date' ? tripSort.direction : null} onSort={() => toggleTripSort('date')}>Date</TableHead>
                <TableHead sortable sortDirection={tripSort.column === 'route' ? tripSort.direction : null} onSort={() => toggleTripSort('route')}>Route</TableHead>
                <TableHead sortable sortDirection={tripSort.column === 'miles' ? tripSort.direction : null} onSort={() => toggleTripSort('miles')} align="right">Miles</TableHead>
                <TableHead sortable sortDirection={tripSort.column === 'rate' ? tripSort.direction : null} onSort={() => toggleTripSort('rate')} align="right">Rate</TableHead>
                <TableHead sortable sortDirection={tripSort.column === 'amount' ? tripSort.direction : null} onSort={() => toggleTripSort('amount')} align="right">Amount</TableHead>
                <TableHead sortable sortDirection={tripSort.column === 'source' ? tripSort.direction : null} onSort={() => toggleTripSort('source')} align="center">Source</TableHead>
                {canManage && (
                  <TableHead align="right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTrips.map((trip) => {
                const isOjProjects = trip.source === 'oj_projects'
                const hasMixedRates = trip.milesAtStandardRate > 0 && trip.milesAtReducedRate > 0
                return (
                  <TableRow key={trip.id}>
                    <TableCell>
                      {formatDateInLondon(trip.tripDate, {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="block truncate" title={trip.routeSummary}>
                        {trip.routeSummary}
                      </span>
                    </TableCell>
                    <TableCell align="right" className="font-medium">
                      {trip.totalMiles.toFixed(1)}
                    </TableCell>
                    <TableCell align="right">
                      {hasMixedRates
                        ? 'Mixed'
                        : trip.milesAtReducedRate > 0
                          ? `£${REDUCED_RATE.toFixed(2)}`
                          : `£${getStandardRate(trip.tripDate).toFixed(2)}`}
                    </TableCell>
                    <TableCell align="right" className="font-medium">
                      {formatCurrency(trip.amountDue)}
                    </TableCell>
                    <TableCell align="center">
                      <Badge tone={isOjProjects ? 'primary' : 'neutral'}>
                        {isOjProjects ? 'OJ Projects' : 'Manual'}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell align="right">
                        {!isOjProjects && (
                          <div className="flex items-center justify-end gap-1">
                            <IconButton
                              icon={<PencilSquareIcon className="h-4 w-4" />}
                              label={`Edit trip on ${trip.tripDate}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditTrip(trip)}
                            />
                            <IconButton
                              icon={<TrashIcon className="h-4 w-4 text-red-500" />}
                              label={`Delete trip on ${trip.tripDate}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => { setDeleteError(null); setDeleteTarget(trip) }}
                            />
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            totalPages={totalPages}
            totalItems={totalTrips}
            pageSize={pageSize}
            onPageChange={handlePageChange}
          />
        </div>
      )}

      {/* Trip form */}
      <TripForm
        open={showTripForm}
        onClose={() => setShowTripForm(false)}
        onSuccess={handleTripFormSuccess}
        destinations={destinations}
        cumulativeMilesBefore={
          editingTrip
            ? stats.taxYearTotalMiles - editingTrip.totalMiles
            : stats.taxYearTotalMiles
        }
        editingTrip={editingTrip}
      />

      {/* Delete confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          open
          onClose={() => { setDeleteTarget(null); setDeleteError(null) }}
          onConfirm={handleDelete}
          title="Delete Trip"
          message={`Are you sure you want to delete the trip on ${deleteTarget.tripDate}? This cannot be undone.`}
          confirmLabel="Delete"
          tone="danger"
        />
      )}
    </div>
  )
}
