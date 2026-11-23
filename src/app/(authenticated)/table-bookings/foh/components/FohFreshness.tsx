'use client'

import React from 'react'
import { Alert, Button } from '@/ds'
import { formatFohInstant, isFohScheduleStale } from '../utils'

/**
 * Whether the screen can be trusted (owner decision, 22 November 2026): "Last updated" with the
 * time of the last successful read, and an obvious warning with "Refresh now" once that is more
 * than about two minutes old. The schedule refreshes itself every minute, so this warning only
 * shows when those refreshes are failing: no wifi, or the server not answering.
 *
 * Staleness is worked out from the screen's own clock tick, so this adds no timer of its own.
 */
export const FohFreshness = React.memo(function FohFreshness({
  lastUpdatedAt,
  now,
  refreshing,
  onRefresh,
}: {
  lastUpdatedAt: Date | null
  now: Date
  refreshing: boolean
  onRefresh: () => void
}) {
  if (!lastUpdatedAt) return null
  const updatedLabel = formatFohInstant(lastUpdatedAt) ?? 'unknown'

  if (!isFohScheduleStale(lastUpdatedAt, now)) {
    return (
      <p className="text-xs font-medium text-text-muted" role="status">
        Last updated {updatedLabel}
      </p>
    )
  }

  return (
    <Alert tone="danger" size="sm" title="This screen may be out of date">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          Last updated {updatedLabel}. Bookings made or changed since then are not showing. Check the wifi, then
          refresh.
        </p>
        <Button type="button" variant="primary" size="lg" disabled={refreshing} onClick={onRefresh} className="min-h-touch">
          {refreshing ? 'Refreshing...' : 'Refresh now'}
        </Button>
      </div>
    </Alert>
  )
})
