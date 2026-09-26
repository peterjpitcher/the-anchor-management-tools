'use client'

/**
 * The trips page (spec 7.1). The address holds the filters, sort and page; the server page reads it
 * and passes the results in. A filter, sort or page change replaces the address (so Back leaves the
 * page), and a filter or sort change returns to page 1. The headline cards never follow the filters;
 * the results line always does.
 */

import { useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Icon,
  PageLayout,
  PageLoading,
  Stat,
  StatGrid,
  TablePagination,
  toast,
} from '@/ds'
import {
  deleteTrip,
  exportMileageListCsv,
  getTripForEdit,
  type MileageDestination,
  type MileageTrip,
} from '@/app/actions/mileage'
import type { MileageDriver } from '@/app/actions/mileage-drivers'
import { downloadBlob } from '@/lib/download-file'
import type { MileageTripsPageResult } from '@/lib/mileage/list'
import {
  hasActiveFilters,
  ignoredReportFilters,
  MILEAGE_LIST_PAGE_SIZE,
  nextSort,
  serialiseMileageListQuery,
  type MileageListQuery,
} from '@/lib/mileage/list-query'
import type { PeriodPresetGroup } from '@/lib/mileage/period-presets'
import { formatLongDate } from '@/lib/mileage/periods'
import type { MileageReportTrip } from '@/lib/mileage/report/dataset'
import { formatMilesText, formatPoundsText } from '@/lib/mileage/report/format'
import type { MileageHeadlineStats } from '@/lib/mileage/stats'
import { MileageFilters } from './MileageFilters'
import { MileageReportDialog } from './MileageReportDialog'
import { MileageTripCard } from './MileageTripCard'
import { MileageTripTable } from './MileageTripTable'
import { TripForm } from './TripForm'
import { MILEAGE_TRIPS_LAYOUT } from '../_shared/nav'

interface MileageClientProps {
  query: MileageListQuery
  warnings: string[]
  trips: MileageTripsPageResult
  stats: MileageHeadlineStats
  destinations: MileageDestination[]
  drivers: MileageDriver[]
  presets: PeriodPresetGroup[]
  /** Today's London date as YYYY-MM-DD. */
  today: string
  canManage: boolean
}

const EXPORT_FAILED = "Couldn't export the trips. Nothing was downloaded. Try again."
const EDIT_LOAD_FAILED = "Couldn't load the trip. Try again."

function describeResults(totals: MileageTripsPageResult['totals']): string {
  return `${totals.trips} ${totals.trips === 1 ? 'trip' : 'trips'}, ${formatMilesText(totals.milesTenths)} miles, ${formatPoundsText(totals.amountPence)}`
}

function describeMilesLeft(drivers: MileageHeadlineStats['drivers']): string {
  if (drivers.length === 0) return 'No drivers set up'
  return drivers.map((driver) => `${driver.displayName}: ${formatMilesText(driver.standardMilesLeftTenths)} mi`).join(', ')
}

