'use client'

import { Field, Select, Textarea } from '@/ds/primitives'
import {
  PRIVATE_BOOKING_CANCELLATION_NOTE_MAX_LENGTH,
  PRIVATE_BOOKING_CANCELLATION_REASONS,
  type PrivateBookingCancellationReasonCode,
} from '@/lib/private-bookings/cancellation-reasons'

export interface CancellationReasonFieldsProps {
  code: PrivateBookingCancellationReasonCode | ''
  note: string
  onCodeChange: (code: PrivateBookingCancellationReasonCode | '') => void
  onNoteChange: (note: string) => void
  disabled?: boolean
}

/**
 * Why a private booking is being cancelled: the fixed list plus a note, shown in both cancel
 * dialogs (the booking page and the list). The server action checks the same list, so this only
 * saves staff a round trip.
 */
export function CancellationReasonFields({
  code,
  note,
  onCodeChange,
  onNoteChange,
  disabled,
}: CancellationReasonFieldsProps) {
  const noteRequired = PRIVATE_BOOKING_CANCELLATION_REASONS.find((reason) => reason.code === code)?.needsNote === true

  return (
    <div className="space-y-4">
      <Field label="Why is it being cancelled?" required>
        <Select
          value={code}
          onChange={(e) => onCodeChange(e.target.value as PrivateBookingCancellationReasonCode | '')}
          disabled={disabled}
          options={[
            { value: '', label: 'Choose a reason' },
            ...PRIVATE_BOOKING_CANCELLATION_REASONS.map((reason) => ({ value: reason.code, label: reason.label })),
          ]}
        />
      </Field>
      <Field
        label={noteRequired ? 'Note' : 'Note (optional)'}
        required={noteRequired}
        hint="For staff only. The customer does not see this."
      >
        <Textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          rows={2}
          maxLength={PRIVATE_BOOKING_CANCELLATION_NOTE_MAX_LENGTH}
          disabled={disabled}
        />
      </Field>
    </div>
  )
}
