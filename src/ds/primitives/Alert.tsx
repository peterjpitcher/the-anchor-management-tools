import { cn } from '@/lib/utils'

type AlertTone = 'success' | 'warning' | 'danger' | 'info'

interface AlertProps {
  tone: AlertTone
  title?: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}

const toneStyles: Record<AlertTone, string> = {
  success: 'border-l-success bg-success-soft text-success-fg',
  warning: 'border-l-warning bg-warning-soft text-warning-fg',
  danger: 'border-l-danger bg-danger-soft text-danger-fg',
  info: 'border-l-info bg-info-soft text-info-fg',
}

export function Alert({ tone, title, icon, children, className }: AlertProps) {
  return (
    <div
      className={cn(
        'flex gap-3 border-l-4 rounded-default p-4',
        toneStyles[tone],
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
        <div className={cn('text-sm', title && 'mt-1')}>{children}</div>
      </div>
    </div>
  )
}
