/**
 * StatusIndicator Component
 * 
 * Visual indicators for system status, connection state, and health.
 * Supports dots, badges, labels, and animated states.
 */

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { 
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ArrowPathIcon,
  SignalIcon,
  SignalSlashIcon
} from '@heroicons/react/20/solid'

export interface StatusIndicatorProps {
  /**
   * Status type
   */
  status: 'online' | 'offline' | 'away' | 'busy' | 'error' | 'warning' | 'success' | 'loading' | 'custom'
  
  /**
   * Display variant
   * @default 'dot'
   */
  variant?: 'dot' | 'badge' | 'icon' | 'label' | 'mixed'
  
  /**
   * Size variant
   * @default 'md'
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  
  /**
   * Status label
   */
  label?: string
  
  /**
   * Whether to show animation
   * @default true for online/loading
   */
  animated?: boolean
  
  /**
   * Custom color (for custom status)
   */
  color?: string
  
  /**
   * Custom icon
   */
  icon?: ReactNode
  
  /**
   * Position when used as overlay
   * @default 'bottom-right'
   */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  
  /**
   * Whether to show as overlay (absolute positioned)
   * @default false
   */
  overlay?: boolean
  
  /**
   * Additional description
   */
  description?: string
  
  /**
   * Additional classes
   */
  className?: string
  
  /**
   * Show pulse animation
   * @default false
   */
  pulse?: boolean
  
  /**
   * Border color (for dot variant)
   * @default 'white'
   */
  borderColor?: string
}

export function StatusIndicator({
  status,
  variant = 'dot',
  size = 'md',
  label,
  animated,
  color,
  icon,
  position = 'bottom-right',
  overlay = false,
  description,
  className,
  pulse = false,
  borderColor = 'white',
}: StatusIndicatorProps) {
  // Status configurations
  const statusConfig = {
    online: {
      color: 'bg-green-500',
      textColor: 'text-green-600',
      icon: <CheckCircleIcon />,
      label: label || 'Online',
      defaultAnimated: true,
    },
    offline: {
      color: 'bg-gray-400',
      textColor: 'text-gray-600',
      icon: <SignalSlashIcon />,
      label: label || 'Offline',
      defaultAnimated: false,
    },
    away: {
      color: 'bg-yellow-500',
      textColor: 'text-yellow-600',
      icon: <ArrowPathIcon />,
      label: label || 'Away',
      defaultAnimated: false,
    },
    busy: {
      color: 'bg-red-500',
      textColor: 'text-red-600',
      icon: <XCircleIcon />,
      label: label || 'Busy',
      defaultAnimated: false,
    },
    error: {
      color: 'bg-red-500',
      textColor: 'text-red-600',
      icon: <XCircleIcon />,
      label: label || 'Error',
      defaultAnimated: false,
    },
    warning: {
      color: 'bg-yellow-500',
      textColor: 'text-yellow-600',
      icon: <ExclamationTriangleIcon />,
      label: label || 'Warning',
      defaultAnimated: false,
    },
    success: {
      color: 'bg-green-500',
      textColor: 'text-green-600',
      icon: <CheckCircleIcon />,
      label: label || 'Success',
      defaultAnimated: false,
    },
    loading: {
      color: 'bg-blue-500',
      textColor: 'text-blue-600',
      icon: <ArrowPathIcon className="animate-spin" />,
      label: label || 'Loading',
      defaultAnimated: true,
    },
    custom: {
      color: color || 'bg-gray-500',
      textColor: 'text-gray-600',
      icon: icon || <SignalIcon />,
      label: label || 'Custom',
      defaultAnimated: false,
    },
  }
  
  const config = statusConfig[status]
  const shouldAnimate = animated ?? config.defaultAnimated
  
  // Size classes
  const sizeClasses = {
    xs: {
      dot: 'h-1.5 w-1.5',
      badge: 'px-1.5 py-0.5 text-xs',
      icon: 'h-3 w-3',
      text: 'text-xs',
      ring: 'ring-1',
    },
    sm: {
      dot: 'h-2 w-2',
      badge: 'px-2 py-0.5 text-xs',
      icon: 'h-4 w-4',
      text: 'text-sm',
      ring: 'ring-2',
    },
    md: {
      dot: 'h-2.5 w-2.5',
      badge: 'px-2.5 py-1 text-sm',
      icon: 'h-5 w-5',
      text: 'text-base',
      ring: 'ring-2',
    },
    lg: {
      dot: 'h-3 w-3',
      badge: 'px-3 py-1.5 text-base',
      icon: 'h-6 w-6',
      text: 'text-lg',
      ring: 'ring-4',
    },
    xl: {
      dot: 'h-4 w-4',
      badge: 'px-4 py-2 text-lg',
      icon: 'h-8 w-8',
      text: 'text-xl',
      ring: 'ring-4',
    },
  }
  
  const currentSize = sizeClasses[size]
  
  // Position classes
  const positionClasses = {
    'top-left': 'top-0 left-0',
    'top-right': 'top-0 right-0',
    'bottom-left': 'bottom-0 left-0',
    'bottom-right': 'bottom-0 right-0',
  }
  
  // Render dot variant
  const renderDot = () => (
    <div
      className={cn(
        'rounded-full',
        currentSize.dot,
        config.color,
        shouldAnimate && status === 'online' && 'animate-pulse',
        pulse && 'animate-ping',
        overlay && cn('absolute z-10', positionClasses[position]),
        overlay && currentSize.ring,
        overlay && `ring-${borderColor}`,
        className
      )}
      aria-label={config.label}
    />
  )
  
  // Render badge variant
  const renderBadge = () => (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        currentSize,
        config.color,
        'text-white',
        className
      )}
    >
      {(icon || config.icon) && (
        <span className={currentSize.icon}>
          {icon || config.icon}
        </span>
      )}
      {config.label}
    </span>
  )
  
  // Render icon variant
  const renderIcon = () => (
    <div
      className={cn(
        'inline-flex items-center justify-center',
        currentSize.icon,
        config.textColor,
        className
      )}
      aria-label={config.label}
    >
      {icon || config.icon}
    </div>
  )
  
  // Render label variant
  const renderLabel = () => (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'rounded-full',
          currentSize.dot,
          config.color,
          shouldAnimate && status === 'online' && 'animate-pulse'
        )}
      />
      <span className={cn(currentSize.text, config.textColor)}>
        {config.label}
      </span>
    </div>
  )
  
  // Render mixed variant
  const renderMixed = () => (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('relative inline-flex items-center justify-center')}>
        <div
          className={cn(
            'rounded-full',
            currentSize.icon,
            config.color,
            'p-1'
          )}
        >
          <span className={cn(currentSize.icon, 'text-white')}>
            {icon || config.icon}
          </span>
        </div>
        {shouldAnimate && (
          <div
            className={cn(
              'absolute inset-0 rounded-full',
              config.color,
              'animate-ping opacity-75'
            )}
          />
        )}
      </div>
      <div>
        <div className={cn(currentSize.text, 'font-medium', config.textColor)}>
          {config.label}
        </div>
        {description && (
          <div className={cn('text-gray-500', currentSize.text === 'text-xs' ? 'text-xs' : 'text-sm')}>
            {description}
          </div>
        )}
      </div>
    </div>
  )
  
  // Render based on variant
  switch (variant) {
    case 'dot':
      return renderDot()
    case 'badge':
      return renderBadge()
    case 'icon':
      return renderIcon()
    case 'label':
      return renderLabel()
    case 'mixed':
      return renderMixed()
    default:
      return renderDot()
  }
}

