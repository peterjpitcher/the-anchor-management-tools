'use client'

import React, { useMemo, useState } from 'react'
import { Button, SearchInput } from '@/ds'
import { cn } from '@/lib/utils'
import type { FohScheduleResponse } from '../types'
import {
  formatFohClock,
  getBookingVisualLabel,
  searchFohBookings,
  type FohSearchResult,
} from '../utils'

/**
 * Find a booking by the guest's name or the booking reference, for the day shown (owner decision,
 * 22 November 2026). A guest gives a name at the bar; scanning twenty lanes for it is the slow
 * part. Tapping a result opens that booking's panel.
 */
export const FohBookingSearch = React.memo(function FohBookingSearch({
  schedule,
  onOpen,
  className,
}: {
  schedule: FohScheduleResponse['data'] | null
  onOpen: (result: FohSearchResult) => void
  className?: string
}) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchFohBookings(schedule, query), [schedule, query])
  const searching = query.trim().length > 0

  return (
    <div className={cn('relative', className)}>
      <div className="flex items-center gap-2">
        <SearchInput
          id="foh-booking-search"
          aria-label="Find a booking by name or reference"
          value={query}
          onChange={setQuery}
          placeholder="Find a booking by name or reference"
          className="min-h-touch w-full"
        />
        {searching && (
          <Button type="button" variant="secondary" onClick={() => setQuery('')} className="min-h-touch shrink-0">
            Clear
          </Button>
        )}
      </div>

      {searching && (
        <div
          role="region"
          aria-label="Bookings found"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border-strong bg-surface shadow-lg"
        >
          {results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-text-muted">No booking with that name or reference on this day.</p>
          ) : (
            <ul>
              {results.map((result) => {
                const { booking } = result
                return (
                  <li key={booking.id} className="border-b border-border last:border-b-0">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        onOpen(result)
                        setQuery('')
                      }}
                      className="h-auto min-h-touch w-full flex-wrap justify-between gap-x-3 gap-y-0.5 rounded-none px-3 py-2 text-left font-normal focus-visible:shadow-ring-inset"
                    >
                      <span className="text-sm font-semibold text-text">
                        {booking.guest_name || booking.booking_reference || 'Booking'}
                      </span>
                      <span className="text-sm text-text-muted">
                        {formatFohClock(booking.booking_time)} · {booking.party_size || 1} people · {getBookingVisualLabel(booking)}
                        {result.laneTableName ? ` · ${result.laneTableName}` : ''}
                        {booking.booking_reference ? ` · ${booking.booking_reference}` : ''}
                      </span>
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
})
