'use client'

import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

/**
 * The confirm button's colour. `danger` (red) is for destructive or irreversible actions:
 * delete, cancel, void, revoke, discard. `primary` (orange) is for everything else.
 */
export type ConfirmDialogTone = 'primary' | 'danger'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => unknown | Promise<unknown>
  title: string
  /**
   * The question or consequence. A string renders as a paragraph; any other node renders in a
   * `<div>`, so it may hold its own paragraphs or lists.
   */
  message?: React.ReactNode
  confirmLabel?: string
  /** @deprecated Use `confirmLabel` instead */
  confirmText?: string
  cancelLabel?: string
  /** @deprecated Use `cancelLabel` instead */
  cancelText?: string
  /**
   * The confirm button's colour (see `ConfirmDialogTone`). When omitted it is read from the
   * deprecated props, in this order: `confirmVariant` (`danger`, or `primary`/`warning`),
   * `destructive`, `type` (`warning` and `info` are primary), and otherwise `danger`, the
   * colour every unmarked confirm has always had.
   *
   * `warning` is a deprecated alias for `primary`: it never drew an amber button.
   */
  tone?: ConfirmDialogTone | 'warning'
  /** @deprecated Use `tone` instead */
  type?: string
  /** @deprecated Use `tone` instead */
  confirmVariant?: string
  /** @deprecated Accepted for backward compatibility */
  description?: string
  /** @deprecated Use `tone="danger"` instead */
  destructive?: boolean
  /** @deprecated Accepted for backward compatibility */
  closeOnConfirm?: boolean
  /** @deprecated Accepted for backward compatibility */
  loading?: boolean
  /**
   * @deprecated Ignored: it never changed the button. Use `tone` instead. (The FOH clock-out
   * confirm still passes `variant="primary"` and keeps its red button until the kiosk is revisited.)
   */
  variant?: string
  /** @deprecated Accepted for backward compatibility */
  loadingText?: string
}

/** The confirm button's colour for a set of props, new or deprecated (see `ConfirmDialogProps.tone`). */
export function resolveConfirmDialogTone({
  tone,
  confirmVariant,
  destructive,
  type,
}: Pick<ConfirmDialogProps, 'tone' | 'confirmVariant' | 'destructive' | 'type'>): ConfirmDialogTone {
  if (tone) return tone === 'danger' ? 'danger' : 'primary'
  if (confirmVariant === 'danger') return 'danger'
  if (confirmVariant === 'primary' || confirmVariant === 'warning') return 'primary'
  if (destructive !== undefined) return destructive ? 'danger' : 'primary'
  if (type === 'warning' || type === 'info') return 'primary'
  return 'danger'
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
  destructive,
  closeOnConfirm = true,
  loading: externalLoading,
  variant: _variant,
  loadingText,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolvedConfirmLabel = confirmLabel ?? confirmText ?? 'Confirm'
  const resolvedCancelLabel = cancelLabel ?? cancelText ?? 'Cancel'
  const resolvedTone = resolveConfirmDialogTone({ tone, confirmVariant, destructive, type })
  const body = message ?? description
  const hasBody = body !== undefined && body !== null && body !== false && body !== ''
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
            variant={resolvedTone}
            loading={isLoading}
            onClick={handleConfirm}
          >
            {isLoading && loadingText ? loadingText : resolvedConfirmLabel}
          </Button>
        </>
      }
    >
      {hasBody &&
        (typeof body === 'string' || typeof body === 'number' ? (
          <p className="text-sm text-text-muted">{body}</p>
        ) : (
          // A node may hold its own paragraphs or lists, which a <p> cannot contain.
          <div className="text-sm text-text-muted">{body}</div>
        ))}
      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
