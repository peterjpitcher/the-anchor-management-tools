'use client'

import { Modal } from './Modal'
import { Button } from './Button'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message?: React.ReactNode
  confirmLabel?: string
  /** @deprecated Use `confirmLabel` instead */
  confirmText?: string
  cancelLabel?: string
  /** @deprecated Use `cancelLabel` instead */
  cancelText?: string
  tone?: 'danger' | 'warning'
  /** @deprecated Use `tone` instead */
  type?: string
  /** @deprecated Use `tone` instead */
  confirmVariant?: string
  /** @deprecated Accepted for backward compatibility */
  description?: string
  /** @deprecated Accepted for backward compatibility */
  destructive?: boolean
  /** @deprecated Accepted for backward compatibility */
  closeOnConfirm?: boolean
  /** @deprecated Accepted for backward compatibility */
  loading?: boolean
  /** @deprecated Accepted for backward compatibility */
  variant?: string
  /** @deprecated Accepted for backward compatibility */
  loadingText?: string
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  confirmText,
  cancelLabel,
  cancelText,
  tone,
  type,
  confirmVariant,
  description: _description,
  destructive: _destructive,
  closeOnConfirm: _closeOnConfirm,
  loading: _loading,
  variant: _variant,
  loadingText: _loadingText,
}: ConfirmDialogProps) {
  const resolvedConfirmLabel = confirmLabel ?? confirmText ?? 'Confirm'
  const resolvedCancelLabel = cancelLabel ?? cancelText ?? 'Cancel'
  const resolvedTone: 'danger' | 'warning' | 'info' = tone ?? (type === 'warning' || confirmVariant === 'warning' ? 'warning' : type === 'info' ? 'info' : 'danger')
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {resolvedCancelLabel}
          </Button>
          <Button
            variant={resolvedTone === 'danger' ? 'danger' : 'primary'}
            loading={_loading}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {resolvedConfirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="text-sm text-text-muted">{message}</p>}
    </Modal>
  )
}
