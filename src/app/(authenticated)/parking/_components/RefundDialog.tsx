'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, Input, Textarea, Radio, Alert, Button, toast } from '@/ds'
import { processPayPalRefund, processManualRefund } from '@/app/actions/refundActions'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

export interface RefundDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceType: SourceType
  sourceId: string
  originalAmount: number
  totalRefunded: number
  totalPending: number
  hasPayPalCapture: boolean
  captureExpired: boolean
}

const methodOptions = [
  { value: 'paypal', label: 'PayPal' },
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'other', label: 'Other' },
]

export function RefundDialog({
  open,
  onOpenChange,
  sourceType,
  sourceId,
  originalAmount,
  totalRefunded,
  totalPending,
  hasPayPalCapture,
  captureExpired,
}: RefundDialogProps) {
  const router = useRouter()
  const remaining = Math.max(0, originalAmount - totalRefunded - totalPending)

  const [method, setMethod] = useState<string>(
    hasPayPalCapture && !captureExpired ? 'paypal' : 'cash'
  )
  const [amount, setAmount] = useState(remaining.toFixed(2))
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      const newRemaining = Math.max(0, originalAmount - totalRefunded - totalPending)
      setAmount(newRemaining.toFixed(2))
      setReason('')
      setError(null)
      setMethod(hasPayPalCapture && !captureExpired ? 'paypal' : 'cash')
    }
  }, [open, originalAmount, totalRefunded, totalPending, hasPayPalCapture, captureExpired])

  const parsedAmount = parseFloat(amount)
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= remaining
  const canSubmit = isValidAmount && reason.trim().length > 0 && !loading

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)

    try {
      let result: { success?: boolean; pending?: boolean; message?: string; error?: string }

      if (method === 'paypal') {
        result = await processPayPalRefund(sourceType, sourceId, parsedAmount, reason.trim())
      } else {
        result = await processManualRefund(
          sourceType, sourceId, parsedAmount, reason.trim(),
          method as 'cash' | 'bank_transfer' | 'other'
        )
      }

      if (result.error) { setError(result.error); return }
      if (result.pending) {
        toast.info(result.message || 'Refund is pending at PayPal.')
      } else {
        toast.success(`Refund of ${formatCurrency(parsedAmount)} processed successfully.`)
      }

      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={() => !loading && onOpenChange(false)} title="Process Refund">
      <div className="space-y-5">
        <div className="rounded-lg bg-surface-hover p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Original amount</span>
            <span className="font-medium text-text">{formatCurrency(originalAmount)}</span>
          </div>
          {totalRefunded > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Already refunded</span>
              <span className="font-medium text-success">-{formatCurrency(totalRefunded)}</span>
            </div>
          )}
          {totalPending > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Pending refunds</span>
              <span className="font-medium text-warning">-{formatCurrency(totalPending)}</span>
            </div>
          )}
          <div className="border-t border-border pt-2 flex justify-between text-sm">
            <span className="font-medium text-text">Refundable balance</span>
            <span className="font-semibold text-text">{formatCurrency(remaining)}</span>
          </div>
        </div>

        {remaining <= 0 && (
          <Alert tone="info">This payment has been fully refunded.</Alert>
        )}

        {remaining > 0 && (
          <>
            <fieldset>
              <legend className="block text-sm font-medium text-text mb-2">Refund method</legend>
              <div className="space-y-2">
                {methodOptions.map((opt) => {
                  const disabled = opt.value === 'paypal' && (!hasPayPalCapture || captureExpired)
                  return (
                    <Radio
                      key={opt.value}
                      name="refund-method"
                      value={opt.value}
                      label={opt.label}
                      checked={method === opt.value}
                      onChange={() => setMethod(opt.value)}
                      disabled={disabled}
                    />
                  )
                })}
              </div>
            </fieldset>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="refund-amount" className="block text-sm font-medium text-text">
                  Refund amount
                </label>
                {parsedAmount !== remaining && (
                  <button
                    type="button"
                    onClick={() => setAmount(remaining.toFixed(2))}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    Refund in full
                  </button>
                )}
              </div>
              <Input
                id="refund-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {amount && !isValidAmount && (
                <p className="mt-1 text-xs text-danger">
                  Enter an amount between £0.01 and {formatCurrency(remaining)}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="refund-reason" className="block text-sm font-medium text-text mb-1">
                Reason <span className="text-text-muted font-normal">(internal only)</span>
              </label>
              <Textarea
                id="refund-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this refund being processed?"
              />
            </div>

            {error && <Alert tone="danger">{error}</Alert>}
          </>
        )}
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleSubmit} loading={loading} disabled={!canSubmit}>
          Process Refund
        </Button>
      </div>
    </Modal>
  )
}
