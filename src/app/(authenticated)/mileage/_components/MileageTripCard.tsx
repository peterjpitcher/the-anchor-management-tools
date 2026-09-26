'use client'

/** One trip on a phone (spec 7.1). Below 768px these cards replace the table, so nothing scrolls sideways. */

import { Badge, Card, IconButton, Icon } from '@/ds'
import { formatLongDate } from '@/lib/mileage/periods'
import type { MileageReportTrip } from '@/lib/mileage/report/dataset'
import { formatMilesText, formatPoundsText } from '@/lib/mileage/report/format'
import { describeTripRoute } from '@/lib/mileage/report/model'
import type { TripRowActions } from './MileageTripTable'
import { MILEAGE_TRIP_SOURCE_LABEL, MILEAGE_TRIP_SOURCE_TONE } from '../_shared/status-ui'

export function MileageTripCard({ trip, canManage, onEdit, onDelete }: TripRowActions & { trip: MileageReportTrip }): React.JSX.Element {
  const isOjProjects = trip.source === 'oj_projects'
  const dateLabel = formatLongDate(trip.tripDate)

  return (
    <article aria-label={`Trip on ${dateLabel}`}>
      <Card padding="sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{dateLabel}</p>
            <p className="text-sm text-text-muted break-words">{describeTripRoute(trip)}</p>
          </div>
          <Badge tone={MILEAGE_TRIP_SOURCE_TONE[trip.source]} className="shrink-0">
            {MILEAGE_TRIP_SOURCE_LABEL[trip.source]}
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
              icon={<Icon name="edit" size={16} />}
              label={`Edit trip on ${dateLabel}`}
              variant="ghost"
              size="sm"
              onClick={() => onEdit(trip)}
            />
            <IconButton
              icon={<Icon name="trash" size={16} className="text-danger" />}
              label={`Delete trip on ${dateLabel}`}
              variant="ghost"
              size="sm"
              onClick={() => onDelete(trip)}
            />
          </div>
        )}
      </Card>
    </article>
  )
}
