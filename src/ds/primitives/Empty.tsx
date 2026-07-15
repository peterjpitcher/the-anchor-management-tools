import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Icon, type IconName } from '../icons'

type EmptyIcon = 'inbox' | 'search' | 'document' | 'folder' | 'users' | 'calendar' | 'photo' | 'chart'

export interface EmptyProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode | EmptyIcon
  title: string
  description?: string
  action?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'dashed' | 'minimal'
  centered?: boolean
}

const legacyIconNames: Record<EmptyIcon, IconName> = {
  inbox: 'file',
  search: 'search',
  document: 'file',
  folder: 'file',
  users: 'users',
  calendar: 'calendar',
  photo: 'file',
  chart: 'trendUp',
}

const sizeClasses = {
  sm: { wrapper: 'px-4 py-8', icon: '[&>svg]:h-10 [&>svg]:w-10', title: 'text-base' },
  md: { wrapper: 'px-6 py-12', icon: '[&>svg]:h-12 [&>svg]:w-12', title: 'text-lg' },
  lg: { wrapper: 'px-8 py-16', icon: '[&>svg]:h-16 [&>svg]:w-16', title: 'text-xl' },
}

export const Empty = forwardRef<HTMLDivElement, EmptyProps>(function Empty({
  icon,
  title,
  description,
  action,
  size = 'md',
  variant = 'default',
  centered = true,
  className,
  children,
  ...rest
}, ref) {
  const resolvedIcon = typeof icon === 'string' && icon in legacyIconNames
    ? <Icon name={legacyIconNames[icon as EmptyIcon]} size={48} />
    : icon
  const styles = sizeClasses[size]

  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col justify-center',
        centered && 'items-center text-center',
        !centered && 'items-start text-left',
        styles.wrapper,
        variant === 'dashed' && 'rounded-lg border-2 border-dashed border-border-strong',
        className
      )}
      {...rest}
    >
      {resolvedIcon && (
        <div className={cn('mb-4 text-text-subtle', styles.icon)} aria-hidden="true">
          {resolvedIcon}
        </div>
      )}
      <h3 className={cn('font-semibold text-text', styles.title)}>{title}</h3>
      {description && (
        <p className={cn('mt-1 max-w-sm text-sm text-text-muted', centered && 'mx-auto')}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
      {children}
    </div>
  )
})
