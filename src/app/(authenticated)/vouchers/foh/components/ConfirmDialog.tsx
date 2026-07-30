'use client'

import React, { useEffect, useRef } from 'react'

type ConfirmDialogProps = {
  open: boolean
  title: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: React.ReactNode
}

// Accessible confirm dialog for FOH actions (F46): labelled, focus moved to the
// confirm button, Escape cancels, big touch targets.
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  children
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, busy, onCancel])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={busy ? undefined : onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="foh-voucher-confirm-title"
        className="relative w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 id="foh-voucher-confirm-title" className="text-xl font-bold text-gray-900">
          {title}
        </h2>
        <div className="mt-3 text-base text-gray-700">{children}</div>
        <div className="mt-5 flex flex-col gap-2">
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="min-h-[56px] w-full rounded-lg bg-sidebar px-4 py-3 text-lg font-semibold text-white hover:bg-sidebar/90 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
