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
type BalanceMethod = 'cash' | 'card' | 'invoice'

interface EditState {
  entryId: string
  amount: string
  method: DepositMethod | BalanceMethod
  date: string
}

export default function PaymentHistoryTable({
  payments,
  bookingId,
  canEditPayments,
}: PaymentHistoryTableProps): React.ReactElement | null {
  const router = useRouter()
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PaymentHistoryEntry | null>(null)

  if (payments.length === 0) {
    return null
  }

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
    setEditState({
      entryId: entry.id,
      amount: String(entry.amount),
      method: entry.method,
      date: entry.date,
    })
  }

  function cancelEdit(): void {
    setEditState(null)
  }

  async function handleSave(entry: PaymentHistoryEntry): Promise<void> {
    if (!editState) return
    setSaving(true)
    try {
      const formData = new FormData()
      formData.set('paymentId', entry.id)
      formData.set('bookingId', bookingId)
      formData.set('type', entry.type)
      formData.set('amount', editState.amount)
      formData.set('method', editState.method)
      formData.set('date', editState.date)
      const result = await editPrivateBookingPayment(formData)
      if (result.success) {
        toast.success('Payment updated')
        setEditState(null)
        router.refresh()
      } else {
        toast.error(result.error ?? 'Failed to update payment')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!deleteTarget) return
    setDeletingId(deleteTarget.id)
    try {
      const formData = new FormData()
      formData.set('paymentId', deleteTarget.id)
      formData.set('bookingId', bookingId)
      formData.set('type', deleteTarget.type)
      const result = await deletePrivateBookingPayment(formData)
      if (result.success) {
        toast.success('Payment deleted')
        router.refresh()
      } else {
        toast.error(result.error ?? 'Failed to delete payment')
      }
    } finally {
      setDeletingId(null)
      setDeleteTarget(null)
    }
  }

  return (
    <>
      <p className="text-xs font-medium text-gray-500 mb-2">Payment history</p>
      <div className="space-y-2">
        {payments.map((entry) => {
          const isEditing = editState?.entryId === entry.id
          const isDeleting = deletingId === entry.id
          const isDepositEntry = entry.type === 'deposit'

          if (isEditing && editState) {
            return (
              <div
                key={entry.id}
                className="rounded-md border border-gray-200 bg-gray-50 p-2 space-y-2"
              >
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      value={editState.amount}
                      onChange={(e) =>
                        setEditState((prev) => prev ? { ...prev, amount: e.target.value } : prev)
                      }
                      disabled={saving}
                      min="0.01"
                      step="0.01"
                      placeholder="Amount"
                      aria-label="Payment amount"
                      inputSize="sm"
                    />
                  </div>
                  <div className="flex-1">
                    <Select
                      value={editState.method}
                      onChange={(e) =>
                        setEditState((prev) =>
                          prev ? { ...prev, method: e.target.value as DepositMethod | BalanceMethod } : prev
                        )
                      }
                      disabled={saving}
                      selectSize="sm"
                      aria-label="Payment method"
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="invoice">Invoice</option>
                      {isDepositEntry && <option value="paypal">PayPal</option>}
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="date"
                      value={editState.date}
                      onChange={(e) =>
                        setEditState((prev) => prev ? { ...prev, date: e.target.value } : prev)
                      }
                      disabled={saving}
                      aria-label="Payment date"
                      inputSize="sm"
                    />
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSave(entry)}
                      loading={saving}
                      disabled={saving}
                      aria-label="Save payment"
                    >
                      <CheckIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={cancelEdit}
                      disabled={saving}
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
                      disabled={isDeleting}
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(entry)}
                      className="text-gray-400 hover:text-red-600 focus:outline-none focus:ring-1 focus:ring-red-400 rounded"
                      aria-label={`Delete ${entry.type} payment`}
                      disabled={isDeleting}
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

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
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
