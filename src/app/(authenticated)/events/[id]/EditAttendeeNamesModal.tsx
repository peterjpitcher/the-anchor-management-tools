'use client'

import { useEffect, useState } from 'react'
import { Button, Input, Modal, toast } from '@/ds'
import type { EventBookingRow } from '@/app/actions/events'
import { updateEventBookingAttendeeNames } from '@/app/actions/events'
import { MAX_ATTENDEE_NAME_LENGTH } from '@/lib/events/attendee-names'
import { MAX_MANUAL_BOOKING_SEATS } from './manual-booking-helpers'

interface EditAttendeeNamesModalProps {
  booking: EventBookingRow | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}

/**
 * Staff edit of a booking's per-ticket names. One input per seat (index 0 is
 * the lead booker); blanks are allowed and dropped on save, so the stored list
 * can never exceed the booking's seats.
 */
export function EditAttendeeNamesModal({ booking, onClose, onSaved }: EditAttendeeNamesModalProps) {
  const seatCount = Math.min(
    MAX_MANUAL_BOOKING_SEATS,
    Math.max(1, Number(booking?.seats ?? 1) || 1),
  )
  const [names, setNames] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!booking) {
      setNames([])
      setError(null)
      setSaving(false)
      return
    }
    const existing = Array.isArray(booking.attendee_names) ? booking.attendee_names : []
    const seats = Math.min(MAX_MANUAL_BOOKING_SEATS, Math.max(1, Number(booking.seats ?? 1) || 1))
    setNames(Array.from({ length: seats }, (_, index) => existing[index] ?? ''))
    setError(null)
  }, [booking])

  const handleSave = async (): Promise<void> => {
    if (!booking || saving) return
    const trimmed = names.map((name) => name.trim())
    if (trimmed.some((name) => name.length > MAX_ATTENDEE_NAME_LENGTH)) {
      setError(`Each name must be ${MAX_ATTENDEE_NAME_LENGTH} characters or fewer.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await updateEventBookingAttendeeNames({
        bookingId: booking.id,
        attendeeNames: trimmed,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      toast.success('Attendee names updated')
      await onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={booking !== null}
      onClose={() => {
        if (!saving) onClose()
      }}
      title="Edit Ticket Names"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save Names
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          One name per ticket — blanks are fine and will simply be left unnamed.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: seatCount }).map((_, index) => (
            <Input
              key={index}
              value={names[index] ?? ''}
              onChange={(e) => {
                const value = e.target.value
                setNames((prev) => {
                  const next = [...prev]
                  next[index] = value
                  return next
                })
                setError(null)
              }}
              placeholder={index === 0 ? 'Ticket 1 (lead booker)' : `Ticket ${index + 1}`}
              aria-label={`Ticket ${index + 1} name`}
              maxLength={MAX_ATTENDEE_NAME_LENGTH}
            />
          ))}
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
