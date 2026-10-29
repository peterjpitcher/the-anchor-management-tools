'use client'

import { useEffect, useState } from 'react'
import { Alert, ConfirmDialog, Input, PageLoading, Select, toast } from '@/ds'
import { getEventTransferPreview, transferEventBooking } from '@/app/actions/events'

export interface TransferTarget {
  bookingId: string
  targetEventId: string
  targetLabel: string
}

interface TransferBookingDialogProps {
  target: TransferTarget | null
  onClose: () => void
  onDone: () => Promise<void> | void
}

type Preview = Extract<Awaited<ReturnType<typeof getEventTransferPreview>>, { success: true }>['data']

const REASON_TEXT: Record<string, string> = {
  target_event_costs_more: 'The new night costs more than was paid, so the booking cannot move there.',
  transfer_already_used: 'This booking has already been moved once.',
  booking_not_confirmed: 'Only a confirmed booking can be moved.',
  booking_closed: 'The new night is not taking bookings.',
  not_bookable: 'The new night is cancelled or not open.',
  target_event_not_bookable: 'The new night is cancelled or not open.',
  event_started: 'The new night has already started.',
  customer_conflict: 'This guest already has a booking on the new night.',
  insufficient_capacity: 'The new night does not have enough places left.',
  insufficient_seated_capacity: 'The new night does not have enough seats left.',
  no_table: 'No table is free on the new night for this party.',
  ticket_type_capacity_exceeded: 'One of the ticket types is sold out on the new night.',
  invalid_attendee_answer: 'One of the answers does not fit the question on the new night.',
  target_has_no_tickets: 'The new night has no tickets set up.',
}

/**
 * Moves a booking to another night (BK-028). Each guest goes with their name and phone; this asks
 * the new night's questions for them, filled in where an answer already given reads the same. A
 * required answer may be left to follow, as on any staff booking. The move itself is one database
 * transaction; a cheaper night leaves the difference for a manager to decide (owner decision D7).
 */
export function TransferBookingDialog({ target, onClose, onDone }: TransferBookingDialogProps) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    setPreview(null)
    setLoadError(null)
    setAnswers({})
    if (!target) return
    let cancelled = false
    setLoading(true)
    getEventTransferPreview(target.bookingId, target.targetEventId)
      .then((result) => {
        if (cancelled) return
        if ('error' in result) {
          setLoadError(result.error)
          return
        }
        setPreview(result.data)
        setAnswers(result.data.prefill)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [target])

  const setAnswer = (guestId: string, questionId: string, value: string): void => {
    setAnswers((current) => ({ ...current, [guestId]: { ...(current[guestId] ?? {}), [questionId]: value } }))
  }

  const handleConfirm = async (): Promise<void> => {
    if (!target) return
    const cleaned: Record<string, Record<string, string>> = {}
    for (const [guestId, byQuestion] of Object.entries(answers)) {
      const kept = Object.fromEntries(Object.entries(byQuestion).filter(([, value]) => value.trim() !== ''))
      if (Object.keys(kept).length > 0) cleaned[guestId] = kept
    }
    const result = await transferEventBooking({ bookingId: target.bookingId, targetEventId: target.targetEventId, answers: cleaned })
    if ('error' in result) throw new Error(result.error)
    if (result.data.state === 'blocked') {
      throw new Error(REASON_TEXT[result.data.reason ?? ''] ?? `The booking could not be moved (${result.data.reason ?? 'unknown reason'}).`)
    }
    const overpayment = Number(result.data.overpayment ?? 0)
    const toFollow = Number(result.data.answers_to_follow ?? 0)
    toast.success(
      [
        `Booking moved to ${target.targetLabel}.`,
        overpayment > 0
          ? `The new night costs £${overpayment.toFixed(2)} less: that refund is waiting for a manager to decide.`
          : null,
        toFollow > 0 ? `${toFollow} required ${toFollow === 1 ? 'answer is' : 'answers are'} still to follow.` : null,
      ].filter(Boolean).join(' '),
      { duration: overpayment > 0 ? 10000 : 5000 },
    )
    await onDone()
  }

  const questions = preview?.questions ?? []
  const guests = preview?.guests ?? []

  return (
    <ConfirmDialog
      open={target !== null}
      onClose={onClose}
      onConfirm={handleConfirm}
      title="Move booking to another night"
      tone="primary"
      confirmLabel="Move booking"
      loading={loading}
      message={
        loading ? (
          <PageLoading inline label="Loading the new night" className="py-4" />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-text">
              Moving to {target?.targetLabel}. The guest keeps what they paid and is not asked to pay again. A dearer
              night is refused; on a cheaper one the difference waits for a manager.
            </p>
            {loadError && <Alert tone="warning" size="sm">{loadError}</Alert>}
            {guests.length > 0 && questions.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm text-text-muted">The new night asks these questions. A required answer can follow later.</p>
                {guests.map((guest, index) => (
                  <fieldset key={guest.id} className="space-y-2 rounded-lg border border-border p-3">
                    <legend className="px-1 text-sm font-medium text-text">{guest.name || `Guest ${index + 1}`}</legend>
                    {questions.map((question) => {
                      const value = answers[guest.id]?.[question.id] ?? ''
                      const label = `${question.label}${question.required ? ' (required)' : ''}`
                      if (question.type === 'yes_no' || question.type === 'choice') {
                        const options = question.type === 'yes_no' ? ['yes', 'no'] : question.options
                        return (
                          <Select
                            key={question.id}
                            label={label}
                            value={value}
                            onChange={(e) => setAnswer(guest.id, question.id, e.target.value)}
                            options={[{ value: '', label: 'To follow' }, ...options.map((option) => ({ value: option, label: option === 'yes' ? 'Yes' : option === 'no' ? 'No' : option }))]}
                          />
                        )
                      }
                      return (
                        <Input
                          key={question.id}
                          label={label}
                          value={value}
                          maxLength={2000}
                          onChange={(e) => setAnswer(guest.id, question.id, e.target.value)}
                        />
                      )
                    })}
                  </fieldset>
                ))}
              </div>
            )}
          </div>
        )
      }
    />
  )
}
