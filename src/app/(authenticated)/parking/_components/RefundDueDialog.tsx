'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Fieldset, Input, Modal, Radio, Textarea, toast } from '@/ds'
import { settleParkingRefundDue } from '@/app/actions/parking'

export interface RefundDueDialogProps {
  open: boolean
  bookingId: string
  reference: string
  /** The refund still to do, in pounds (positive). */
  due: number
  onClose: () => void
  onSettled: () => void | Promise<void>
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Settles a "refund to do" left by a date change: send some or all of it, or record that none is
 * due. Whatever is not sent is recorded as kept, so the booking reads settled.
 */
export function RefundDueDialog({ open, bookingId, reference, due, onClose, onSettled }: RefundDueDialogProps) {
  const [operationId, setOperationId] = useState(newOperationId)
  const [choice, setChoice] = useState<'refund' | 'none'>('refund')
  const [amount, setAmount] = useState(due.toFixed(2))
  const [reason, setReason] = useState('')
  const [manualMethod, setManualMethod] = useState<'cash' | 'bank_transfer'>('cash')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setOperationId(newOperationId())
    setChoice('refund')
    setAmount(due.toFixed(2))
    setReason('')
    setManualMethod('cash')
    setError(null)
  }, [open, due])

  const parsed = Number.parseFloat(amount)
  const amountValid = choice === 'none' || (Number.isFinite(parsed) && parsed > 0 && parsed <= due + 0.005)
  const canSave = amountValid && reason.trim().length > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const result = await settleParkingRefundDue(bookingId, {
        operationId,
        noRefund: choice === 'none',
        amount: choice === 'none' ? 0 : parsed,
        reason: reason.trim(),
        manualRefundMethod: manualMethod,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.warning) toast.error(result.warning, { duration: 20000 })
      else toast.success(choice === 'none' ? 'Recorded: no refund due' : `Refund of ${money(result.refunded ?? parsed)} sent`)
      await onSettled()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not settle the refund')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={`Refund to do: ${reference}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant={choice === 'none' ? 'primary' : 'danger'} onClick={handleSave} loading={saving} disabled={!canSave}>
            {choice === 'none' ? 'Record no refund due' : 'Send refund'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="info">This booking has {money(due)} still to refund after its dates were changed.</Alert>
        <Fieldset legend="What to do">
          <Radio name="refund-due-choice" value="refund" label="Send a refund" checked={choice === 'refund'} onChange={() => setChoice('refund')} />
          <Radio
            name="refund-due-choice"
            value="none"
            label="No refund due"
            description="The difference is kept. The reason is recorded on the booking."
            checked={choice === 'none'}
            onChange={() => setChoice('none')}
          />
        </Fieldset>
        {choice === 'refund' && (
          <>
            <Input
              label={`Amount (up to ${money(due)})`}
              type="number"
              min="0.01"
              step="0.01"
              max={due.toFixed(2)}
              value={amount}
              error={amountValid ? undefined : `Enter an amount from £0.01 to ${money(due)}`}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Fieldset legend="If it cannot go back through PayPal">
              <Radio name="refund-due-manual" value="cash" label="Cash" checked={manualMethod === 'cash'} onChange={() => setManualMethod('cash')} />
              <Radio name="refund-due-manual" value="bank_transfer" label="Bank transfer" checked={manualMethod === 'bank_transfer'} onChange={() => setManualMethod('bank_transfer')} />
            </Fieldset>
          </>
        )}
        <Textarea label="Reason (internal only)" required value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  )
}
