'use client'

/**
 * ConfirmModal / AlertModal — backward-compatible wrappers
 * @deprecated Use ds/ConfirmDialog instead
 */

import { ConfirmDialog } from '../primitives/ConfirmDialog'

export interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message?: string
  description?: string
  confirmLabel?: string
  confirmText?: string
  cancelLabel?: string
  cancelText?: string
  tone?: 'danger' | 'warning'
  type?: string
  confirmVariant?: string
  variant?: string
  loading?: boolean
  destructive?: boolean
  closeOnConfirm?: boolean
}

export function ConfirmModal(props: ConfirmModalProps) {
  return (
    <ConfirmDialog
      open={props.open}
      onClose={props.onClose}
      onConfirm={props.onConfirm}
      title={props.title}
      message={props.message ?? props.description ?? ''}
      confirmLabel={props.confirmLabel}
      confirmText={props.confirmText}
      cancelLabel={props.cancelLabel}
      cancelText={props.cancelText}
      tone={props.tone}
      type={props.type ?? props.variant}
      confirmVariant={props.confirmVariant}
    />
  )
}

function AlertModal(props: Omit<ConfirmModalProps, 'onConfirm'> & { onConfirm?: () => void }) {
  return (
    <ConfirmModal
      {...props}
      onConfirm={props.onConfirm ?? props.onClose}
    />
  )
}
