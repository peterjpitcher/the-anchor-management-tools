'use client'

/**
 * Tooltip Component
 * 
 * Used on 85/107 pages (79%)
 * 
 * Provides contextual information on hover/focus with smart positioning.
 * Supports touch devices with long-press and keyboard accessibility.
 */

import { ReactNode, cloneElement, isValidElement, useState, useRef } from 'react'
import { 
  useFloating, 
  autoUpdate,
  offset,
  flip,
  shift,
  arrow,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  FloatingArrow,
  Placement
} from '@floating-ui/react'
import { cn } from '@/lib/utils'

export interface TooltipProps {
  /**
   * Content to show in the tooltip
   */
  content: ReactNode
  
  /**
   * Element that triggers the tooltip
   */
  children: ReactNode
  
  /**
   * Preferred placement of the tooltip
   * @default 'top'
   */
  placement?: Placement
  
  /**
   * Delay before showing tooltip (ms)
   * @default 600
   */
  delay?: number
  
  /**
   * Whether the tooltip is disabled
   * @default false
   */
  disabled?: boolean
  
  /**
   * Offset from the trigger element (px)
   * @default 8
   */
  offsetValue?: number
  
  /**
   * Whether to show arrow
   * @default true
   */
  showArrow?: boolean
  
  /**
   * Maximum width of tooltip
   * @default 250
   */
  maxWidth?: number
  
  /**
   * Z-index for the tooltip
   * @default 9999
   */
  zIndex?: number
  
  /**
   * Additional classes for the tooltip
   */
  className?: string
  
  /**
   * Whether to show on touch devices
   * @default true
   */
  showOnTouch?: boolean
  
  /**
   * Custom open state (controlled mode)
   */
  open?: boolean
  
  /**
   * Callback when open state changes (controlled mode)
   */
  onOpenChange?: (open: boolean) => void
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 600,
  disabled = false,
  offsetValue = 8,
  showArrow = true,
  maxWidth = 250,
  zIndex = 9999,
  className,
  showOnTouch = true,
  open: controlledOpen,
  onOpenChange,
}: TooltipProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const arrowRef = useRef<SVGSVGElement>(null)
  
  // Use controlled or uncontrolled state
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  
  // Floating UI setup
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(offsetValue),
      flip({
        fallbackAxisSideDirection: 'start',
      }),
      shift({ padding: 8 }),
      arrow({
        element: arrowRef,
      }),
    ],
  })
  
  // Interactions
  const hover = useHover(context, {
    move: false,
    delay: {
      open: delay,
      close: 0,
    },
  })
  
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ])

  if (!content || disabled) {
    return <>{children}</>
  }
  
  // Handle touch devices
  const handleLongPress = () => {
    if (showOnTouch) {
      setOpen(true)
      // Auto-dismiss after 3 seconds on touch
      setTimeout(() => setOpen(false), 3000)
    }
  }
  
  // Clone child element and attach props
  const child = isValidElement(children) ? (
    cloneElement(children as any, {
      ref: refs.setReference,
      ...getReferenceProps({
        onTouchStart: () => {
          if (showOnTouch) {
            const timer = setTimeout(handleLongPress, 500)
            const cleanup = () => clearTimeout(timer)
            document.addEventListener('touchend', cleanup, { once: true })
            document.addEventListener('touchmove', cleanup, { once: true })
          }
        },
      }),
    })
  ) : (
    <span
      ref={refs.setReference}
      {...getReferenceProps({
        onTouchStart: () => {
          if (showOnTouch) {
            const timer = setTimeout(handleLongPress, 500)
            const cleanup = () => clearTimeout(timer)
            document.addEventListener('touchend', cleanup, { once: true })
            document.addEventListener('touchmove', cleanup, { once: true })
          }
        },
      })}
    >
      {children}
    </span>
  )
  
  return (
    <>
      {child}
      <FloatingPortal>
        {open && (
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              zIndex,
              maxWidth,
            }}
            className={cn(
              'px-3 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg shadow-lg',
              'animate-in fade-in-0 zoom-in-95 duration-100',
              className
            )}
            {...getFloatingProps()}
          >
            {content}
            {showArrow && (
              <FloatingArrow
                ref={arrowRef as any}
                context={context}
                className="fill-gray-900"
                width={12}
                height={6}
              />
            )}
          </div>
        )}
      </FloatingPortal>
    </>
  )
}

/**
 * TooltipProvider - Provides shared configuration for tooltips
 */
export function TooltipProvider({
  children,
  delay = 600,
  showOnTouch = true,
}: {
  children: ReactNode
  delay?: number
  showOnTouch?: boolean
}) {
  // In a real implementation, this would use React Context
  // For now, just pass through children
  return <>{children}</>
}

/**
 * IconTooltip - Common pattern for icon buttons with tooltips
 */
export function IconTooltip({
  content,
  icon,
  onClick,
  className,
  buttonClassName,
  'aria-label': ariaLabel,
  ...tooltipProps
}: {
  icon: ReactNode
  onClick?: () => void
  buttonClassName?: string
  'aria-label'?: string
} & TooltipProps) {
  return (
    <Tooltip content={content} {...tooltipProps}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'p-2 rounded-full text-gray-400 hover:text-gray-500',
          'hover:bg-gray-100 focus:bg-gray-100',
          'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2',
          'transition-colors',
          buttonClassName
        )}
        aria-label={ariaLabel || (typeof content === 'string' ? content : undefined)}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

/**
 * HelpTooltip - Common pattern for help icons
 */
export function HelpTooltip({
  content,
  className,
  size = 'sm',
  ...props
}: {
  size?: 'sm' | 'md' | 'lg'
} & Omit<TooltipProps, 'children'>) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5', 
    lg: 'h-6 w-6',
  }
  
  return (
    <Tooltip content={content} {...props}>
      <span className={cn('inline-flex items-center', className)}>
        <svg
          className={cn(sizeClasses[size], 'text-gray-400')}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
          />
        </svg>
        <span className="sr-only">Help</span>
      </span>
    </Tooltip>
  )
}

/**
 * TruncateTooltip - Shows full text in tooltip when truncated
 */
export function TruncateTooltip({
  text,
  maxLength = 20,
  className,
  ...props
}: {
  text: string
  maxLength?: number
} & Omit<TooltipProps, 'content' | 'children'>) {
  const needsTruncation = text.length > maxLength
  const truncatedText = needsTruncation 
    ? `${text.slice(0, maxLength)}...`
    : text
  
  if (!needsTruncation) {
    return <span className={className}>{text}</span>
  }
  
  return (
    <Tooltip content={text} {...props}>
      <span className={cn('truncate', className)}>
        {truncatedText}
      </span>
    </Tooltip>
  )
}
