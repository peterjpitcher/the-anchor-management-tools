'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import type { FohBooking, FohStyleVariant } from '../types'

type FohUnassignedBookingsProps = {
  bookings: FohBooking[]
  styleVariant: FohStyleVariant
  onBookingClick: (booking: FohBooking) => void
}

export const FohUnassignedBookings = React.memo(function FohUnassignedBookings(props: FohUnassignedBookingsProps) {
  const { bookings, styleVariant, onBookingClick } = props

  if (bookings.length === 0) return null

  const isManagerKioskStyle = styleVariant === 'manager_kiosk'
  const unassignedCardClass = cn(
    'rounded-lg border border-amber-200 bg-amber-50',
    isManagerKioskStyle ? 'p-2' : 'p-4'
  )

  return (
    <div className={unassignedCardClass}>
      <h3 className={cn('font-semibold text-amber-900', isManagerKioskStyle ? 'text-xs' : 'text-sm')}>Unassigned bookings</h3>
      <div className={cn('flex flex-wrap gap-2', isManagerKioskStyle ? 'mt-2' : 'mt-3')}>
        {bookings.map((booking) => (
          <button
            key={booking.id}
            type="button"
            onClick={() => onBookingClick(booking)}
            className={cn(
              'rounded-md border border-amber-200 bg-white text-amber-900 hover:bg-amber-100',
              isManagerKioskStyle ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
            )}
          >
            {booking.guest_name || booking.booking_reference || booking.id.slice(0, 8)} · {booking.party_size || 1} · {booking.booking_time}
          </button>
        ))}
      </div>
    </div>
  )
})
