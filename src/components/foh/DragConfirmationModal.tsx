'use client'

import { useEffect } from 'react'
import { Button } from '@/ds'
import type { PendingMove } from '@/app/(authenticated)/table-bookings/foh/useFohDrag'

interface DragConfirmationModalProps {
  pendingMove: PendingMove | null
  onConfirm: () => Promise<void>
  onCancel: () => void
  isSubmitting: boolean
  error: string | null
}

export function DragConfirmationModal({
  pendingMove,
  onConfirm,
  onCancel,
  isSubmitting,
  error,
}: DragConfirmationModalProps) {
  useEffect(() => {
    if (!pendingMove) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pendingMove, onCancel])

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drag-confirm-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-overlay"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-sm rounded-lg bg-surface p-6 shadow-lg">
        <h2
          id="drag-confirm-title"
          className="mb-3 text-lg font-semibold text-text-strong"
        >
          {title}
        </h2>

        <p className="mb-5 text-sm text-text-muted">{message}</p>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="lg" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? 'Moving…' : 'Confirm'}
          </Button>
        </div>

        {error && (
          <p
            className="mt-4 rounded-sm border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger-fg"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
