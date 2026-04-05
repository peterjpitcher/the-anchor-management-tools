'use client'

import { useState, useTransition, useCallback, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { ConfirmModal } from '@/components/ui-v2/overlay/Modal'
import {
  getTrips,
  deleteTrip,
  type MileageTrip,
  type MileageDestination,
} from '@/app/actions/mileage'
import type { TaxYearStats } from '@/lib/mileage/hmrcRates'
import { TripForm } from './TripForm'
import { formatDateInLondon } from '@/lib/dateUtils'
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
  return `\u00A3${amount.toFixed(2)}`
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

  // Filter state — initialised from URL search params if present
  const [showFilters, setShowFilters] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') ?? '')
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') ?? '')

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
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    refreshTrips({ dateFrom, dateTo })
    // Stats will be stale — refresh the page
    // We could fetch stats separately but revalidatePath should handle it
  }

  function handleDelete(): void {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteTrip(deleteTarget.id)
      if (result.error) {
        setDeleteError(result.error)
        return
      }
      setTrips((prev) => prev.filter((t) => t.id !== deleteTarget.id))
      setDeleteTarget(null)
      setDeleteError(null)
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
        <StatCard
          label="This Quarter"
          miles={stats.quarterTotalMiles}
          amount={stats.quarterAmountDue}
        />
        <StatCard
          label="Tax Year Total"
          miles={stats.taxYearTotalMiles}
          amount={stats.taxYearAmountDue}
        />
        <StatCard
          label="Miles to Threshold"
          miles={stats.milesToThreshold}
          subtitle={
            stats.milesToThreshold > 0
              ? `${stats.milesToThreshold.toLocaleString()} mi left at \u00A30.45`
              : 'Now at reduced rate (\u00A30.25/mi)'
          }
          variant={stats.milesToThreshold === 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="primary" size="sm" leftIcon={<PlusIcon />} onClick={openNewTrip}>
              New Trip
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<FunnelIcon />}
            onClick={() => setShowFilters(!showFilters)}
            active={showFilters}
          >
            Filter
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowPathIcon />}
          onClick={() => refreshTrips({ dateFrom, dateTo })}
          loading={isPending}
        >
          Refresh
        </Button>
      </div>

      {/* Filter row */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <div>
            <label htmlFor="filter-from" className="block text-xs font-medium text-gray-500 mb-1">
              From
            </label>
            <Input
              id="filter-from"
              type="date"
              inputSize="sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="filter-to" className="block text-xs font-medium text-gray-500 mb-1">
              To
            </label>
            <Input
              id="filter-to"
              type="date"
              inputSize="sm"
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
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <MapPinIcon className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            No trips recorded yet. Add your first trip to start tracking mileage.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Route
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Miles
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Rate
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Amount
                </th>
                <th scope="col" className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                  Source
                </th>
                {canManage && (
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {trips.map((trip) => {
                const isOjProjects = trip.source === 'oj_projects'
                const hasMixedRates = trip.milesAtStandardRate > 0 && trip.milesAtReducedRate > 0
                return (
                  <tr key={trip.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                      {formatDateInLondon(trip.tripDate, {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-sm text-gray-600" title={trip.routeSummary}>
                      {trip.routeSummary}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">
                      {trip.totalMiles.toFixed(1)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                      {hasMixedRates ? 'Mixed' : trip.milesAtReducedRate > 0 ? '\u00A30.25' : '\u00A30.45'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">
                      {formatCurrency(trip.amountDue)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <span
                        className={
                          isOjProjects
                            ? 'inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700'
                            : 'inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600'
                        }
                      >
                        {isOjProjects ? 'OJ Projects' : 'Manual'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {!isOjProjects && (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="xs"
                              iconOnly
                              aria-label={`Edit trip on ${trip.tripDate}`}
                              onClick={() => openEditTrip(trip)}
                            >
                              <PencilSquareIcon className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              iconOnly
                              aria-label={`Delete trip on ${trip.tripDate}`}
                              onClick={() => { setDeleteError(null); setDeleteTarget(trip) }}
                            >
                              <TrashIcon className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
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
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Trip"
        message={`Are you sure you want to delete the trip on ${deleteTarget?.tripDate ?? ''}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={isPending}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  miles,
  amount,
  subtitle,
  variant = 'default',
}: {
  label: string
  miles: number
  amount?: number
  subtitle?: string
  variant?: 'default' | 'warning'
}): React.JSX.Element {
  return (
    <div
      className={`rounded-lg border p-4 ${
        variant === 'warning'
          ? 'border-amber-200 bg-amber-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{miles.toFixed(1)} mi</p>
      {amount != null && (
        <p className="text-sm text-gray-600">{formatCurrency(amount)}</p>
      )}
      {subtitle && (
        <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
      )}
    </div>
  )
}
