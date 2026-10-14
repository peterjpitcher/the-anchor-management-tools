'use client'

import { useEffect, useState, useTransition } from 'react'
import { Alert, Button, Input, Modal, Radio, Textarea, toast } from '@/ds'
import { recordContractAcceptedAnotherWay } from '@/app/actions/signing-bookings'
import { getTodayIsoDate, isValidIsoDate } from '@/lib/dateUtils'
import {
  STAFF_RECORDED_ACCEPTANCE_CHOICE_NAMES,
  STAFF_RECORDED_ACCEPTANCE_METHODS,
  type StaffRecordedAcceptanceMethod,
} from '@/lib/signing/contract-acceptance'

export interface RecordContractAcceptanceModalProps {
  bookingId: string
  open: boolean
  onClose: () => void
  /** Called once the acceptance is on the booking, so the panel can reload. */
  onRecorded: () => void | Promise<void>
}

const NOTE_MIN = 10
const NOTE_MAX = 500

const METHOD_HELP: Record<StaffRecordedAcceptanceMethod, string> = {
  signed_paper: 'The customer signed a printed copy of the contract.',
  written_confirmation: 'The customer confirmed the booking in an email, a letter or a message.',
}

interface FieldErrors {
  method?: string
  acceptedOn?: string
  note?: string
}

/**
 * Staff record that the customer accepted the booking contract without signing online: on a
 * paper copy, or by confirming in writing. The note says where that evidence is kept.
 */
export function RecordContractAcceptanceModal({
  bookingId,
  open,
  onClose,
  onRecorded,
}: RecordContractAcceptanceModalProps): React.JSX.Element {
  const [method, setMethod] = useState<StaffRecordedAcceptanceMethod | null>(null)
  const [acceptedOn, setAcceptedOn] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // A fresh form each time it opens, dated today in London.
  useEffect(() => {
    if (!open) return
    setMethod(null)
    setAcceptedOn(getTodayIsoDate())
    setNote('')
    setErrors({})
    setActionError(null)
  }, [open])

  const validate = (): FieldErrors => {
    const found: FieldErrors = {}
    if (!method) found.method = 'Choose how the contract was accepted.'
    if (!isValidIsoDate(acceptedOn)) found.acceptedOn = 'Enter the date the contract was accepted.'
    else if (acceptedOn > getTodayIsoDate()) found.acceptedOn = 'The date cannot be in the future.'
    const trimmed = note.trim()
    if (trimmed.length < NOTE_MIN) found.note = `Say where the evidence is kept, in at least ${NOTE_MIN} characters.`
    else if (trimmed.length > NOTE_MAX) found.note = `Keep the note to ${NOTE_MAX} characters or fewer.`
    return found
  }

  const submit = (): void => {
    const found = validate()
    setErrors(found)
    setActionError(null)
    if (!method || Object.keys(found).length > 0) return

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof recordContractAcceptedAnotherWay>>
      try {
        result = await recordContractAcceptedAnotherWay({ bookingId, method, acceptedOn, note: note.trim() })
      } catch {
        result = { error: 'The acceptance could not be recorded. Check your connection and try again.' }
      }
      if (result.error || !result.success) {
        const message = result.error ?? 'The acceptance could not be recorded.'
        setActionError(message)
        toast.error(message)
        return
      }
      toast.success('Contract acceptance recorded.')
      if (result.data?.warning) toast.error(result.data.warning)
      onClose()
      await onRecorded()
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Record Acceptance Another Way"
      description="For a contract the customer signed on paper or confirmed in writing. This goes on the booking's record with your name."
      footer={
        <>
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={pending} onClick={submit}>
            Record Acceptance
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {actionError ? <Alert tone="danger" title="The acceptance was not recorded">{actionError}</Alert> : null}

        <fieldset className="space-y-2">
          <legend className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-muted">
            How the contract was accepted
          </legend>
          {STAFF_RECORDED_ACCEPTANCE_METHODS.map((option) => (
            <Radio
              key={option}
              name="contract-acceptance-method"
              value={option}
              label={STAFF_RECORDED_ACCEPTANCE_CHOICE_NAMES[option]}
              description={METHOD_HELP[option]}
              checked={method === option}
              disabled={pending}
              onChange={() => setMethod(option)}
            />
          ))}
          {errors.method ? (
            <p className="text-xs text-danger-fg" role="alert">
              {errors.method}
            </p>
          ) : null}
        </fieldset>

        <Input
          type="date"
          label="Date accepted"
          hint="The day the customer signed or confirmed. It cannot be in the future."
          max={getTodayIsoDate()}
          value={acceptedOn}
          disabled={pending}
          error={errors.acceptedOn}
          onChange={(event) => setAcceptedOn(event.target.value)}
        />

        <Textarea
          label="Where the evidence is kept"
          hint="For example: signed copy in the bookings folder in the office, or email from the customer on 9 October in the manager inbox."
          rows={3}
          maxLength={NOTE_MAX}
          value={note}
          disabled={pending}
          error={errors.note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Modal>
  )
}
