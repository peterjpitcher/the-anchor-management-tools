'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/ds'
import { getTableBookingStatusBadgeClasses } from '@/lib/table-bookings/ui'
import type { FohBooking, FohStyleVariant } from '../types'
import { formatBookingWindow, getBookingVisualState, getBookingVisualLabel } from '../utils'

type FohOutsideBookingsProps = {
  bookings: FohBooking[]
  canEdit: boolean
  loading: boolean
  styleVariant: FohStyleVariant
  onBookingClick: (booking: FohBooking) => void
}

export const FohOutsideBookings = React.memo(function FohOutsideBookings(props: FohOutsideBookingsProps) {
  const { bookings, canEdit, loading, styleVariant, onBookingClick } = props
  const isManagerKioskStyle = styleVariant === 'manager_kiosk'

  const panelSurfaceClass = isManagerKioskStyle
    ? 'rounded-xl border border-green-200 bg-surface shadow-sm'
    : 'rounded-lg border border-border bg-surface'
  const cardWrapperClass = cn(panelSurfaceClass, isManagerKioskStyle ? 'p-2' : 'p-4')

  // Order comes from the schedule route, which sorts on an epoch key (start_datetime is
  // UTC while booking_time is London-local, so they cannot be compared here — FohBooking
  // does not carry booking_date). Render in the given order.

  return (
    <div className={cn(cardWrapperClass, 'relative')}>
      <div className={cn('flex items-center justify-between', isManagerKioskStyle ? 'mb-2' : 'mb-3')}>
        <h3 className="text-sm font-semibold text-text">Outside bookings</h3>
        <p className={cn('text-text-muted', isManagerKioskStyle ? 'text-2xs' : 'text-xs')}>
          No physical table
        </p>
      </div>

      {bookings.length === 0 ? (
        loading ? null : (
          <p className={cn('text-text-muted', isManagerKioskStyle ? 'text-meta' : 'text-sm')}>
            No outside bookings for this service.
          </p>
        )
      ) : (
        <div className={cn('grid gap-2 sm:grid-cols-2 lg:grid-cols-3', isManagerKioskStyle && 'gap-1.5')}>
          {bookings.map((booking) => {
            const visualState = getBookingVisualState(booking)
            const visualLabel = getBookingVisualLabel(booking)
            const highChairs = booking.high_chair_count ?? 0
            return (
              <button
                key={booking.id}
                type="button"
                onClick={() => onBookingClick(booking)}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-lg border border-border bg-surface text-left transition hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-sidebar/40',
                  isManagerKioskStyle ? 'p-2' : 'p-3'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className={cn('min-w-0 truncate font-semibold text-text', isManagerKioskStyle ? 'text-ui' : 'text-sm')}>
                    {booking.guest_name || booking.booking_reference || booking.id.slice(0, 8)}
                  </p>
                  <span
                    className={cn(
                      'shrink-0 rounded-md border px-2 py-0.5 text-meta font-medium',
                      getTableBookingStatusBadgeClasses(visualState)
                    )}
                  >
                    {visualLabel}
                  </span>
                </div>
                <p className={cn('text-text-muted', isManagerKioskStyle ? 'text-meta' : 'text-xs')}>
                  {formatBookingWindow(booking.start_datetime, booking.end_datetime, booking.booking_time)}
                  {' · '}
                  {booking.party_size || 1}p
                </p>
                {highChairs > 0 ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone="neutral">High chair ×{highChairs}</Badge>
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-surface/70">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-sidebar" />
        </div>
      )}
    </div>
  )
})
