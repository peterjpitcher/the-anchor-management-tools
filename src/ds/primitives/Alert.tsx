'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '../icons'
import { IconButton } from './IconButton'

type AlertTone = 'success' | 'warning' | 'danger' | 'info'

interface AlertProps {
  tone?: AlertTone
  /** @deprecated Use `tone` instead */
  variant?: string
  title?: string
  /** @deprecated Use children instead */
  description?: string
  /** @deprecated Accepted for backward compatibility */
  actions?: React.ReactNode
  icon?: React.ReactNode
  children?: React.ReactNode
  className?: string
  /** `status` for news that is not urgent, such as a verified banner, so it is not announced as an alert. */
  role?: 'alert' | 'status'
  /** Shows a Dismiss button at the top right. */
  closable?: boolean
  /** Called by the Dismiss button. Without it the alert hides itself. */
  onClose?: () => void
  /** `sm` is a compact banner (13px text, tighter padding). Any other value keeps the default size. */
  size?: string
}

const toneStyles: Record<AlertTone, string> = {
  success: 'border-l-success bg-success-soft text-success-fg',
  warning: 'border-l-warning bg-warning-soft text-warning-fg',
  danger: 'border-l-danger bg-danger-soft text-danger-fg',
  info: 'border-l-info bg-info-soft text-info-fg',
}

const variantToTone: Record<string, AlertTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  error: 'danger',
  info: 'info',
}

export function Alert({ tone, variant, title, description, actions, icon, children, className, closable = false, onClose, size, role = 'alert' }: AlertProps) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const resolvedTone: AlertTone = tone ?? variantToTone[variant ?? ''] ?? 'info'
  const content = children ?? description
  const small = size === 'sm'
  const textSize = small ? 'text-ui' : 'text-sm'

  const handleClose = () => {
    if (onClose) {
      onClose()
    } else {
      setDismissed(true)
    }
  }

  return (
    <div
      className={cn(
        'flex gap-3 border-l-4 rounded-default',
        small ? 'px-3 py-2' : 'p-4',
        toneStyles[resolvedTone],
        className
      )}
      role={role}
    >
      {icon && (
        <span className="shrink-0 w-6 h-6 flex items-center justify-center" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        {title && <p className={cn('font-bold', textSize)}>{title}</p>}
        {content && <div className={cn(textSize, title && 'mt-1')}>{content}</div>}
        {actions && <div className="mt-2">{actions}</div>}
      </div>
      {closable && (
        // type="button" so dismissing an alert inside a form never submits it.
        // text-current draws the cross in the alert's own tone colour.
        <IconButton
          type="button"
          size="sm"
          label="Dismiss"
          icon={<Icon name="x" size={14} />}
          onClick={handleClose}
          className="-my-1 -mr-1 shrink-0 self-start text-current"
        />
      )}
    </div>
  )
}
