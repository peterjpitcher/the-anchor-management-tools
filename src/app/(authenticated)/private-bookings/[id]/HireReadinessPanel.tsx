'use client'

import { useRef, useState } from 'react'
import { Alert, Button, Field, Input, Modal, Textarea, toast } from '@/ds'
import { formatDateFull } from '@/lib/dateUtils'
import { allowPrivateBookingOverCapacity } from '@/app/actions/privateBookingWorkflow'
import type { HireReadinessView } from '@/services/private-bookings/readiness'

interface HireReadinessPanelProps {
  bookingId: string
  view: HireReadinessView | null
  /** True when the page could not check the rooms; said plainly rather than shown as fine. */
  loadFailed?: boolean
  guestCount: number | null
  /** Managers only (gm_override); the action checks it again. */
  canOverrideCapacity: boolean
  onChanged: () => void
}

/**
 * What stops a private hire being confirmed, at the top of the booking page (review BK-005 and
 * BK-007, owner decision D24):
 * - "Deposit paid, not confirmed", with the reasons recorded when the deposit came in;
 * - no room booked, no guest count, or more guests than the rooms hold, with the room to add;
 * - for managers, a way to allow more guests than the rooms hold, recorded with a reason;
 * - "Contract not sent" once the deposit is confirmed, paid or waived (owner decision D25, review
 *   BK-006): until it is sent, or accepted another way, the booking cannot be confirmed.
 */
export function HireReadinessPanel({
  bookingId,
  view,
  loadFailed,
  guestCount,
  canOverrideCapacity,
  onChanged,
}: HireReadinessPanelProps): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const [maxGuests, setMaxGuests] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  if (loadFailed) {
    return (
      <Alert tone="warning" title="Rooms not checked">
        We could not check this booking&apos;s rooms and guest count. Refresh the page before confirming it.
      </Alert>
    )
  }
  if (!view || !view.live) return null

  const overCapacity = view.roomProblems.some((problem) => problem.code === 'over_capacity')
  const canOfferOverride = canOverrideCapacity && view.roomNames.length > 0

  function openDialog(): void {
    const suggested = Math.max(guestCount ?? 0, (view?.roomCapacity ?? 0) + 1)
    setMaxGuests(suggested > 0 ? String(suggested) : '')
    setReason('')
    setError(null)
    setOpen(true)
  }

  async function handleSave(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const result = await allowPrivateBookingOverCapacity({ bookingId, maxGuests, reason })
      if (!result.success) {
        const message = result.error ?? 'Nothing was saved.'
        setError(message)
        toast.error(message)
        return
      }
      toast.success(`Up to ${maxGuests} guests allowed in these rooms.`)
      setOpen(false)
      onChanged()
    } catch {
      const message = 'Nothing was saved: the request did not reach the server. Check your connection and try again.'
      setError(message)
      toast.error(message)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  const overrideButton = canOfferOverride ? (
    <Button type="button" variant="secondary" size="sm" onClick={openDialog}>
      Allow More Guests
    </Button>
  ) : null

  return (
    <>
      {view.paidNotConfirmed && (
        <Alert tone="danger" title="Deposit paid, not confirmed">
          <p>
            The deposit is in, but the booking is still a draft
            {view.paidNotConfirmed.recordedAt ? ` (since ${formatDateFull(view.paidNotConfirmed.recordedAt)})` : ''}.
            {view.paidNotConfirmed.reasons.length > 0 ? ' It did not confirm because:' : ' No reason was recorded.'}
          </p>
          {view.paidNotConfirmed.reasons.length > 0 && (
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {view.paidNotConfirmed.reasons.map((reasonText) => (
                <li key={reasonText}>{reasonText}</li>
              ))}
            </ul>
          )}
          <p className="mt-2">Sort these out, then confirm the booking with Change Status.</p>
        </Alert>
      )}

      {view.roomProblems.length > 0 && (
        <Alert
          tone="danger"
          title={view.status === 'confirmed' ? 'This confirmed hire needs its rooms sorting out' : 'This hire cannot be confirmed yet'}
        >
          <ul className="list-disc space-y-1 pl-5">
            {view.roomProblems.map((problem) => (
              <li key={problem.code}>{problem.message}</li>
            ))}
          </ul>
          {overCapacity && overrideButton && <div className="mt-3">{overrideButton}</div>}
        </Alert>
      )}

      {view.contractNotSent && (
        <Alert tone="warning" title="Contract not sent">
          {view.status === 'confirmed'
            ? 'This booking was confirmed without its contract being sent. Send it from the Signatures panel, or record that the customer accepted it another way.'
            : 'The contract has not been sent, so this booking cannot be confirmed. Send it from the Signatures panel, or record that the customer accepted it another way.'}
        </Alert>
      )}

      {view.capacityOverride && (
        <Alert tone="info" title="More guests allowed" role="status">
          A manager allowed up to {view.capacityOverride.maxGuests} guests in {view.roomNames.join(', ')}
          {view.capacityOverride.grantedAt ? ` on ${formatDateFull(view.capacityOverride.grantedAt)}` : ''}:{' '}
          {view.capacityOverride.reason}
        </Alert>
      )}

      {!overCapacity && !view.capacityOverride && canOfferOverride && view.roomCapacity !== null && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <span>
            {view.roomNames.join(', ')} {view.roomNames.length === 1 ? 'holds' : 'hold'} up to {view.roomCapacity} guests for this layout.
          </span>
          {overrideButton}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false)
        }}
        title="Allow More Guests"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleSave} loading={pending} disabled={pending}>
              Allow
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-text">
            {view.roomNames.join(', ')} {view.roomNames.length === 1 ? 'holds' : 'hold'}{' '}
            {view.roomCapacity !== null ? `up to ${view.roomCapacity} guests` : 'an unknown number of guests'} for this
            layout. This lets the booking be confirmed with more guests than that, for these rooms and this layout
            only. It is recorded with your name and reason.
          </p>
          <Field label="Guests to allow" required>
            <Input
              id="capacity-override-guests"
              type="number"
              min="1"
              step="1"
              value={maxGuests}
              onChange={(event) => setMaxGuests(event.target.value)}
              disabled={pending}
            />
          </Field>
          <Field label="Why the guests fit" required>
            <Textarea
              id="capacity-override-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={pending}
              placeholder="For example: standing reception, the garden is open as well"
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Modal>
    </>
  )
}
