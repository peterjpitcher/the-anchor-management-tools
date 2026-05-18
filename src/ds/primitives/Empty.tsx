import { cn } from '@/lib/utils'

interface EmptyProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function Empty({ icon, title, description, action, className }: EmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center',
        className
      )}
    >
      {icon && (
        <div className="text-text-subtle mb-4 [&>svg]:w-12 [&>svg]:h-12" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-text font-semibold text-lg">{title}</h3>
      {description && (
        <p className="text-text-muted text-sm mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
