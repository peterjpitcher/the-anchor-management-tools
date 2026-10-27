'use client'

import { useState } from 'react'
import { Alert, Button, Checkbox, Field, Fieldset, Input, Radio, Select, Textarea, toast } from '@/ds'
import { formatCurrency } from '@/lib/format'
import { closeOutPrivateBooking } from '@/app/actions/privateBookingActions'

/**
 * Close the hire after the night (BK-062, BK-131; owner decision D27): the balance settled at the
 * till, what happened to the deposit, and the booking completed. Nothing is sent to the guest.
 */
export interface CloseOutPanelProps {
  bookingId: string
  /** Outstanding balance, VAT included; 0 when settled. */
  balanceOutstanding: number
  /** Deposit still held, after any refunds; 0 when there is none to close. */
  depositLeft: number
  /** An invoiced hire's payments belong on its invoice, so neither is recorded here. */
  invoiced: boolean
  canClose: boolean
  canRefund: boolean
  onOpenRefund: () => void
  onClosed: () => void
}

type DepositChoice = 'returned' | 'kept' | 'applied' | 'paypal'

export function CloseOutPanel({
  bookingId,
  balanceOutstanding,
  depositLeft,
  invoiced,
  canClose,
  canRefund,
  onOpenRefund,
  onClosed,
}: CloseOutPanelProps): React.ReactElement {
  // Putting the deposit against the bill is only offered when it fits inside the balance left:
  // otherwise the guest would be recorded as paying more than the bill, so staff return or keep it.
  const canApplyDeposit = !invoiced && depositLeft > 0 && depositLeft <= balanceOutstanding
  const [settledAtTill, setSettledAtTill] = useState(balanceOutstanding > 0 && !invoiced)
  const [balanceMethod, setBalanceMethod] = useState<'card' | 'cash'>('card')
  const [deposit, setDeposit] = useState<DepositChoice>('returned')
  const [depositMethod, setDepositMethod] = useState<'card' | 'cash'>('card')
  const [keptStr, setKeptStr] = useState(depositLeft.toFixed(2))
  const [keptReason, setKeptReason] = useState('')
  const [saving, setSaving] = useState(false)

  const methodOptions = [
    { value: 'card', label: 'Card' },
    { value: 'cash', label: 'Cash' },
  ]

  async function handleClose(): Promise<void> {
    if (depositLeft > 0 && deposit === 'paypal') {
      onOpenRefund()
      return
    }
    const kept = Number(keptStr)
    setSaving(true)
    const result = await closeOutPrivateBooking(bookingId, {
      balanceSettledAtTill: balanceOutstanding > 0 && !invoiced && settledAtTill ? { method: balanceMethod } : null,
      deposit: depositLeft <= 0
        ? null
        : deposit === 'returned'
          ? { outcome: 'returned', method: depositMethod }
          : deposit === 'applied' && canApplyDeposit
            ? { outcome: 'applied' }
            : { outcome: 'kept', amount: kept, reason: keptReason, restMethod: depositMethod },
    })
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Hire closed. The guest has not been sent anything.')
    onClosed()
  }

  return (
    <Alert tone="info" title="Close out this hire">
      <div className="space-y-4">
        <p>
          The event has happened. Record how it was settled, then close the booking. The guest is
          not sent anything.
        </p>

        {balanceOutstanding > 0 && invoiced && (
          <p>
            The {formatCurrency(balanceOutstanding)} balance is on the invoice: record any payment
            there.
          </p>
        )}

        {balanceOutstanding > 0 && !invoiced && (
          <div className="space-y-2">
            <Checkbox
              label={`The ${formatCurrency(balanceOutstanding)} balance was settled at the till on the night`}
              checked={settledAtTill}
              onChange={(checked) => setSettledAtTill(checked)}
              disabled={saving || !canClose}
            />
            {settledAtTill && (
              <Field label="Paid by">
                <Select value={balanceMethod} onChange={(e) => setBalanceMethod(e.target.value as 'card' | 'cash')} options={methodOptions} disabled={saving} />
              </Field>
            )}
          </div>
        )}

        {depositLeft > 0 && (
          <Fieldset legend={`The ${formatCurrency(depositLeft)} deposit`}>
            <Radio name="close-out-deposit" value="returned" label="Returned at the till" checked={deposit === 'returned'} onChange={() => setDeposit('returned')} />
            <Radio name="close-out-deposit" value="kept" label="Kept, in full or in part" checked={deposit === 'kept'} onChange={() => setDeposit('kept')} />
            {canApplyDeposit && (
              <Radio name="close-out-deposit" value="applied" label="Put against the final bill" checked={deposit === 'applied'} onChange={() => setDeposit('applied')} />
            )}
            {!canApplyDeposit && (
              <p className="text-sm text-text-muted">
                {invoiced
                  ? 'To put the deposit against the bill, record it on the invoice.'
                  : `The deposit is more than the ${formatCurrency(balanceOutstanding)} balance left, so it cannot all go against the bill: return or keep it.`}
              </p>
            )}
            {canRefund && (
              <Radio name="close-out-deposit" value="paypal" label="Refund it through PayPal (opens Process Refund)" checked={deposit === 'paypal'} onChange={() => setDeposit('paypal')} />
            )}
          </Fieldset>
        )}

        {depositLeft > 0 && deposit === 'kept' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Amount kept (£)" hint={`Up to ${formatCurrency(depositLeft)}. Needs manager permission.`}>
              <Input type="number" min="0" step="0.01" max={depositLeft.toFixed(2)} value={keptStr} onChange={(e) => setKeptStr(e.target.value)} disabled={saving} />
            </Field>
            <Field label="Why it was kept">
              <Textarea value={keptReason} onChange={(e) => setKeptReason(e.target.value)} rows={2} required disabled={saving} placeholder="For example, damage to the dining room table" />
            </Field>
          </div>
        )}

        {depositLeft > 0 && (deposit === 'returned' || (deposit === 'kept' && Number(keptStr) < depositLeft)) && (
          <Field label={deposit === 'kept' ? 'The rest was returned by' : 'Returned by'}>
            <Select value={depositMethod} onChange={(e) => setDepositMethod(e.target.value as 'card' | 'cash')} options={methodOptions} disabled={saving} />
          </Field>
        )}

        {canClose && (
          <Button type="button" variant="primary" size="sm" onClick={handleClose} loading={saving}>
            {depositLeft > 0 && deposit === 'paypal' ? 'Open Process Refund' : 'Close the hire'}
          </Button>
        )}
      </div>
    </Alert>
  )
}
