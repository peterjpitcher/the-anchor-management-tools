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
  styleVariant: FohStyleVariant
  onBookingClick: (booking: FohBooking) => void
}

// Sort key mirrors the schedule route: stable even when start_datetime is null.
function outsideSortKey(booking: FohBooking): string {
  return booking.start_datetime || booking.booking_time || booking.id
}

export const FohOutsideBookings = React.memo(function FohOutsideBookings(props: FohOutsideBookingsProps) {
  const { bookings, canEdit, styleVariant, onBookingClick } = props
  const isManagerKioskStyle = styleVariant === 'manager_kiosk'

  const panelSurfaceClass = isManagerKioskStyle
    ? 'rounded-xl border border-green-200 bg-white shadow-sm'
    : 'rounded-lg border border-gray-200 bg-white'
  const cardWrapperClass = cn(panelSurfaceClass, isManagerKioskStyle ? 'p-2' : 'p-4')

  const sorted = [...bookings].sort((a, b) => outsideSortKey(a).localeCompare(outsideSortKey(b)))

  return (
    <div className={cardWrapperClass}>
      <div className={cn('flex items-center justify-between', isManagerKioskStyle ? 'mb-2' : 'mb-3')}>
        <h3 className="text-sm font-semibold text-gray-900">Outside bookings</h3>
        <p className={cn('text-gray-500', isManagerKioskStyle ? 'text-[10px]' : 'text-xs')}>
          No physical table
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className={cn('text-gray-500', isManagerKioskStyle ? 'text-[11px]' : 'text-sm')}>
          No outside bookings for this service.
        </p>
      ) : (
        <div className={cn('grid gap-2 sm:grid-cols-2 lg:grid-cols-3', isManagerKioskStyle && 'gap-1.5')}>
          {sorted.map((booking) => {
            const visualState = getBookingVisualState(booking)
            const visualLabel = getBookingVisualLabel(booking)
            const highChairs = booking.high_chair_count ?? 0
            return (
              <button
                key={booking.id}
                type="button"
                onClick={() => onBookingClick(booking)}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-lg border border-gray-200 bg-white text-left transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sidebar/40',
                  isManagerKioskStyle ? 'p-2' : 'p-3'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className={cn('min-w-0 truncate font-semibold text-gray-900', isManagerKioskStyle ? 'text-[13px]' : 'text-sm')}>
                    {booking.guest_name || booking.booking_reference || booking.id.slice(0, 8)}
                  </p>
                  <span
                    className={cn(
                      'shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium',
                      getTableBookingStatusBadgeClasses(visualState)
                    )}
                  >
                    {visualLabel}
                  </span>
                </div>
                <p className={cn('text-gray-600', isManagerKioskStyle ? 'text-[11px]' : 'text-xs')}>
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
    </div>
  )
})
