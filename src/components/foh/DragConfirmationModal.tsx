'use client'

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
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drag-confirm-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-sm rounded-lg bg-[hsl(var(--card))] p-6 shadow-xl">
        <h2
          id="drag-confirm-title"
          className="mb-3 text-lg font-semibold text-[hsl(var(--foreground))]"
        >
          {title}
        </h2>

        <p className="mb-5 text-sm text-[hsl(var(--muted-foreground))]">{message}</p>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="rounded bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Moving…' : 'Confirm'}
          </button>
        </div>

        {error && (
          <p
            className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
