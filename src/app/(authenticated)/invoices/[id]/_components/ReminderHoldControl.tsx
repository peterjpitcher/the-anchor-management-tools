'use client'

import { useState, type FormEvent } from 'react'
import { Alert, Button, Card, CardBody, CardHeader, Input, toast } from '@/ds'
import { holdInvoiceReminders, resumeInvoiceReminders } from '@/app/actions/invoice-reminders'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { formatInvoiceDate } from '@/lib/invoices/email-copy'
import type { InvoiceStatus } from '@/types/invoices'

interface ReminderHoldControlProps {
  invoiceId: string
  status: InvoiceStatus
  /** `invoices.reminders_held_until`: reminders are held through this date, inclusive. */
  heldUntil: string | null | undefined
  /** Invoices edit permission. Without it the hold is shown, not changed. */
  canEdit: boolean
  /** Called with the new hold date, or null once reminders are resumed. */
  onChanged: (heldUntil: string | null) => void
}

/** Statuses that can still be chased. A draft has not been sent; the rest are finished. */
const CHASEABLE_STATUSES: InvoiceStatus[] = ['sent', 'partially_paid', 'overdue']

/**
 * Hold and resume for automatic invoice reminders. The server action checks the permission and
 * the date again; hiding the form here is a courtesy, not the control.
 */
export function ReminderHoldControl({ invoiceId, status, heldUntil, canEdit, onChanged }: ReminderHoldControlProps) {
  const today = getTodayIsoDate()
  const activeHold = heldUntil && heldUntil >= today ? heldUntil : null

  const [date, setDate] = useState(activeHold ?? '')
  const [reason, setReason] = useState('')
  const [dateError, setDateError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<'hold' | 'resume' | null>(null)

  if (!CHASEABLE_STATUSES.includes(status)) return null

  async function handleHold(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)

    if (!date) {
      setDateError('Choose a date to hold reminders until')
      return
    }
    if (date < today) {
      setDateError('The hold date must be today or later.')
      return
    }
    setDateError(null)

    setSaving('hold')
    try {
      const result = await holdInvoiceReminders({ invoiceId, heldUntil: date, reason: reason.trim() || undefined })
      if (result.error || !result.success) {
        setError(result.error ?? 'The hold could not be saved.')
        return
      }
      setReason('')
      onChanged(date)
      toast.success(`Reminders held until ${formatInvoiceDate(date)}`)
    } catch {
      setError('The hold could not be saved. Check your connection and try again.')
    } finally {
      setSaving(null)
    }
  }

  async function handleResume(): Promise<void> {
    setError(null)
    setDateError(null)
    setSaving('resume')
    try {
      const result = await resumeInvoiceReminders({ invoiceId })
      if (result.error || !result.success) {
        setError(result.error ?? 'The hold could not be lifted.')
        return
      }
      setDate('')
      setReason('')
      onChanged(null)
      toast.success('Reminders resumed')
    } catch {
      setError('The hold could not be lifted. Check your connection and try again.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card>
      <CardHeader title="Automatic reminders" />
      <CardBody className="space-y-3">
        {/* role="status": a change made here is read out without stealing focus. */}
        <p className="text-sm" role="status">
          {activeHold
            ? `Held until ${formatInvoiceDate(activeHold, { withYear: true })}. No automatic reminder will go on or before that date.`
            : 'Not held. Hold them when a payment is on its way and a reminder would be unwelcome.'}
        </p>

        {error && <Alert tone="danger">{error}</Alert>}

        {canEdit && (
          <form onSubmit={(event) => void handleHold(event)} className="space-y-3" noValidate>
            <Input
              type="date"
              label="Hold reminders until"
              value={date}
              min={today}
              onChange={(event) => {
                setDate(event.target.value)
                setDateError(null)
              }}
              error={dateError ?? undefined}
              hint="Reminders stay off through this date."
              disabled={saving !== null}
              required
            />
            <Input
              type="text"
              label="Reason (optional)"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              hint="Kept in the audit log with your name."
              disabled={saving !== null}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" loading={saving === 'hold'} disabled={saving !== null}>
                {activeHold ? 'Change hold' : 'Hold reminders'}
              </Button>
              {activeHold && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleResume()}
                  loading={saving === 'resume'}
                  disabled={saving !== null}
                >
                  Resume reminders
                </Button>
              )}
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  )
}
