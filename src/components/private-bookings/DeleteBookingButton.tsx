'use client'

import { useCallback, useEffect, useState } from 'react'

import { Alert, Button, Field, IconButton, Icon, Input, Modal } from '@/ds'
import { getBookingDeleteEligibility } from '@/app/actions/privateBookingActions'
import { formatDateFull } from '@/lib/dateUtils'

interface DeleteBookingButtonProps {
  bookingId: string
  bookingName: string
  /**
   * The delete action. Receives a FormData containing a hidden `bookingId` field
   * for backwards compatibility with existing callers.
   */
  deleteAction: (formData: FormData) => Promise<void>
  /** ISO date string (`YYYY-MM-DD`), required for the typed-date friction check. */
  eventDate?: string
  status?: string
}

type Eligibility = {
  canDelete: boolean
  reason?: string
  sentCount: number
  scheduledCount: number
}

export default function DeleteBookingButton({
  bookingId,
  bookingName,
  deleteAction,
  eventDate,
  status
}: DeleteBookingButtonProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [eligibility, setEligibility] = useState<Eligibility | null>(null)
  const [loadingEligibility, setLoadingEligibility] = useState(false)
  const [typedDate, setTypedDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expectedDate = eventDate ? eventDate.slice(0, 10) : ''
  const hasEventDate = expectedDate.length === 10
  // When event_date is missing (TBD bookings), fall back to the booking id as a
  // typed-confirmation token so the friction still exists.
  const confirmValue = hasEventDate ? expectedDate : bookingId
  const confirmLabel = hasEventDate ? expectedDate : bookingId
  const humanReadableDate = hasEventDate ? formatDateFull(expectedDate) : null

  const refreshEligibility = useCallback(async () => {
    setLoadingEligibility(true)
    setError(null)
    try {
      const result = await getBookingDeleteEligibility(bookingId)
      setEligibility(result)
    } catch (err) {
      setEligibility({
        canDelete: false,
        sentCount: 0,
        scheduledCount: 0,
        reason: err instanceof Error ? err.message : 'Failed to check delete eligibility'
      })
    } finally {
      setLoadingEligibility(false)
    }
  }, [bookingId])

  useEffect(() => {
    // Fire-and-forget: on mount, preflight the eligibility so the button
    // reflects reality before the user clicks.
    void refreshEligibility()
  }, [refreshEligibility])

  const handleOpen = async () => {
    // Re-check at click time in case the queue changed since mount.
    await refreshEligibility()
    setTypedDate('')
    setError(null)
    setModalOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!eligibility?.canDelete) return
    if (typedDate !== confirmValue) return

    setSubmitting(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.set('bookingId', bookingId)
      await deleteAction(formData)
      setModalOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete booking')
    } finally {
      setSubmitting(false)
    }
  }

  const buttonTitle = !eligibility
    ? loadingEligibility
      ? 'Checking SMS history…'
      : `Delete ${status || 'draft'} booking`
    : eligibility.canDelete
      ? `Delete ${status || 'draft'} booking`
      : eligibility.reason ?? 'This booking cannot be deleted'

  const disabled = loadingEligibility || eligibility?.canDelete === false

  const confirmDisabled =
    submitting || typedDate !== confirmValue || eligibility?.canDelete !== true

  return (
    <>
      {/* One delete colour for every status: the label already says which booking it is. */}
      <IconButton
        type="button"
        className="text-danger hover:bg-danger-soft hover:text-danger-fg"
        title={buttonTitle}
        label={buttonTitle}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          void handleOpen()
        }}
        icon={<Icon name="trash" size={20} />}
      />

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!submitting) setModalOpen(false)
        }}
        title="Delete Booking"
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                void handleConfirmDelete()
              }}
              disabled={confirmDisabled}
              loading={submitting}
            >
              Delete
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-text">
          <p>
            You are about to permanently delete the booking for{' '}
            <strong>{bookingName}</strong>. This cannot be undone.
          </p>
          {status === 'cancelled' ? (
            <p className="text-warning-fg">
              This booking is cancelled. Deleting will permanently remove it and
              all associated items, messages, and documents.
            </p>
          ) : null}
          {eligibility && !eligibility.canDelete ? (
            <Alert tone="danger" size="sm">
              {eligibility.reason ?? 'This booking has SMS activity and cannot be deleted.'}
            </Alert>
          ) : null}
          <Field
            label={hasEventDate ? 'To confirm, type the event date' : 'To confirm, type the booking id'}
            hint={humanReadableDate ? `${confirmLabel} (${humanReadableDate})` : confirmLabel}
          >
            <Input
              id="delete-booking-confirm-input"
              type="text"
              autoComplete="off"
              inputMode={hasEventDate ? 'numeric' : 'text'}
              placeholder={hasEventDate ? 'YYYY-MM-DD' : 'Booking id'}
              value={typedDate}
              onChange={(e) => setTypedDate(e.target.value.trim())}
              disabled={submitting || eligibility?.canDelete !== true}
            />
          </Field>
          {error ? (
            <Alert tone="danger" size="sm">{error}</Alert>
          ) : null}
        </div>
      </Modal>
    </>
  )
}
