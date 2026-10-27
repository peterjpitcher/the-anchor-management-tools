'use client'

import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button } from '@/ds'
import { formatDateInLondon, formatTimeInLondon } from '@/lib/dateUtils'
import type { AwaitingConfirmationItem } from '@/lib/table-bookings/awaiting-confirmation'

const REFRESH_MS = 5 * 60 * 1000

/**
 * "To call": guests asked the day before to confirm their table who have not answered, for today
 * and tomorrow (BK-094). Staff ring them and tick them off; a tick records who rang, and the guest
 * stays on the list, marked as rung, until they confirm or the booking passes.
 */

function describeWhen(item: AwaitingConfirmationItem): string {
  const day = formatDateInLondon(`${item.bookingDate}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = item.bookingTime ? item.bookingTime.slice(0, 5) : null
  return time ? `${day} at ${time}` : day
}

export function AwaitingConfirmationPanel({ canEdit }: { canEdit: boolean }): React.JSX.Element | null {
  const [items, setItems] = useState<AwaitingConfirmationItem[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/foh/awaiting-confirmation', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (response.ok && Array.isArray(payload?.data)) {
        setItems(payload.data as AwaitingConfirmationItem[])
        setLoadFailed(false)
      } else {
        setLoadFailed(true)
      }
    } catch {
      // Keep what is on screen: a blip must not hide a guest still to ring.
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  async function markCalled(item: AwaitingConfirmationItem) {
    setBusyId(item.bookingId)
    setProblem(null)
    try {
      const response = await fetch('/api/foh/awaiting-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: item.bookingId }),
      })
      if (!response.ok) throw new Error('not saved')
      const calledAt = new Date().toISOString()
      setItems((current) => current.map((entry) => (entry.bookingId === item.bookingId ? { ...entry, calledAt } : entry)))
    } catch {
      setProblem('That was not saved. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  if (items.length === 0) {
    return loadFailed ? (
      <Alert tone="warning" size="sm" role="status">
        The list of guests who have not confirmed could not be loaded. It tries again in a few minutes.
      </Alert>
    ) : null
  }

  const toCall = items.filter((item) => !item.calledAt).length

  return (
    <Alert tone="info" title={`To call: ${toCall} of ${items.length} not confirmed`} role="status">
      <p className="mb-2">These guests were asked to confirm their table and have not answered.</p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.bookingId} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{item.guestName ?? 'Guest'}</span>
            <span>
              {[item.bookingReference, describeWhen(item), item.partySize ? `${item.partySize} people` : null]
                .filter(Boolean)
                .join(', ')}
            </span>
            {item.phone ? (
              <a href={`tel:${item.phone}`} className="font-semibold underline">
                {item.phone}
              </a>
            ) : (
              <span>No phone number on the booking</span>
            )}
            {item.calledAt ? (
              <Badge tone="success">Rung at {formatTimeInLondon(new Date(item.calledAt))}</Badge>
            ) : canEdit ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === item.bookingId}
                disabled={Boolean(busyId)}
                onClick={() => void markCalled(item)}
              >
                I&apos;ve rung them
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {problem ? (
        <p className="mt-2 text-sm font-semibold text-danger-fg" role="alert">
          {problem}
        </p>
      ) : null}
    </Alert>
  )
}
