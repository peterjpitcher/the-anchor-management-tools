'use client'

import { useRef, useState } from 'react'
import { Alert, Button, Field, Input, Modal, toast } from '@/ds'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { previewEndRecurringCharge, endRecurringCharge, type EndChargePreview } from '@/app/actions/oj-projects/recurring-charges'

interface EndRecurringChargeModalProps {
  charge: { id: string; description: string; created_at: string }
  onClose: () => void
  onEnded: () => Promise<void>
}

const money = (amount: number): string => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)

export function EndRecurringChargeModal({ charge, onClose, onEnded }: EndRecurringChargeModalProps) {
  const [endDate, setEndDate] = useState(getTodayIsoDate)
  const [preview, setPreview] = useState<EndChargePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)

  async function loadPreview(): Promise<void> {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    setPreview(null)
    try {
      const result = await previewEndRecurringCharge(charge.id, endDate)
      if (result.error || !result.preview) setError(result.error || 'Could not preview the final charge')
      else setPreview(result.preview)
    } catch {
      setError('Could not preview the final charge. Please try again.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  async function confirmEnd(): Promise<void> {
    if (busy.current || !preview || preview.endDate !== endDate) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const result = await endRecurringCharge(charge.id, endDate, preview)
      if (result.error || !result.preview) {
        setError(result.error || 'Could not end the recurring charge')
        setPreview(null)
        return
      }
      await onEnded()
      toast.success('Recurring charge ended')
      onClose()
    } catch {
      setError('Could not complete the change. Please refresh the client before trying again.')
      setPreview(null)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return (
    <Modal open onClose={() => { if (!busy.current) onClose() }} title="End recurring charge"
      description={charge.description} width="lg"
      footer={<>
        <Button onClick={onClose} disabled={pending}>Cancel</Button>
        <Button onClick={loadPreview} disabled={pending || !endDate}>Preview final charge</Button>
        <Button variant="primary" onClick={confirmEnd} disabled={pending || !preview || preview.endDate !== endDate}>
          End charge
        </Button>
      </>}>
      <div className="space-y-4 text-sm">
        <Field label="Last service date" required>
          <Input type="date" value={endDate} disabled={pending} onChange={(event) => {
            setEndDate(event.target.value)
            setPreview(null)
            setError(null)
          }} />
        </Field>
        <p>The selected day is included. The final charge is calculated by calendar days and follows the normal billing schedule and any monthly cap. Ending this charge sends no email.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        {preview && <>
          <p className="font-semibold text-text-strong">Outstanding charge including earlier arrears and final amount</p>
          {preview.items.length === 0 && <p>No outstanding charge remains.</p>}
          <ul className="space-y-2">
            {preview.items.map((item, index) => <li key={item.id || `final-${index}`} className="rounded-default border border-border p-3">
              <p>{item.start} to {item.removed ? item.originalEnd : item.end}</p>
              <p>{item.removed
                ? `${money(item.previousAmountExVat)} ex VAT removed for future service`
                : `${money(item.amountExVat)} ex VAT, ${money(item.amountIncVat)} inc VAT`}</p>
            </li>)}
          </ul>
          {preview.items.some((item) => item.removed) && <Alert tone="warning">Future service after the last service date will be removed from the outstanding charge.</Alert>}
          <p className="font-semibold text-text-strong">Total outstanding: {money(preview.totalExVat)} ex VAT, {money(preview.totalIncVat)} inc VAT</p>
        </>}
      </div>
    </Modal>
  )
}
