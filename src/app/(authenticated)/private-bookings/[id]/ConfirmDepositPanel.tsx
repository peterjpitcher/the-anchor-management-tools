'use client'

import { useRef, useState } from 'react'
import { Alert, Button, FormGroup, Input, Modal, Textarea, toast } from '@/ds'
import { formatDateFull } from '@/lib/dateUtils'
import { confirmPrivateBookingDeposit } from '@/app/actions/privateBookingActions'

interface ConfirmDepositPanelProps {
  bookingId: string
  /** The amount on the booking now, which is only provisional until confirmed. */
  depositAmount: number
  /** The deadline confirming would set, worked out on the server when the page loaded. */
  holdExpiryPreview: string | null
  isDateTbd: boolean
  /** Staff who manage deposits (manage_deposits or manage); the action checks it again. */
  canConfirm: boolean
  onConfirmed: () => void
}

const STANDARD_DEPOSIT = 250

/**
 * "Deposit to be confirmed" on the booking page (flag private_booking_deposit_confirmation). The
 * guest has been told nothing about a deposit, so staff confirm the amount here, which sends the
 * one deposit request. Whatever happens is shown: the channel it went by, or why nothing went.
 */
export function ConfirmDepositPanel({
  bookingId,
  depositAmount,
  holdExpiryPreview,
  isDateTbd,
  canConfirm,
  onConfirmed,
}: ConfirmDepositPanelProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(depositAmount > 0 ? String(depositAmount) : '')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // State updates are not synchronous, so a fast double click would pass a state check twice.
  const inFlight = useRef(false)

  const amountValue = Number(amount)
  const needsReason = Number.isFinite(amountValue) && amountValue > 0 && amountValue < STANDARD_DEPOSIT
  const deadline = isDateTbd
    ? 'No deadline yet: the event date is still to be confirmed.'
    : holdExpiryPreview
      ? `The guest will be asked to pay by ${formatDateFull(holdExpiryPreview)}.`
      : null

  function openDialog(): void {
    setAmount(depositAmount > 0 ? String(depositAmount) : '')
    setReason('')
    setError(null)
    setOpen(true)
  }

  async function handleConfirm(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const result = await confirmPrivateBookingDeposit(bookingId, {
        amount,
        reductionReason: needsReason ? reason : undefined,
      })
      if (!result.success) {
        const message = result.error ?? 'Nothing was sent.'
        setError(message)
        toast.error(message)
        return
      }
      toast.success(result.data?.message ?? 'Deposit confirmed.')
      setOpen(false)
      onConfirmed()
    } catch {
      const message = 'Nothing was sent: the request did not reach the server. Check your connection and try again.'
      setError(message)
      toast.error(message)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <>
      <Alert tone="warning" title="Deposit to be confirmed" className="mb-6">
        <p>
          The guest has not been told a deposit yet. Deposit reminders and the automatic release of
          the hold are paused until you confirm it.
        </p>
        {canConfirm ? (
          <div className="mt-3">
            <Button type="button" variant="primary" size="sm" onClick={openDialog}>
              Confirm deposit
            </Button>
          </div>
        ) : (
          <p className="mt-2">Someone who manages deposits can confirm it.</p>
        )}
      </Alert>

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false)
        }}
        title="Confirm the deposit"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleConfirm} loading={pending} disabled={pending}>
              Confirm and send
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <FormGroup label="Deposit amount (£)" required>
            <Input
              id="confirm-deposit-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={pending}
            />
          </FormGroup>
          {needsReason && (
            <FormGroup label="Reason for the reduced deposit (General Manager)" required>
              <Textarea
                id="confirm-deposit-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={pending}
                placeholder="The standard deposit is £250"
              />
            </FormGroup>
          )}
          <div className="space-y-2 text-sm text-gray-700">
            {deadline && <p>{deadline}</p>}
            <p>
              We will email the guest that the deposit can be paid in cash at the bar or by PayPal,
              with a PayPal link. If they have no usable email address, we will text them instead.
            </p>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Modal>
    </>
  )
}
