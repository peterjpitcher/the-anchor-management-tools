'use client'

import { useEffect, useState } from 'react'
import { ConfirmDialog, Input, toast } from '@/ds'
import type { EventBookingRow } from '@/app/actions/events'
import { getEventBookingRefundInfo, refundEventBookingManual } from '@/app/actions/events'

interface RefundInfo {
  canRefund: boolean
  amountPaid: number
  alreadyRefunded: number
  maxRefundable: number
  policySuggestion: number
}

interface RefundBookingDialogProps {
  booking: EventBookingRow | null
  onClose: () => void
  onDone: () => Promise<void> | void
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/**
 * After-the-fact refund for a paid (confirmed or cancelled) event booking.
 * Amount defaults to — and is capped at — the refundable amount; the server
 * re-validates, so the cap here is a courtesy, not the safety net.
 */
export function RefundBookingDialog({ booking, onClose, onDone }: RefundBookingDialogProps) {
  const [info, setInfo] = useState<RefundInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)

  // getEventBookingRefundInfo only computes a refundable amount for confirmed
  // prepaid bookings; for cancelled (or door-paid) bookings fall back to the
  // net paid amount already computed for the table. The server action
  // re-validates against the true maximum either way.
  const fallbackMax = Math.max(0, Number(booking?.paid_amount ?? 0))
  const maxRefundable = info && info.maxRefundable > 0 ? info.maxRefundable : fallbackMax

  useEffect(() => {
    if (!booking) {
      setInfo(null)
      setInfoLoading(false)
      setAmount('')
      setReason('')
      setAmountError(null)
      return
    }
    let cancelled = false
    setInfoLoading(true)
    setInfo(null)
    setAmountError(null)
    getEventBookingRefundInfo(booking.id)
      .then((result) => {
        if (cancelled) return
        if ('error' in result) {
          setAmount(Math.max(0, Number(booking.paid_amount ?? 0)).toFixed(2))
          return
        }
        setInfo(result.data)
        const defaultMax =
          result.data.maxRefundable > 0
            ? result.data.maxRefundable
            : Math.max(0, Number(booking.paid_amount ?? 0))
        setAmount(defaultMax > 0 ? defaultMax.toFixed(2) : '')
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [booking])

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

    const result = await refundEventBookingManual({
      bookingId: booking.id,
      amount: Number(parsedAmount.toFixed(2)),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    })
    if ('error' in result) {
      throw new Error(result.error)
    }

    const refundAmount = result.data.refund_amount || 0
    if (result.data.refund_status === 'succeeded') {
      toast.success(`Refund issued: ${formatCurrency(refundAmount)}`)
    } else if (result.data.refund_status === 'pending') {
      toast.success(`Refund pending: ${formatCurrency(refundAmount)}`)
    } else {
      toast.warning(`Refund needs staff follow-up: ${formatCurrency(refundAmount)}`)
    }
    await onDone()
  }

  return (
    <ConfirmDialog
      open={booking !== null}
      onClose={onClose}
      onConfirm={handleConfirm}
      title="Refund Booking"
      message={
        <div className="space-y-3">
          {infoLoading ? (
            <p className="text-sm text-text-muted">Checking payment…</p>
          ) : (
            <>
              {info && !info.canRefund ? (
                <p className="text-sm text-amber-700">
                  Only a manager can issue refunds on this booking.
                </p>
              ) : (
                <p className="text-sm text-text-muted">
                  {maxRefundable > 0
                    ? `Up to ${formatCurrency(maxRefundable)} can be refunded on this booking.`
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
                The refund goes back to the original payment where possible; anything we cannot
                send automatically is flagged for staff follow-up.
              </p>
            </>
          )}
        </div>
      }
      confirmLabel="Issue Refund"
      tone="danger"
      loading={infoLoading}
    />
  )
}
