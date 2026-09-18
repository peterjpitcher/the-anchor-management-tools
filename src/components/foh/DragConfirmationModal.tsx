'use client'

import { Alert, Button, Modal } from '@/ds'
import type { PendingMove } from '@/app/(authenticated)/table-bookings/foh/useFohDrag'

interface DragConfirmationModalProps {
  pendingMove: PendingMove | null
  onConfirm: () => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
  error: string | null
}

/**
 * Confirms a drag on the FOH timeline. Built on DS Modal like every other FOH dialog: Escape and a
 * click on the backdrop both cancel, as they did when this was a hand-built overlay, and the
 * dialog now also keeps keyboard focus inside itself while it is open.
 */
export function DragConfirmationModal({
  pendingMove,
  onConfirm,
  onCancel,
  isSubmitting,
  error,
}: DragConfirmationModalProps) {
  if (!pendingMove) return null

  const title = pendingMove.type === 'time' ? 'Change Booking Time' : 'Move to Different Table'

  const message =
    pendingMove.type === 'time' ? (
      <>
        Move <strong>{pendingMove.bookingLabel}</strong> from {pendingMove.fromTime} to{' '}
        {pendingMove.toTime}?
      </>
    ) : (
      <>
        Move <strong>{pendingMove.bookingLabel}</strong> to{' '}
        <strong>{pendingMove.toTableName}</strong>? (Availability is checked when you confirm.)
      </>
    )

  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      width="sm"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onCancel}
            disabled={isSubmitting}
            className="min-h-touch"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="min-h-touch"
          >
            {isSubmitting ? 'Moving…' : 'Confirm'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">{message}</p>

      {error && (
        <Alert tone="danger" size="sm" className="mt-4">
          {error}
        </Alert>
      )}
    </Modal>
  )
}
