'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PencilIcon, TrashIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { formatDateInLondon } from '@/lib/dateUtils'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { editPrivateBookingPayment, deletePrivateBookingPayment } from '@/app/actions/privateBookingActions'
import type { PaymentHistoryEntry } from '@/types/private-bookings'

interface PaymentHistoryTableProps {
  payments: PaymentHistoryEntry[]
  bookingId: string
  canEditPayments: boolean
  totalAmount: number
}

type DepositMethod = 'cash' | 'card' | 'invoice' | 'paypal'

export default function PaymentHistoryTable({
  payments,
  bookingId,
  canEditPayments,
  totalAmount,
}: PaymentHistoryTableProps): React.ReactElement {
  const router = useRouter()

  // Spec-mandated state shape — no `date` field in editValues
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<{ amount: string; method: string }>({ amount: '', method: '' })
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Global lock: while any save or delete is in flight, all action buttons are disabled
  const isLocked = savingId !== null || deletingId !== null

  // Summary figures — computed regardless of payments.length
  // Security deposit is a returnable bond — only balance payments reduce the outstanding amount
  const paidToDate = payments.filter(p => p.type === 'balance').reduce((sum, p) => sum + p.amount, 0)
  const outstanding = Math.max(0, totalAmount - paidToDate)

  function formatMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: 'Cash',
      card: 'Card',
      invoice: 'Invoice',
      paypal: 'PayPal',
    }
    return labels[method] ?? method
  }

  function startEdit(entry: PaymentHistoryEntry): void {
    setEditingId(entry.id)
    setEditValues({ amount: String(entry.amount), method: entry.method })
    setConfirmDeleteId(null)
    setError(null)
  }

  function cancelEdit(): void {
    setEditingId(null)
    setError(null)
  }

  async function handleSave(entry: PaymentHistoryEntry): Promise<void> {
    if (!editingId) return
    setSavingId(editingId)
    try {
      const formData = new FormData()
      formData.set('paymentId', entry.id)
      formData.set('bookingId', bookingId)
      formData.set('type', entry.type)
      formData.set('amount', editValues.amount)
      formData.set('method', editValues.method)
      // No `date` field — editing the payment date is out of scope
      const result = await editPrivateBookingPayment(formData)
      if (result.success) {
        toast.success('Payment updated')
        setSavingId(null)
        setEditingId(null)
        router.refresh()
      } else {
        setSavingId(null)
        setError(result.error ?? 'Failed to update payment')
        toast.error(result.error ?? 'Failed to update payment')
        router.refresh()
      }
    } catch {
      setSavingId(null)
      setError('Failed to update payment')
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!confirmDeleteId) return
    const target = payments.find((p) => p.id === confirmDeleteId)
    if (!target) return
    setDeletingId(confirmDeleteId)
    setConfirmDeleteId(null)
    try {
      const formData = new FormData()
      formData.set('paymentId', target.id)
      formData.set('bookingId', bookingId)
      formData.set('type', target.type)
      const result = await deletePrivateBookingPayment(formData)
      if (result.success) {
        toast.success('Payment deleted')
        setDeletingId(null)
        router.refresh()
      } else {
        setDeletingId(null)
        setError(result.error ?? 'Failed to delete payment')
        toast.error(result.error ?? 'Failed to delete payment')
        router.refresh()
      }
    } catch {
      setDeletingId(null)
      setError('Failed to delete payment')
    }
  }

  return (
    <>
      {/* Summary section — always rendered regardless of payments.length */}
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 mb-3 text-xs">
        <div className="flex justify-between text-gray-600">
          <span>Total</span>
          <span className="font-medium">{formatCurrency(totalAmount)}</span>
        </div>
        <div className="flex justify-between text-gray-600 mt-1">
          <span>Paid to date</span>
          <span className="font-medium">{formatCurrency(paidToDate)}</span>
        </div>
        <div className="flex justify-between mt-1 font-semibold text-gray-800">
          <span>Outstanding</span>
          <span>{formatCurrency(outstanding)}</span>
        </div>
      </div>

      <p className="text-xs font-medium text-gray-500 mb-2">Payment history</p>

      {error && (
        <p className="text-xs text-red-600 mb-2">{error}</p>
      )}

      {payments.length === 0 ? (
        <p className="text-xs text-gray-400">No payments recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {payments.map((entry) => {
            const isEditing = editingId === entry.id
            const isDepositEntry = entry.type === 'deposit'
            const isPayPalDeposit = isDepositEntry && entry.method === 'paypal'

            if (isEditing) {
              return (
                <div
                  key={entry.id}
                  className="rounded-md border border-gray-200 bg-gray-50 p-2 space-y-2"
                >
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        type="number"
                        value={editValues.amount}
                        onChange={(e) =>
                          setEditValues((prev) => ({ ...prev, amount: e.target.value }))
                        }
                        disabled={isLocked}
                        min="0.01"
                        step="0.01"
                        placeholder="Amount"
                        aria-label="Payment amount"
                        inputSize="sm"
                      />
                    </div>
                    <div className="flex-1">
                      {/* PayPal deposit: read-only; non-PayPal deposit or balance: select without PayPal */}
                      {isPayPalDeposit ? (
                        <span className="flex items-center h-full text-xs text-gray-700 px-2">PayPal</span>
                      ) : (
                        <Select
                          value={editValues.method}
                          onChange={(e) =>
                            setEditValues((prev) => ({
                              ...prev,
                              method: e.target.value as DepositMethod,
                            }))
                          }
                          disabled={isLocked}
                          selectSize="sm"
                          aria-label="Payment method"
                        >
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="invoice">Invoice</option>
                        </Select>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleSave(entry)}
                        loading={savingId === entry.id}
                        disabled={isLocked}
                        aria-label="Save payment"
                      >
                        <CheckIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={cancelEdit}
                        disabled={isLocked}
                        type="button"
                        aria-label="Cancel edit"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={entry.id}
                className="flex items-center justify-between text-xs text-gray-600"
              >
                <span>
                  {formatDateInLondon(entry.date, { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' — '}
                  <span className="capitalize">{entry.type}</span>
                  {' · '}
                  {formatMethodLabel(entry.method)}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{formatCurrency(entry.amount)}</span>
                  {canEditPayments && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(entry)}
                        className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400 rounded"
                        aria-label={`Edit ${entry.type} payment`}
                        disabled={isLocked}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(entry.id)
                          setEditingId(null)
                          setError(null)
                        }}
                        className="text-gray-400 hover:text-red-600 focus:outline-none focus:ring-1 focus:ring-red-400 rounded"
                        aria-label={`Delete ${entry.type} payment`}
                        disabled={isLocked}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete payment"
        message="Are you sure you want to delete this payment? This cannot be undone."
        type="danger"
        destructive
        confirmText="Delete"
        confirmVariant="danger"
      />
    </>
  )
}
