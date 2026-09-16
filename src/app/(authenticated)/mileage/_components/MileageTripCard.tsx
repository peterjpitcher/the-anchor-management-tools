'use client'

/** One trip on a phone (spec 7.1). Below 768px these cards replace the table, so nothing scrolls sideways. */

import { PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Badge, IconButton } from '@/ds'
import { formatLongDate } from '@/lib/mileage/periods'
import type { MileageReportTrip } from '@/lib/mileage/report/dataset'
import { formatMilesText, formatPoundsText } from '@/lib/mileage/report/format'
import { describeTripRoute } from '@/lib/mileage/report/model'
import type { TripRowActions } from './MileageTripTable'

export function MileageTripCard({ trip, canManage, onEdit, onDelete }: TripRowActions & { trip: MileageReportTrip }): React.JSX.Element {
  const isOjProjects = trip.source === 'oj_projects'
  const dateLabel = formatLongDate(trip.tripDate)

  return (
    <article className="rounded-lg border border-border bg-surface p-3" aria-label={`Trip on ${dateLabel}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{dateLabel}</p>
          <p className="text-sm text-text-muted break-words">{describeTripRoute(trip)}</p>
        </div>
        <Badge tone={isOjProjects ? 'primary' : 'neutral'} className="shrink-0">
          {isOjProjects ? 'OJ Projects' : 'Logged'}
        </Badge>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div className="min-w-0">
          <dt className="text-text-muted">Driver</dt>
          <dd className="break-words">{trip.driverName}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-text-muted">Miles</dt>
          <dd className="break-words">{formatMilesText(trip.totalMilesTenths)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-text-muted">Amount</dt>
          <dd className="break-words font-medium">{formatPoundsText(trip.amountPence)}</dd>
        </div>
      </dl>
      {canManage && !isOjProjects && (
        <div className="mt-2 flex justify-end gap-1">
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
    </article>
  )
}
