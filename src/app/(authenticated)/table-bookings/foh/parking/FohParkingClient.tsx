'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, CardBody, CardHeader, SearchInput } from '@/ds'
import { formatDateInLondon, formatTime12Hour, formatTimeInLondon, toLocalIsoDate } from '@/lib/dateUtils'
import type { FohParkingBooking, FohParkingView } from '@/lib/foh/parking-view'

const REFRESH_MS = 60 * 1000

/** "2pm", or "2pm Thu 26 Nov" when the instant is not on the day the list is about. */
function formatWhen(iso: string, listDayIso: string): string {
  const date = new Date(iso)
  const time = formatTime12Hour(formatTimeInLondon(date))
  if (toLocalIsoDate(date) === listDayIso) return time
  return `${time} ${formatDateInLondon(date, { weekday: 'short', day: 'numeric', month: 'short' })}`
}

function describeVehicle(booking: FohParkingBooking): string | null {
  const parts = [booking.vehicle_colour, booking.vehicle_make, booking.vehicle_model].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

function matches(booking: FohParkingBooking, needle: string): boolean {
  if (!needle) return true
  // Registrations are typed with and without the space.
  const squash = (value: string) => value.toLowerCase().replace(/\s+/g, '')
  return (
    squash(booking.vehicle_registration).includes(squash(needle))
    || booking.guest_name.toLowerCase().includes(needle.toLowerCase())
    || booking.reference.toLowerCase().includes(needle.toLowerCase())
  )
}

function ParkingRow({ booking, listDayIso }: { booking: FohParkingBooking; listDayIso: string }) {
  const vehicle = describeVehicle(booking)
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm text-text">
          <span className="rounded-sm border border-border-strong bg-surface-2 px-2 py-0.5 text-base font-bold uppercase tracking-wide text-text-strong">
            {booking.vehicle_registration}
          </span>
          <span className="font-semibold">{booking.guest_name}</span>
          {!booking.paid && <Badge tone="warning">Not paid</Badge>}
          {booking.paid && booking.owes && <Badge tone="warning">Owes {booking.owes}</Badge>}
        </p>
        <p className="mt-0.5 text-sm text-text-muted">
          Arrives {formatWhen(booking.arrives_at, listDayIso)} · Leaves {formatWhen(booking.leaves_at, listDayIso)}
          {vehicle ? ` · ${vehicle}` : ''} · {booking.reference}
        </p>
      </div>
      {booking.phone && (
        <a
          href={`tel:${booking.phone}`}
          className="inline-flex min-h-touch shrink-0 items-center text-sm font-semibold text-primary underline"
        >
          {booking.phone}
        </a>
      )}
    </li>
  )
}

function ParkingList({
  title,
  empty,
  bookings,
  listDayIso,
}: {
  title: string
  empty: string
  bookings: FohParkingBooking[]
  listDayIso: string
}) {
  return (
    <Card>
      <CardHeader title={title} action={<Badge tone="neutral">{bookings.length}</Badge>} />
      <CardBody>
        {bookings.length === 0 ? (
          <p className="text-sm text-text-muted">{empty}</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={title}>
            {bookings.map((booking) => (
              <ParkingRow key={booking.reference} booking={booking} listDayIso={listDayIso} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * Parking for the till (owner request, 23 November 2026): what is arriving, on site and leaving
 * today, and what is coming up, so the bar knows whether a car is meant to be there. Read only.
 * It shows whether a booking is paid and never how much: this login has no parking permission.
 */
export function FohParkingClient() {
  const [view, setView] = useState<FohParkingView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/foh/parking', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success || !payload.data) {
        setLoadError(payload?.error ?? 'Parking could not be loaded.')
        return
      }
      setLoadError(null)
      setView(payload.data as FohParkingView)
    } catch {
      setLoadError('Parking could not be loaded.')
    }
  }, [])

  // Kept current the same way as the floor screen: a minute's refetch, and one whenever the tab
  // comes back or the network returns.
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    const whenVisible = () => { if (document.visibilityState === 'visible') void load() }
    const whenOnline = () => void load()
    document.addEventListener('visibilitychange', whenVisible)
    window.addEventListener('online', whenOnline)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', whenVisible)
      window.removeEventListener('online', whenOnline)
    }
  }, [load])

  const needle = query.trim()
  const filtered = useMemo(() => {
    if (!view) return null
    const keep = (bookings: FohParkingBooking[]) => bookings.filter((booking) => matches(booking, needle))
    return {
      arriving: keep(view.arriving_today),
      onSite: keep(view.on_site_now),
      leaving: keep(view.leaving_today),
      comingUp: view.coming_up
        .map((day) => ({ date: day.date, bookings: keep(day.bookings) }))
        .filter((day) => day.bookings.length > 0),
    }
  }, [view, needle])

  return (
    <div className="space-y-3" data-touch-targets>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          aria-label="Find a car by registration or name"
          value={query}
          onChange={setQuery}
          placeholder="Find a car by registration or name"
          className="min-w-64 max-w-md flex-1"
        />
        <Button type="button" variant="secondary" onClick={() => void load()} className="min-h-touch">
          Refresh
        </Button>
      </div>

      {loadError && (
        <Alert tone="danger" size="sm">
          {loadError} {view ? 'What is shown may be out of date.' : ''}
        </Alert>
      )}

      {!view && !loadError && <p className="text-sm text-text-muted">Loading parking...</p>}

      {view && filtered && (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <ParkingList
              title="Arriving today"
              empty={needle ? 'No car arriving today matches.' : 'No cars are due to arrive today.'}
              bookings={filtered.arriving}
              listDayIso={view.today}
            />
            <ParkingList
              title="On site now"
              empty={needle ? 'No car on site matches.' : 'No booked cars are on site at the moment.'}
              bookings={filtered.onSite}
              listDayIso={view.today}
            />
            <ParkingList
              title="Leaving today"
              empty={needle ? 'No car leaving today matches.' : 'No cars are due to leave today.'}
              bookings={filtered.leaving}
              listDayIso={view.today}
            />
          </div>

          <Card>
            <CardHeader title="Coming up" subtitle="Arrivals in the next 14 days." />
            <CardBody>
              {filtered.comingUp.length === 0 ? (
                <p className="text-sm text-text-muted">
                  {needle ? 'No car coming up matches.' : 'No parking is booked for the next 14 days.'}
                </p>
              ) : (
                <div className="space-y-3">
                  {filtered.comingUp.map((day) => (
                    <section key={day.date} aria-label={formatDateInLondon(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}>
                      <p className="text-sm font-semibold text-text-strong">
                        {formatDateInLondon(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}
                      </p>
                      <ul className="divide-y divide-border">
                        {day.bookings.map((booking) => (
                          <ParkingRow key={booking.reference} booking={booking} listDayIso={day.date} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
