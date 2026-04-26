'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { RadioGroup, type RadioOption } from '@/components/ui-v2/forms/Radio'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { processPayPalRefund, processManualRefund } from '@/app/actions/refundActions'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

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

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      const newRemaining = Math.max(0, originalAmount - totalRefunded - totalPending)
      setAmount(newRemaining.toFixed(2))
      setReason('')
      setError(null)
      setMethod(hasPayPalCapture && !captureExpired ? 'paypal' : 'cash')
    }
  }, [open, originalAmount, totalRefunded, totalPending, hasPayPalCapture, captureExpired])

  const methodOptions: RadioOption[] = [
    {
      value: 'paypal',
      label: 'PayPal',
      description: !hasPayPalCapture
        ? 'No PayPal payment on record'
        : captureExpired
          ? 'Refund window expired (180 days)'
          : 'Refund to original PayPal payment',
      disabled: !hasPayPalCapture || captureExpired,
    },
    { value: 'cash', label: 'Cash', description: 'Cash refund given in person' },
    { value: 'bank_transfer', label: 'Bank Transfer', description: 'Direct bank transfer' },
    { value: 'other', label: 'Other', description: 'Other refund method' },
  ]

  const parsedAmount = parseFloat(amount)
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= remaining
  const canSubmit = isValidAmount && reason.trim().length > 0 && !loading

  const handleRefundInFull = () => {
    setAmount(remaining.toFixed(2))
  }

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
          sourceType,
          sourceId,
          parsedAmount,
          reason.trim(),
          method as 'cash' | 'bank_transfer' | 'other'
        )
      }

      if (result.error) {
        setError(result.error)
        return
      }

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
    <Modal
      open={open}
      onClose={() => !loading && onOpenChange(false)}
      title="Process Refund"
      size="md"
      footer={
        <ModalActions>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
          >
            Process Refund
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-5">
        {/* Amount summary */}
        <div className="rounded-lg bg-gray-50 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Original amount</span>
            <span className="font-medium text-gray-900">{formatCurrency(originalAmount)}</span>
          </div>
          {totalRefunded > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Already refunded</span>
              <span className="font-medium text-green-700">-{formatCurrency(totalRefunded)}</span>
            </div>
          )}
          {totalPending > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Pending refunds</span>
              <span className="font-medium text-amber-700">-{formatCurrency(totalPending)}</span>
            </div>
          )}
          <div className="border-t border-gray-200 pt-2 flex justify-between text-sm">
            <span className="font-medium text-gray-900">Refundable balance</span>
            <span className="font-semibold text-gray-900">{formatCurrency(remaining)}</span>
          </div>
        </div>

        {remaining <= 0 && (
          <Alert variant="info">
            This payment has been fully refunded. No further refunds can be processed.
          </Alert>
        )}

        {remaining > 0 && (
          <>
            {/* Refund method */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Refund method
              </label>
              <RadioGroup
                name="refund-method"
                options={methodOptions}
                value={method}
                onChange={(val) => setMethod(val)}
                size="sm"
              />
            </div>

            {/* Amount input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="refund-amount" className="block text-sm font-medium text-gray-700">
                  Refund amount
                </label>
                {parsedAmount !== remaining && (
                  <button
                    type="button"
                    onClick={handleRefundInFull}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium"
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
                min="0.01"
                max={remaining.toFixed(2)}
                step="0.01"
                leftElement={
                  <span className="pl-3 text-gray-500 text-sm flex items-center h-full">£</span>
                }
                error={
                  amount && !isValidAmount
                    ? `Enter an amount between £0.01 and ${formatCurrency(remaining)}`
                    : undefined
                }
              />
            </div>

            {/* Reason */}
            <div>
              <label htmlFor="refund-reason" className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-gray-400 font-normal">(internal only)</span>
              </label>
              <Textarea
                id="refund-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this refund being processed?"
                error={reason.length === 0 ? undefined : undefined}
              />
            </div>

            {/* Error banner */}
            {error && (
              <Alert variant="error">
                {error}
              </Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
