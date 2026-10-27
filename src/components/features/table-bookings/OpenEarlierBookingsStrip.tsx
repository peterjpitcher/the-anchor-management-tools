'use client'

import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, CardBody, CardHeader, toast } from '@/ds'
import type { OpenEarlierTableBooking } from '@/lib/table-bookings/open-outcomes'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'

const COLLAPSED_COUNT = 5

/**
 * 'Still open from earlier' (BK-130; owner decision D13): table bookings from the last seven days
 * that nobody seated, saw leave or marked as a no-show, with one-tap Arrived and No-show. Shown
 * on FOH and BOH only when there is something to mark. A booking left alone drops off after seven
 * days and reads as 'not recorded', never as a no-show.
 */
export function OpenEarlierBookingsStrip({ canEdit, onChanged }: { canEdit: boolean; onChanged?: () => void }) {
  const [bookings, setBookings] = useState<OpenEarlierTableBooking[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/foh/bookings/open-earlier', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) {
        setLoadError(payload?.error ?? 'Bookings still open from earlier could not be loaded.')
        return
      }
      setLoadError(null)
      const rows: unknown = payload.data?.bookings
      setBookings(Array.isArray(rows) ? (rows as OpenEarlierTableBooking[]) : [])
    } catch {
      setLoadError('Bookings still open from earlier could not be loaded.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const mark = useCallback(async (booking: OpenEarlierTableBooking, outcome: 'arrived' | 'no_show') => {
    setBusyId(booking.id)
    try {
      const response = await fetch(`/api/foh/bookings/${booking.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) {
        toast.error(payload?.error ?? 'Failed to record the outcome.')
      } else {
        toast.success(outcome === 'arrived' ? `${booking.guestName} marked as arrived` : `${booking.guestName} marked as a no-show`)
        onChanged?.()
      }
    } catch {
      toast.error('Failed to record the outcome.')
    } finally {
      setBusyId(null)
      await load()
    }
  }, [load, onChanged])

  if (loadError) {
    return <Alert tone="warning" size="sm">{loadError}</Alert>
  }
  if (bookings.length === 0) return null

  const visible = expanded ? bookings : bookings.slice(0, COLLAPSED_COUNT)

  return (
    <Card>
      <CardHeader
        title="Still open from earlier"
        subtitle="Bookings from the last 7 days nobody marked. After 7 days an unmarked booking closes as not recorded."
        action={<Badge tone="warning">{bookings.length}</Badge>}
      />
      <CardBody>
        <ul className="divide-y divide-border">
          {visible.map((booking) => {
            const busy = busyId === booking.id
            return (
              <li key={booking.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-text-strong">{booking.guestName}</span>
                  <span className="ml-2 text-text-muted">
                    {formatDateInLondon(booking.bookingDate, { weekday: 'short', day: 'numeric', month: 'short' })}{' '}
                    {formatTime12Hour(booking.bookingTime)}, party of {booking.partySize}
                    {booking.bookingReference ? `, ${booking.bookingReference}` : ''}
                  </span>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" loading={busy} onClick={() => mark(booking, 'arrived')}>
                      Arrived
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => mark(booking, 'no_show')}>
                      No-show
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {bookings.length > COLLAPSED_COUNT && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show fewer' : `Show all ${bookings.length}`}
          </Button>
        )}
      </CardBody>
    </Card>
  )
}
