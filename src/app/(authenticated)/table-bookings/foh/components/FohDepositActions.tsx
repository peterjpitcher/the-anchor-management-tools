'use client'

import React, { useState } from 'react'
import { Button, Input, Textarea } from '@/ds'
import { londonLocalInputToUtcIso, utcIsoToLondonLocalInput } from '@/lib/dateUtils'
import { postBookingAction } from '../utils'

type DepositAction = 'waive' | 'cash' | 'extend'

const ACTION_LABELS: Record<DepositAction, { open: string; submit: string; explain: string }> = {
  cash: {
    open: 'Deposit taken at the bar',
    submit: 'Record payment',
    explain: 'Records the deposit as paid at the bar and confirms the booking.',
  },
  extend: {
    open: 'Give longer to pay',
    submit: 'Save new time',
    explain: "The guest's payment link keeps working until the new time, no later than the booking start.",
  },
  waive: {
    open: 'Waive deposit',
    submit: 'Waive deposit',
    explain: "The booking is confirmed with no deposit, and the guest's payment link stops working.",
  },
}

/**
 * A manager settling a deposit the booking still owes, from the FOH iPad (BK-045, owner decision
 * D18): record it as taken at the bar, give the guest longer, or waive it. Shown only to accounts
 * with table_bookings manage; the route checks again. Each action asks why, and the reason goes on
 * the booking's audit trail.
 */
export function FohDepositActions({
  bookingId,
  bookingStartIso,
  bookingActionInFlight,
  onRunAction,
}: {
  bookingId: string
  bookingStartIso: string | null
  bookingActionInFlight: string | null
  onRunAction: (action: () => Promise<unknown>, successMessage: string, inFlightLabel?: string) => Promise<boolean>
}) {
  const [action, setAction] = useState<DepositAction | null>(null)
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function open(next: DepositAction) {
    setAction(next)
    setReason('')
    setFormError(null)
    setUntil(bookingStartIso ? utcIsoToLondonLocalInput(bookingStartIso) : '')
  }

  async function submit() {
    if (!action) return
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setFormError('Say why, so the next person can see it.')
      return
    }
    const holdUntil = action === 'extend' ? londonLocalInputToUtcIso(until) : null
    if (action === 'extend' && !holdUntil) {
      setFormError('Choose when the guest must pay by.')
      return
    }
    setFormError(null)
    const done = await onRunAction(
      () => postBookingAction(`/api/foh/bookings/${bookingId}/deposit`, {
        action,
        reason: trimmed,
        ...(holdUntil ? { hold_until: holdUntil } : {}),
      }),
      'Deposit updated',
      'deposit_action'
    )
    if (done) setAction(null)
  }

  const busy = Boolean(bookingActionInFlight)

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-xs font-semibold text-text">Deposit still owed</p>
      <div className="flex flex-wrap gap-2">
        {(['cash', 'extend', 'waive'] as const).map((key) => (
          <Button key={key} type="button" size="sm" variant="secondary" disabled={busy} onClick={() => open(key)}>
            {ACTION_LABELS[key].open}
          </Button>
        ))}
      </div>
      {action && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">{ACTION_LABELS[action].explain}</p>
          {action === 'extend' && (
            <Input
              label="Pay by"
              type="datetime-local"
              value={until}
              max={bookingStartIso ? utcIsoToLondonLocalInput(bookingStartIso) : undefined}
              onChange={(event) => setUntil(event.target.value)}
            />
          )}
          <Textarea
            label="Why"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
          />
          {formError && <p className="text-xs text-danger-fg" role="alert">{formError}</p>}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
              {bookingActionInFlight === 'deposit_action' ? 'Saving...' : ACTION_LABELS[action].submit}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
