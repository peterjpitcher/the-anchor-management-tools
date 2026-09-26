'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDateInLondon } from '@/lib/dateUtils'
import { formatCurrency } from '@/lib/format'
import { Alert, Button, ConfirmDialog, Empty, Icon, IconButton, Input, Select, SubHeading, toast } from '@/ds'
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

  // Spec-mandated state shape: no `date` field in editValues
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<{ amount: string; method: string }>({ amount: '', method: '' })
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Global lock: while any save or delete is in flight, all action buttons are disabled
  const isLocked = savingId !== null || deletingId !== null

  // Held deposits stay separate; only an actual invoice deposit credit reduces the event balance.
  const paidToDate = payments.reduce((sum, payment) => sum + (payment.type === 'balance' ? payment.amount : payment.appliedAmount ?? 0), 0)
  const outstanding = Math.max(0, totalAmount - paidToDate)

  function formatMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: 'Cash',
      card: 'Card',
      invoice: 'Invoice',
      paypal: 'PayPal',
      bank_transfer: 'Bank transfer',
      cheque: 'Cheque',
      other: 'Other',
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
      // No `date` field: editing the payment date is out of scope
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
      {/* Summary section: always rendered regardless of payments.length */}
      <div className="rounded-default border border-border bg-surface-2 p-3 mb-3 text-xs">
        <div className="flex justify-between text-text-muted">
          <span>Total</span>
          <span className="font-medium">{formatCurrency(totalAmount)}</span>
        </div>
        <div className="flex justify-between text-text-muted mt-1">
          <span>Paid to date</span>
          <span className="font-medium">{formatCurrency(paidToDate)}</span>
        </div>
        <div className="flex justify-between mt-1 font-semibold text-text">
          <span>Outstanding</span>
          <span>{formatCurrency(outstanding)}</span>
        </div>
      </div>

      <SubHeading className="mb-2">Payment History</SubHeading>

      {error && (
        <Alert tone="danger" size="sm" className="mb-2">{error}</Alert>
      )}

      {payments.length === 0 ? (
        <Empty size="sm" title="No payments yet" />
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
                  className="rounded-default border border-border bg-surface-2 p-2 space-y-2"
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
                        <span className="flex items-center h-full text-xs text-text px-2">PayPal</span>
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
                        <Icon name="check" size={16} />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={cancelEdit}
                        disabled={isLocked}
                        type="button"
                        aria-label="Cancel edit"
                      >
                        <Icon name="x" size={16} />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-text-muted"
              >
                <span className="min-w-0">
                  {formatDateInLondon(entry.date, { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' - '}
                  <span className="capitalize">{entry.type === 'deposit' && (entry.appliedAmount ?? 0) > 0 ? 'Deposit applied to invoice' : entry.type}</span>
                  {' · '}
                  {formatMethodLabel(entry.method)}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{formatCurrency(entry.amount)}</span>
                  {entry.invoice_id && (
                    <Link href={`/invoices/${entry.invoice_id}`} className="rounded-sm text-primary hover:underline focus-visible:outline-hidden focus-visible:shadow-ring">View invoice</Link>
                  )}
                  {canEditPayments && !entry.readonly && (
                    <div className="flex gap-1">
                      <IconButton
                        type="button"
                        size="sm"
                        onClick={() => startEdit(entry)}
                        className="text-text-muted"
                        label={`Edit ${entry.type} payment`}
                        disabled={isLocked}
                        icon={<Icon name="edit" size={14} />}
                      />
                      <IconButton
                        type="button"
                        size="sm"
                        onClick={() => {
                          setConfirmDeleteId(entry.id)
                          setEditingId(null)
                          setError(null)
                        }}
                        className="text-text-muted hover:text-danger"
                        label={`Delete ${entry.type} payment`}
                        disabled={isLocked}
                        icon={<Icon name="trash" size={14} />}
                      />
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
        title="Delete Payment"
        message="This removes the payment from the booking's record. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
      />
    </>
  )
}
