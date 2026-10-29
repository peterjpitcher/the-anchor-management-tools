'use client'

import { useEffect, useState } from 'react'
import { Alert, ConfirmDialog, Fieldset, Input, PageLoading, Radio, toast } from '@/ds'
import type { EventBookingRow } from '@/app/actions/events'
import { getEventBookingRefundInfo, refundEventBookingManual } from '@/app/actions/events'

interface RefundInfo {
  canRefund: boolean
  amountPaid: number
  alreadyRefunded: number
  maxRefundable: number
  policySuggestion: number
  paypalRefundable: number
  barRefundable: number
}

/** A refund waiting for a manager after staff changed the booking (owner decision D7). */
export interface RefundRequestForDialog {
  id: string
  amount: number
  label: string
}

type RefundMethod = 'paypal' | 'cash' | 'card_terminal'

interface RefundBookingDialogProps {
  booking: EventBookingRow | null
  /** When set, the refund settles this waiting request, starting from its amount. */
  refundRequest?: RefundRequestForDialog | null
  onClose: () => void
  onDone: () => Promise<void> | void
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/**
 * After-the-fact refund for a paid (confirmed or cancelled) event booking.
 *
 * Money PayPal took goes back through PayPal. Money taken at the bar, in cash or on the card
 * terminal, is handed back there and recorded here as "Record cash or card refund" (BK-135):
 * before, the dialog offered it as a PayPal refund, nothing was recorded and the same money kept
 * being offered back. Amount defaults to (and is capped at) what the chosen method can return;
 * the server re-validates, so the cap here is a courtesy, not the safety net.
 */
export function RefundBookingDialog({ booking, refundRequest, onClose, onDone }: RefundBookingDialogProps) {
  const [info, setInfo] = useState<RefundInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<RefundMethod>('paypal')
  const [amountError, setAmountError] = useState<string | null>(null)
  // One id per opening of the dialog (BK-024). The server keys the refund on it, so a double
  // click replays this refund, while the next refund on the same booking is a new one. Every
  // manual refund used to share one key, so the second replayed the first and moved no money.
  const [requestId, setRequestId] = useState<string | null>(null)

  const atTheBar = method !== 'paypal'
  // getEventBookingRefundInfo counts every payment on the booking; when it cannot be read, fall
  // back to the net paid amount already computed for the table. The server re-validates.
  const fallbackMax = Math.max(0, Number(booking?.paid_amount ?? 0))
  const methodMax = info ? (atTheBar ? info.barRefundable : info.paypalRefundable) : fallbackMax
  const maxRefundable = methodMax > 0 ? methodMax : info ? 0 : fallbackMax

  useEffect(() => {
    if (!booking) {
      setInfo(null)
      setInfoLoading(false)
      setAmount('')
      setReason('')
      setMethod('paypal')
      setAmountError(null)
      setRequestId(null)
      return
    }
    setRequestId(crypto.randomUUID())
    let cancelled = false
    setInfoLoading(true)
    setInfo(null)
    setAmountError(null)
    getEventBookingRefundInfo(booking.id)
      .then((result) => {
        if (cancelled) return
        if ('error' in result) {
          setAmount(Math.max(0, Number(refundRequest?.amount ?? booking.paid_amount ?? 0)).toFixed(2))
          return
        }
        setInfo(result.data)
        // A booking paid only at the bar starts on the bar method.
        const startMethod: RefundMethod = result.data.paypalRefundable <= 0 && result.data.barRefundable > 0 ? 'cash' : 'paypal'
        setMethod(startMethod)
        const limit = startMethod === 'paypal' ? result.data.paypalRefundable : result.data.barRefundable
        const start = refundRequest ? Math.min(refundRequest.amount, limit) : limit
        setAmount(start > 0 ? start.toFixed(2) : '')
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [booking, refundRequest])

  const chooseMethod = (next: RefundMethod): void => {
    setMethod(next)
    setAmountError(null)
    if (!info) return
    const limit = next === 'paypal' ? info.paypalRefundable : info.barRefundable
    const start = refundRequest ? Math.min(refundRequest.amount, limit) : limit
    setAmount(start > 0 ? start.toFixed(2) : '')
  }

  const handleConfirm = async (): Promise<void> => {
    if (!booking) return
    if (info && !info.canRefund) {
      throw new Error('Only a manager can issue refunds.')
    }
    const parsedAmount = Number(amount)
    if (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setAmountError('Enter a refund amount greater than zero.')
      throw new Error('Enter a refund amount greater than zero.')
    }
    if (maxRefundable > 0 && parsedAmount > maxRefundable) {
      setAmountError(`Refund cannot exceed ${formatCurrency(maxRefundable)}.`)
      throw new Error(`Refund cannot exceed ${formatCurrency(maxRefundable)}.`)
    }

    if (!requestId) {
      throw new Error('Please close this window and open the refund again.')
    }

    const result = await refundEventBookingManual({
      bookingId: booking.id,
      requestId,
      amount: Number(parsedAmount.toFixed(2)),
      method,
      ...(refundRequest ? { refundRequestId: refundRequest.id } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    })
    if ('error' in result) {
      throw new Error(result.error)
    }

    const refundAmount = result.data.refund_amount || 0
    if (result.data.warning) {
      // The refund went through but the payment record did not update: say so, never "issued".
      toast.warning(result.data.warning, { duration: 12000 })
    } else if (result.data.refund_status === 'succeeded') {
      toast.success(atTheBar ? `Recorded: ${formatCurrency(refundAmount)} handed back` : `Refund issued: ${formatCurrency(refundAmount)}`)
    } else if (result.data.refund_status === 'pending') {
      toast.success(`Refund pending: ${formatCurrency(refundAmount)}`)
    } else {
      toast.warning(`Refund needs staff follow-up: ${formatCurrency(refundAmount)}`)
    }
    await onDone()
  }

  const showMethodChoice = Boolean(info && info.barRefundable > 0)

  return (
    <ConfirmDialog
      open={booking !== null}
      onClose={onClose}
      onConfirm={handleConfirm}
      title={refundRequest ? 'Decide the refund' : 'Refund Booking'}
      message={
        <div className="space-y-3">
          {infoLoading ? (
            <PageLoading inline label="Checking payment" className="py-4" />
          ) : (
            <>
              {info && !info.canRefund ? (
                <Alert tone="warning" size="sm">
                  Only a manager can issue refunds on this booking.
                </Alert>
              ) : null}
              {refundRequest && (
                <p className="text-sm text-text">
                  {refundRequest.label}: up to {formatCurrency(refundRequest.amount)}, the price paid. Refund what you decide,
                  or close this and choose No refund.
                </p>
              )}
              {showMethodChoice && (
                <Fieldset legend="How the money goes back">
                  {info && info.paypalRefundable > 0 && (
                    <Radio name="refund-method" value="paypal" label={`Through PayPal (up to ${formatCurrency(info.paypalRefundable)})`} checked={method === 'paypal'} onChange={() => chooseMethod('paypal')} />
                  )}
                  <Radio name="refund-method" value="cash" label="Record cash refund (handed back at the bar)" checked={method === 'cash'} onChange={() => chooseMethod('cash')} />
                  <Radio name="refund-method" value="card_terminal" label="Record card refund (on the card terminal)" checked={method === 'card_terminal'} onChange={() => chooseMethod('card_terminal')} />
                </Fieldset>
              )}
              {(!info || info.canRefund) && (
                <p className="text-sm text-text-muted">
                  {maxRefundable > 0
                    ? atTheBar
                      ? `Up to ${formatCurrency(maxRefundable)} was paid at the bar. Hand it back first, then record it here.`
                      : `Up to ${formatCurrency(maxRefundable)} can be refunded through PayPal on this booking.`
                    : info
                      ? 'Nothing is left to refund this way on this booking.'
                      : 'We could not confirm the refundable amount; the refund will be checked when you confirm.'}
                </p>
              )}
              <Input
                label="Refund amount"
                type="number"
                min={0}
                {...(maxRefundable > 0 ? { max: maxRefundable } : {})}
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setAmountError(null)
                }}
                placeholder="0.00"
                error={amountError ?? undefined}
              />
              <Input
                label="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. cancelled after payment"
                maxLength={200}
              />
              <p className="text-xs text-text-muted">
                {atTheBar
                  ? 'This records money already handed back. Nothing is sent through PayPal.'
                  : 'The refund goes back to the original payment where possible; anything we cannot send automatically is flagged for staff follow-up.'}
              </p>
            </>
          )}
        </div>
      }
      confirmLabel={atTheBar ? 'Record Refund' : 'Issue Refund'}
      tone="danger"
      loading={infoLoading}
    />
  )
}
