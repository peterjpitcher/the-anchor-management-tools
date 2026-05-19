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
  type MileageTrip,
  type MileageDestination,
} from '@/app/actions/mileage'
import type { TaxYearStats } from '@/lib/mileage/hmrcRates'
import { TripForm } from './TripForm'
import { formatDateInLondon } from '@/lib/dateUtils'
import { useSort } from '@/hooks/useSort'
import { SortableHeader } from '@/ds'
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  MapPinIcon,
  ArrowPathIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline'

interface MileageClientProps {
  initialTrips: MileageTrip[]
  initialStats: TaxYearStats
  destinations: MileageDestination[]
  canManage: boolean
}

function formatCurrency(amount: number): string {
  return `£${amount.toFixed(2)}`
}

export function MileageClient({
  initialTrips,
  initialStats,
  destinations,
  canManage,
}: MileageClientProps): React.JSX.Element {
  const searchParams = useSearchParams()
  const [trips, setTrips] = useState(initialTrips)
  const [stats, setStats] = useState(initialStats)
  const [isPending, startTransition] = useTransition()

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

  const refreshMileage = useCallback(
    (filters?: { dateFrom?: string; dateTo?: string }) => {
      startTransition(async () => {
        const [tripsResult, statsResult] = await Promise.all([
          getTrips({
            dateFrom: filters?.dateFrom || undefined,
            dateTo: filters?.dateTo || undefined,
          }),
          getTripStats(),
        ])
        if (tripsResult.data) {
          setTrips(tripsResult.data)
        }
        if (statsResult.data) {
          setStats(statsResult.data)
        }
      })
    },
    []
  )

  const refreshTrips = useCallback(
    (filters?: { dateFrom?: string; dateTo?: string }) => {
      startTransition(async () => {
        const result = await getTrips({
          dateFrom: filters?.dateFrom || undefined,
          dateTo: filters?.dateTo || undefined,
        })
        if (result.data) {
          setTrips(result.data)
        }
      })
    },
    []
  )

  // Apply URL search params as initial filters on mount
  useEffect(() => {
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (from || to) {
      setShowFilters(true)
      refreshTrips({ dateFrom: from ?? undefined, dateTo: to ?? undefined })
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
    refreshMileage({ dateFrom, dateTo })
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
      refreshMileage({ dateFrom, dateTo })
    })
  }

  function applyFilters(): void {
    refreshTrips({ dateFrom, dateTo })
  }

  function clearFilters(): void {
    setDateFrom('')
    setDateTo('')
    refreshTrips()
  }

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
              ? `${stats.milesToThreshold.toLocaleString()} mi left at £0.45`
              : 'Now at reduced rate (£0.25/mi)'
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
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowPathIcon className="h-4 w-4" />}
          onClick={() => refreshTrips({ dateFrom, dateTo })}
          loading={isPending}
        >
          Refresh
        </Button>
      </div>

      {/* Filter row */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-1 p-4">
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
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                label="Date"
                column="date"
                currentColumn={tripSort.column}
                currentDirection={tripSort.direction}
                onSort={toggleTripSort}
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted"
              />
              <SortableHeader
                label="Route"
                column="route"
                currentColumn={tripSort.column}
                currentDirection={tripSort.direction}
                onSort={toggleTripSort}
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted"
              />
              <SortableHeader
                label="Miles"
                column="miles"
                currentColumn={tripSort.column}
                currentDirection={tripSort.direction}
                onSort={toggleTripSort}
                className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted"
              />
              <SortableHeader
                label="Rate"
                column="rate"
                currentColumn={tripSort.column}
                currentDirection={tripSort.direction}
                onSort={toggleTripSort}
                className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted"
              />
              <SortableHeader
                label="Amount"
                column="amount"
                currentColumn={tripSort.column}
                currentDirection={tripSort.direction}
                onSort={toggleTripSort}
                className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted"
              />
              <SortableHeader
                label="Source"
                column="source"
                currentColumn={tripSort.column}
                currentDirection={tripSort.direction}
                onSort={toggleTripSort}
                className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-text-muted"
              />
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
                    {hasMixedRates ? 'Mixed' : trip.milesAtReducedRate > 0 ? '£0.25' : '£0.45'}
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