export function MileageClient({
  query,
  warnings,
  trips,
  stats,
  destinations,
  drivers,
  presets,
  today,
  canManage,
}: MileageClientProps): React.JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [isExporting, setIsExporting] = useState(false)
  const [showTripForm, setShowTripForm] = useState(false)
  const [editingTrip, setEditingTrip] = useState<MileageTrip | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MileageReportTrip | null>(null)
  const [showReportDialog, setShowReportDialog] = useState(false)

  const places = destinations
    .filter((destination) => !destination.isHomeBase)
    .map((destination) => ({ id: destination.id, name: destination.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'))
  const filtered = hasActiveFilters(query)
  const totalPages = Math.max(1, Math.ceil(trips.totalCount / MILEAGE_LIST_PAGE_SIZE))

  function navigate(next: MileageListQuery): void {
    const address = serialiseMileageListQuery(next)
    if (address === serialiseMileageListQuery(query)) return
    startTransition(() => {
      router.replace(address ? `${pathname}?${address}` : pathname, { scroll: false })
    })
  }

  function refresh(): void {
    startTransition(() => {
      router.refresh()
    })
  }

  function openNewTrip(): void {
    setEditingTrip(null)
    setShowTripForm(true)
  }

  async function openEditTrip(trip: MileageReportTrip): Promise<void> {
    // OJ Projects trips are edited in OJ Projects; the table and cards offer no edit for them.
    if (trip.source === 'oj_projects') return
    // Load the trip fresh, so the save carries its exact updated_at for the stale-edit check.
    try {
      const result = await getTripForEdit(trip.id)
      if (result.error || !result.data) {
        toast.error(result.error ?? EDIT_LOAD_FAILED)
        return
      }
      setEditingTrip(result.data)
      setShowTripForm(true)
    } catch {
      toast.error(EDIT_LOAD_FAILED)
    }
  }

  /** Throws on failure, so the confirm dialog stays open and shows the reason. */
  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return
    const result = await deleteTrip(deleteTarget.id)
    if (result.error) throw new Error(result.error)
    toast.success('Trip deleted.')
    refresh()
  }

  async function handleExport(): Promise<void> {
    setIsExporting(true)
    try {
      const result = await exportMileageListCsv(query)
      if (result.error || !result.data || !result.filename) {
        toast.error(result.error ?? EXPORT_FAILED)
        return
      }
      downloadBlob(new Blob([result.data], { type: 'text/csv;charset=utf-8' }), result.filename)
      toast.success('Mileage CSV downloaded.')
    } catch {
      toast.error(EXPORT_FAILED)
    } finally {
      setIsExporting(false)
    }
  }

  const rowActions = {
    canManage,
    onEdit: (trip: MileageReportTrip) => {
      void openEditTrip(trip)
    },
    onDelete: (trip: MileageReportTrip) => {
      if (trip.source !== 'oj_projects') setDeleteTarget(trip)
    },
  }

  return (
    <PageLayout
      {...MILEAGE_TRIPS_LAYOUT}
      headerActions={
        <>
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="download" size={16} />}
            onClick={() => void handleExport()}
            loading={isExporting}
            disabled={isExporting}
          >
            Export CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="download" size={16} />}
            onClick={() => setShowReportDialog(true)}
          >
            Download Report
          </Button>
          {canManage && (
            <Button variant="primary" size="sm" icon={<Icon name="plus" size={16} />} onClick={openNewTrip}>
              New Trip
            </Button>
          )}
        </>
      }
    >
      {/* Headline cards: never filtered (spec 7.1) */}
      <StatGrid columns={4}>
        <Stat label="This quarter" value={`${formatMilesText(stats.quarter.milesTenths)} mi`} hint={formatPoundsText(stats.quarter.amountPence)} />
        <Stat
          label="This financial year"
          value={`${formatMilesText(stats.financialYear.milesTenths)} mi`}
          hint={formatPoundsText(stats.financialYear.amountPence)}
        />
        <Stat label="This tax year" value={`${formatMilesText(stats.taxYear.milesTenths)} mi`} hint={formatPoundsText(stats.taxYear.amountPence)} />
        <Stat label="Miles left before 25p" value={describeMilesLeft(stats.drivers)} hint="Per person, this tax year" />
      </StatGrid>

      {warnings.map((warning) => (
        <Alert key={warning} tone="warning">
          {warning}
        </Alert>
      ))}

      <MileageFilters query={query} presets={presets} places={places} drivers={drivers} onChange={navigate} />

      {isPending ? (
        <PageLoading inline label="Loading trips" />
      ) : (
        <>
          <p className="text-sm text-text-muted" aria-live="polite">
            {describeResults(trips.totals)}
          </p>

          {trips.rows.length === 0 ? (
            <Card>
              <Empty
                size="sm"
                icon={<Icon name="mapPin" size={48} />}
                title={filtered ? 'No trips match these filters' : 'No trips recorded'}
                description={filtered ? 'Change or clear the filters to see more trips.' : 'Add your first trip to start tracking mileage.'}
              />
            </Card>
          ) : (
            <Card padding="none">
              <div className="hidden md:block">
                <MileageTripTable
                  trips={trips.rows}
                  sort={query.sort}
                  dir={query.dir}
                  onSort={(column) => navigate(nextSort(query, column))}
                  {...rowActions}
                />
              </div>
              <div className="space-y-2 p-3 md:hidden">
                {trips.rows.map((trip) => (
                  <MileageTripCard key={trip.id} trip={trip} {...rowActions} />
                ))}
              </div>
              <TablePagination
                page={query.page}
                totalPages={totalPages}
                totalItems={trips.totalCount}
                pageSize={MILEAGE_LIST_PAGE_SIZE}
                onPageChange={(page) => navigate({ ...query, page })}
              />
            </Card>
          )}
        </>
      )}

      <TripForm
        open={showTripForm}
        onClose={() => setShowTripForm(false)}
        onSuccess={refresh}
        destinations={destinations}
        drivers={drivers}
        editingTrip={editingTrip}
      />

      {deleteTarget && (
        <ConfirmDialog
          open
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="Delete Trip"
          message={`Are you sure you want to delete the trip on ${formatLongDate(deleteTarget.tripDate)}? This cannot be undone.`}
          confirmLabel="Delete"
          tone="danger"
        />
      )}

      {/* Mounted only while open, so every opening starts from the table's current dates and driver. */}
      {showReportDialog && (
        <MileageReportDialog
          open
          onClose={() => setShowReportDialog(false)}
          drivers={drivers}
          today={today}
          initialRange={{ from: query.from, to: query.to }}
          initialDriverId={query.driverId}
          ignoredFilters={ignoredReportFilters(query)}
        />
      )}
    </PageLayout>
  )
}
