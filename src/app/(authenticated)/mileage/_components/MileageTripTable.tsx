'use client'

/**
 * One page of trips (spec 7.1). The database sorts every matching trip, so a header click only asks
 * for a new order. The table shows from 768px; phones get MileageTripCard instead.
 */

import { PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Badge, IconButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds'
import type { MileageListDirection, MileageListSort } from '@/lib/mileage/list-query'
import { formatLongDate } from '@/lib/mileage/periods'
import type { MileageReportTrip } from '@/lib/mileage/report/dataset'
import { formatMilesText, formatPoundsText } from '@/lib/mileage/report/format'
import { describeTripRate, describeTripRoute } from '@/lib/mileage/report/model'

export interface TripRowActions {
  canManage: boolean
  onEdit: (trip: MileageReportTrip) => void
  onDelete: (trip: MileageReportTrip) => void
}

export interface MileageTripTableProps extends TripRowActions {
  trips: MileageReportTrip[]
  sort: MileageListSort
  dir: MileageListDirection
  onSort: (column: MileageListSort) => void
}

const SORT_DESCRIPTIONS: Record<MileageListSort, Record<MileageListDirection, string>> = {
  date: { desc: 'Sorted by date, newest first', asc: 'Sorted by date, oldest first' },
  miles: { desc: 'Sorted by miles, longest first', asc: 'Sorted by miles, shortest first' },
  amount: { desc: 'Sorted by amount, highest first', asc: 'Sorted by amount, lowest first' },
}

interface SortHeaderProps {
  column: MileageListSort
  label: string
  sort: MileageListSort
  dir: MileageListDirection
  onSort: (column: MileageListSort) => void
  align?: 'left' | 'right'
}

/**
 * The design-system header only listens for clicks on the cell, which a keyboard cannot reach.
 * The button inside gives it a tab stop: Enter or Space clicks the button, and that click bubbles
 * to the cell's handler, so the button needs no handler of its own and a press sorts only once.
 */
function SortHeader({ column, label, sort, dir, onSort, align }: SortHeaderProps): React.JSX.Element {
  return (
    <TableHead sortable sortDirection={sort === column ? dir : null} onSort={() => onSort(column)} align={align}>
      <button
        type="button"
        className="rounded-sm uppercase tracking-wider focus-visible:outline-none focus-visible:shadow-ring"
      >
        {label}
      </button>
    </TableHead>
  )
}

export function MileageTripTable({ trips, sort, dir, onSort, canManage, onEdit, onDelete }: MileageTripTableProps): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <p className="sr-only" aria-live="polite">
        {SORT_DESCRIPTIONS[sort][dir]}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <SortHeader column="date" label="Date" sort={sort} dir={dir} onSort={onSort} />
            <TableHead>Route</TableHead>
            <TableHead>Driver</TableHead>
            <SortHeader column="miles" label="Miles" sort={sort} dir={dir} onSort={onSort} align="right" />
            <TableHead align="right">Rate</TableHead>
            <SortHeader column="amount" label="Amount" sort={sort} dir={dir} onSort={onSort} align="right" />
            <TableHead align="center">Source</TableHead>
            {canManage && <TableHead align="right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {trips.map((trip) => {
            const isOjProjects = trip.source === 'oj_projects'
            const route = describeTripRoute(trip)
            const dateLabel = formatLongDate(trip.tripDate)
            return (
              <TableRow key={trip.id}>
                <TableCell>{dateLabel}</TableCell>
                <TableCell>
                  {/* max-width on the span, not the cell: browsers ignore max-width on table cells. */}
                  <span className="block max-w-xs truncate" title={route}>
                    {route}
                  </span>
                </TableCell>
                <TableCell>{trip.driverName}</TableCell>
                <TableCell align="right" className="font-medium">
                  {formatMilesText(trip.totalMilesTenths)}
                </TableCell>
                <TableCell align="right">{describeTripRate(trip)}</TableCell>
                <TableCell align="right" className="font-medium">
                  {formatPoundsText(trip.amountPence)}
                </TableCell>
                <TableCell align="center">
                  <Badge tone={isOjProjects ? 'primary' : 'neutral'}>{isOjProjects ? 'OJ Projects' : 'Logged'}</Badge>
                </TableCell>
                {canManage && (
                  <TableCell align="right">
                    {!isOjProjects && (
                      <div className="flex items-center justify-end gap-1">
                        <IconButton
                          icon={<PencilSquareIcon className="h-4 w-4" />}
                          label={`Edit trip on ${dateLabel}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(trip)}
                        />
                        <IconButton
                          icon={<TrashIcon className="h-4 w-4 text-danger" />}
                          label={`Delete trip on ${dateLabel}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(trip)}
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
    </div>
  )
}
