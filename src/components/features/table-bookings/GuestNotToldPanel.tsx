'use client'

import { useCallback, useEffect, useState } from 'react'
import { Alert, Button } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import type { GuestNotToldItem } from '@/lib/table-bookings/guest-not-told'

/**
 * Cancelled bookings whose guest was not told and has not been rung yet (BK-177). The warning used
 * to flash for a few seconds with no number and no record of a call; it now stays, with the
 * guest's number, until someone says they have rung. The FOH screen lists every one; the booking
 * page passes its own id.
 */

function describeWhen(item: GuestNotToldItem): string | null {
  if (!item.bookingDate) return null
  const day = formatDateInLondon(`${item.bookingDate}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = item.bookingTime ? item.bookingTime.slice(0, 5) : null
  return time ? `${day} at ${time}` : day
}

export function GuestNotToldPanel({
  bookingId,
  refreshKey = 0,
  canEdit,
}: {
  bookingId?: string
  /** Bump to look again, after a cancellation. */
  refreshKey?: number
  canEdit: boolean
}): React.JSX.Element | null {
  const [items, setItems] = useState<GuestNotToldItem[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const query = bookingId ? `?booking_id=${encodeURIComponent(bookingId)}` : ''
      const response = await fetch(`/api/foh/guest-not-told${query}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (response.ok && Array.isArray(payload?.data)) setItems(payload.data as GuestNotToldItem[])
    } catch {
      // Keep what is on screen: a blip must not hide a guest still to ring.
    }
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function markRung(item: GuestNotToldItem) {
    setBusyId(item.bookingId)
    setProblem(null)
    try {
      const response = await fetch('/api/foh/guest-not-told', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: item.bookingId }),
      })
      if (!response.ok) throw new Error('not saved')
      setItems((current) => current.filter((entry) => entry.bookingId !== item.bookingId))
    } catch {
      setProblem('That was not saved. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  if (items.length === 0) return null

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const when = describeWhen(item)
        const who = item.guestName ?? 'The guest'
        const booking = [item.bookingReference, when].filter(Boolean).join(', ')
        return (
          <Alert key={item.bookingId} tone="danger" title="Guest not told about the cancellation">
            <div className="space-y-2">
              <p>
                {who}
                {booking ? ` (${booking})` : ''} has not been told their booking was cancelled.{' '}
                {item.phone ? (
                  <>
                    Ring them on{' '}
                    <a href={`tel:${item.phone}`} className="font-semibold underline">
                      {item.phone}
                    </a>
                    .
                  </>
                ) : (
                  'There is no phone number on the booking: check the customer record.'
                )}
              </p>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busyId === item.bookingId}
                  disabled={Boolean(busyId)}
                  onClick={() => void markRung(item)}
                >
                  I&apos;ve rung them
                </Button>
              ) : null}
            </div>
          </Alert>
        )
      })}
      {problem ? (
        <p className="text-sm font-semibold text-danger-fg" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
