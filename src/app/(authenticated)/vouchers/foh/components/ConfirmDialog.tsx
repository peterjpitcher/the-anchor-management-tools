'use client'

import React from 'react'
import { Button, Modal } from '@/ds'

type ConfirmDialogProps = {
  open: boolean
  title: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: React.ReactNode
}

// Accessible confirm dialog for FOH actions (F46), built on DS Modal: labelled, focus trapped,
// Escape and a tap on the backdrop cancel. data-autofocus moves focus to the confirm button
// when it opens, as the kiosk expects. While busy, Escape and the backdrop do nothing and both
// buttons are disabled. The buttons keep the kiosk's big touch targets.
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  children
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          onCancel()
        }
      }}
      title={title}
      footer={
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            variant="primary"
            size="lg"
            data-autofocus
            onClick={onConfirm}
            disabled={busy}
            className="h-14 w-full text-lg"
          >
            {busy ? 'Working...' : confirmLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onCancel}
            disabled={busy}
            className="min-h-touch w-full text-base"
          >
            Cancel
          </Button>
        </div>
      }
    >
      <div className="text-base text-text">{children}</div>
    </Modal>
  )
}
