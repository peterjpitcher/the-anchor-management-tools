import { cn } from '@/lib/utils'

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
  /** @deprecated Accepted for backward compatibility */
  closable?: boolean
  /** @deprecated Accepted for backward compatibility */
  onClose?: () => void
  /** @deprecated Accepted for backward compatibility */
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

export function Alert({ tone, variant, title, description, actions, icon, children, className, closable: _closable, onClose: _onClose, size: _size }: AlertProps) {
  const resolvedTone: AlertTone = tone ?? variantToTone[variant ?? ''] ?? 'info'
  const content = children ?? description
  return (
    <div
      className={cn(
        'flex gap-3 border-l-4 rounded-default p-4',
        toneStyles[resolvedTone],
        className
      )}
      role="alert"
    >
      {icon && (
        <span className="shrink-0 w-6 h-6 flex items-center justify-center" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        {title && <p className="font-bold text-sm">{title}</p>}
        {content && <div className={cn('text-sm', title && 'mt-1')}>{content}</div>}
        {actions && <div className="mt-2">{actions}</div>}
      </div>
    </div>
  )
}