/**
 * ConnectionStatus - Status indicator for connection state
 */
export function ConnectionStatus({
  connected,
  latency,
  strength,
  ...props
}: {
  connected: boolean
  latency?: number
  strength?: 'excellent' | 'good' | 'fair' | 'poor'
} & Omit<StatusIndicatorProps, 'status'>) {
  const getStatus = () => {
    if (!connected) return 'offline'
    if (latency && latency > 500) return 'warning'
    if (strength === 'poor') return 'warning'
    return 'online'
  }
  
  const getDescription = () => {
    if (!connected) return 'No connection'
    const parts = []
    if (latency) parts.push(`${latency}ms`)
    if (strength) parts.push(strength)
    return parts.join(' • ')
  }
  
  return (
    <StatusIndicator
      status={getStatus()}
      description={getDescription()}
      icon={<SignalIcon />}
      {...props}
    />
  )
}

/**
 * HealthStatus - Status indicator for system health
 */
export function HealthStatus({
  health,
  services,
  ...props
}: {
  health: 'healthy' | 'degraded' | 'down'
  services?: Array<{
    name: string
    status: 'up' | 'down'
  }>
} & Omit<StatusIndicatorProps, 'status' | 'description'>) {
  const statusMap = {
    healthy: 'success' as const,
    degraded: 'warning' as const,
    down: 'error' as const,
  }
  
  const downServices = services?.filter(s => s.status === 'down') || []
  const description = downServices.length > 0
    ? `${downServices.length} service(s) down`
    : services
    ? `${services.length} services operational`
    : undefined
  
  return (
    <StatusIndicator
      status={statusMap[health]}
      description={description}
      {...props}
    />
  )
}

/**
 * ProgressStatus - Status indicator with progress
 */
export function ProgressStatus({
  progress,
  label = 'Progress',
  ...props
}: {
  progress: number
  label?: string
} & Omit<StatusIndicatorProps, 'status' | 'label'>) {
  const getStatus = () => {
    if (progress >= 100) return 'success'
    if (progress > 0) return 'loading'
    return 'offline'
  }
  
  return (
    <StatusIndicator
      status={getStatus()}
      label={`${label}: ${progress}%`}
      animated={progress > 0 && progress < 100}
      {...props}
    />
  )
}