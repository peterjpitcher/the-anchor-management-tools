'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@/ds'
import { describeFohSlotReason } from '@/lib/foh/availability-query'

type Slot = {
  time: string
  state: 'available' | 'unavailable'
  public_reason: string | null
}

type Answer =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; slots: Slot[] }
  | { status: 'unknown' }

export type FohTimeSlotsProps = {
  date: string
  partySize: string
  purpose: 'food' | 'drinks' | 'christmas'
  outside: boolean
  requiresAccessibleTable: boolean
  highChairCount: string
  walkIn: boolean
  selectedTime: string
  onPick: (time: string) => void
}

/** The query for /api/foh/availability, or null until the form says enough to ask. */
export function buildFohAvailabilityParams(props: Omit<FohTimeSlotsProps, 'selectedTime' | 'onPick'>): URLSearchParams | null {
  const partySize = Number.parseInt(props.partySize, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(props.date) || !Number.isInteger(partySize) || partySize < 1) {
    return null
  }
  const params = new URLSearchParams({
    date: props.date,
    party_size: String(partySize),
    purpose: props.purpose,
    high_chair_count: String(Number.parseInt(props.highChairCount, 10) || 0),
  })
  if (props.outside) params.set('outside', 'true')
  if (props.requiresAccessibleTable) params.set('requires_accessible_table', 'true')
  if (props.walkIn) params.set('walk_in', 'true')
  return params
}

/**
 * The free times for the booking being taken (BK-184): one button per time, the reason on the ones
 * that are not free. Picking one fills the time box, which stays for a time typed by hand.
 */
export function FohTimeSlots(props: FohTimeSlotsProps): React.ReactElement | null {
  const { date, partySize, purpose, outside, requiresAccessibleTable, highChairCount, walkIn } = props
  const [answer, setAnswer] = useState<Answer>({ status: 'idle' })

  useEffect(() => {
    const params = buildFohAvailabilityParams({ date, partySize, purpose, outside, requiresAccessibleTable, highChairCount, walkIn })
    if (!params) {
      setAnswer({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setAnswer({ status: 'loading' })
    // A short pause, so typing a party size asks once rather than per key.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/foh/availability?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = (await response.json().catch(() => null)) as
          | { success?: boolean; data?: { calculation_state?: string; slots?: Slot[] } }
          | null
        if (controller.signal.aborted) return
        if (!response.ok || !body?.success || body.data?.calculation_state !== 'complete') {
          setAnswer({ status: 'unknown' })
          return
        }
        setAnswer({ status: 'ready', slots: Array.isArray(body.data.slots) ? body.data.slots : [] })
      } catch {
        if (!controller.signal.aborted) setAnswer({ status: 'unknown' })
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [date, partySize, purpose, outside, requiresAccessibleTable, highChairCount, walkIn])

  if (answer.status === 'idle') return null

  return (
    <div className="md:col-span-2" aria-live="polite">
      <p className="mb-1 text-sm font-medium text-text">Free times</p>
      {answer.status === 'loading' && <p className="text-xs text-text-muted">Checking which times are free...</p>}
      {answer.status === 'unknown' && (
        <p className="text-xs text-text-muted">
          Could not check which times are free. Type a time; the booking is still checked when you save it.
        </p>
      )}
      {answer.status === 'ready' && answer.slots.length === 0 && (
        <p className="text-xs text-text-muted">No times to offer on that date for this booking.</p>
      )}
      {answer.status === 'ready' && answer.slots.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {answer.slots.map((slot) => {
            const free = slot.state === 'available'
            const selected = props.selectedTime === slot.time
            const reason = free ? null : describeFohSlotReason(slot.public_reason)
            return (
              <li key={slot.time}>
                <Button
                  type="button"
                  size="sm"
                  variant={selected ? 'primary' : 'secondary'}
                  disabled={!free}
                  aria-pressed={selected}
                  onClick={() => props.onPick(slot.time)}
                  title={reason ?? undefined}
                  className="h-auto min-h-touch flex-col gap-0 py-1"
                >
                  <span className="font-medium">{slot.time}</span>
                  {reason && <span className="text-2xs">{reason}</span>}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
