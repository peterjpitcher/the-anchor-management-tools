'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, CardBody, CardHeader, toast } from '@/ds'
import type { OpenEarlierTableBooking } from '@/lib/table-bookings/open-outcomes'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'
import { UndoBar, type UndoOffer } from './UndoBar'

const COLLAPSED_COUNT = 5

/**
 * 'Still open from earlier' (BK-130; owner decision D13): table bookings from the last seven days
 * that nobody seated, saw leave or marked as a no-show, with one-tap Arrived and No-show. Shown
 * on FOH and BOH only when there is something to mark. A booking left alone drops off after seven
 * days and reads as 'not recorded', never as a no-show.
 *
 * It lists only what is genuinely still open: the list is read again whenever `refreshKey`
 * changes (the floor screen bumps it as it refreshes), so a booking marked on another device, or
 * closed by the end-of-day no-show, leaves the strip without a reload. The one-tap No-show is
 * followed by the same 10 second Undo as the floor's (owner decision, 22 November 2026).
 */
export function OpenEarlierBookingsStrip({
  canEdit,
  onChanged,
  refreshKey,
}: {
  canEdit: boolean
  onChanged?: () => void
  /** Read the list again when this changes. Optional: without it the list loads once. */
  refreshKey?: string | number
}) {
  const [bookings, setBookings] = useState<OpenEarlierTableBooking[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [undoOffer, setUndoOffer] = useState<UndoOffer | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const undoCounterRef = useRef(0)

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
  }, [load, refreshKey])

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
        if (outcome === 'no_show' && payload.undo && typeof payload.undo === 'object') {
          undoCounterRef.current += 1
          setUndoOffer({
            id: undoCounterRef.current,
            bookingId: booking.id,
            label: `${booking.guestName} marked as a no-show`,
            ticket: payload.undo as Record<string, unknown>,
          })
        }
        onChanged?.()
      }
    } catch {
      toast.error('Failed to record the outcome.')
    } finally {
      setBusyId(null)
      await load()
    }
  }, [load, onChanged])

  const undo = useCallback(async () => {
    const offer = undoOffer
    if (!offer) return
    setUndoBusy(true)
    try {
      const response = await fetch(`/api/foh/bookings/${offer.bookingId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(offer.ticket),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) {
        toast.error(payload?.error ?? 'Could not undo. The booking is still a no-show.', { duration: 12000 })
      } else {
        toast.success(`Undone: ${offer.label}`)
        onChanged?.()
      }
    } catch {
      toast.error('Could not undo. The booking is still a no-show.', { duration: 12000 })
    } finally {
      setUndoBusy(false)
      setUndoOffer(null)
      await load()
    }
  }, [load, onChanged, undoOffer])

  const dismissUndo = useCallback(() => setUndoOffer(null), [])

  const undoBar = undoOffer ? (
    <UndoBar key={undoOffer.id} offer={undoOffer} busy={undoBusy} onUndo={() => void undo()} onExpire={dismissUndo} />
  ) : null

  if (loadError) {
    return (
      <div className="space-y-2">
        {undoBar}
        <Alert tone="warning" size="sm">{loadError}</Alert>
      </div>
    )
  }
  // The last booking marked leaves the list at once, but its Undo must still be on offer.
  if (bookings.length === 0) return undoBar

  const visible = expanded ? bookings : bookings.slice(0, COLLAPSED_COUNT)

  return (
    <div className="space-y-2">
      {undoBar}
      <Card>
        <CardHeader
          title="Still open from earlier"
          subtitle="Bookings from the last 7 days that nobody marked. Mark each one as arrived or as a no-show."
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
                    // At least 44 by 44: these are tapped on the bar iPad.
                    <div className="flex gap-2">
                      <Button
                        size="lg"
                        variant="secondary"
                        loading={busy}
                        disabled={Boolean(busyId)}
                        onClick={() => mark(booking, 'arrived')}
                        className="min-h-touch min-w-24"
                      >
                        Arrived
                      </Button>
                      <Button
                        size="lg"
                        variant="secondary"
                        disabled={Boolean(busyId)}
                        onClick={() => mark(booking, 'no_show')}
                        className="min-h-touch min-w-24"
                      >
                        No-show
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {bookings.length > COLLAPSED_COUNT && (
            <Button size="lg" variant="ghost" className="min-h-touch" onClick={() => setExpanded((value) => !value)}>
              {expanded ? 'Show fewer' : `Show all ${bookings.length}`}
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
