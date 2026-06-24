'use client'

import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => unknown | Promise<unknown>
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
  description,
  destructive: _destructive,
  closeOnConfirm = true,
  loading: externalLoading,
  variant: _variant,
  loadingText,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolvedConfirmLabel = confirmLabel ?? confirmText ?? 'Confirm'
  const resolvedCancelLabel = cancelLabel ?? cancelText ?? 'Cancel'
  const resolvedTone: 'danger' | 'warning' | 'info' = tone ?? (type === 'warning' || confirmVariant === 'warning' ? 'warning' : type === 'info' ? 'info' : 'danger')
  const isLoading = pending || Boolean(externalLoading)
  const handleClose = () => {
    if (!isLoading) {
      setError(null)
      onClose()
    }
  }
  const handleConfirm = async () => {
    setError(null)
    setPending(true)
    try {
      await onConfirm()
      if (closeOnConfirm) {
        onClose()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isLoading}>
            {resolvedCancelLabel}
          </Button>
          <Button
            variant={resolvedTone === 'danger' ? 'danger' : 'primary'}
            loading={isLoading}
            onClick={handleConfirm}
          >
            {isLoading && loadingText ? loadingText : resolvedConfirmLabel}
          </Button>
        </>
      }
    >
      {(message || description) && (
        <p className="text-sm text-text-muted">{message ?? description}</p>
      )}
      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
