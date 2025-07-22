'use client'

/**
 * Popover Component
 * 
 * Used on 28/107 pages (26%)
 * 
 * Provides floating content panels with smart positioning.
 * Used for contextual actions, menus, and form controls.
 */

import { ReactNode, cloneElement, isValidElement, useState } from 'react'
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
  Placement,
  FloatingFocusManager,
  useTransitionStyles,
} from '@floating-ui/react'
import { cn } from '@/lib/utils'

export interface PopoverProps {
  /**
   * Content to show in the popover
   */
  children: ReactNode
  
  /**
   * Element that triggers the popover
   */
  trigger: ReactNode
  
  /**
   * Whether the popover is open (controlled mode)
   */
  open?: boolean
  
  /**
   * Callback when open state changes (controlled mode)
   */
  onOpenChange?: (open: boolean) => void
  
  /**
   * Preferred placement of the popover
   * @default 'bottom'
   */
  placement?: Placement
  
  /**
   * Offset from the trigger element (px)
   * @default 8
   */
  offsetValue?: number
  
  /**
   * Whether to show arrow
   * @default false
   */
  showArrow?: boolean
  
  /**
   * Whether popover should match trigger width
   * @default false
   */
  matchTriggerWidth?: boolean
  
  /**
   * Whether to trap focus within popover
   * @default true
   */
  modal?: boolean
  
  /**
   * Z-index for the popover
   * @default 9999
   */
  zIndex?: number
  
  /**
   * Additional classes for the popover
   */
  className?: string
  
  /**
   * Custom width for the popover
   */
  width?: string | number
  
  /**
   * Disable popover
   * @default false
   */
  disabled?: boolean
}

export function Popover({
  children,
  trigger,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom',
  offsetValue = 8,
  showArrow = false,
  matchTriggerWidth = false,
  modal = true,
  zIndex = 9999,
  className,
  width,
  disabled = false,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  
  // Use controlled or uncontrolled state
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  
  // Don't render if disabled
  if (disabled) {
    return <>{trigger}</>
  }
  
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
    ],
  })
  
  // Transition styles
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 150,
    initial: {
      opacity: 0,
      transform: 'scale(0.95)',
    },
    open: {
      opacity: 1,
      transform: 'scale(1)',
    },
  })
  
  // Interactions
  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context)
  
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ])
  
  // Clone trigger element and attach props
  const triggerElement = isValidElement(trigger) ? (
    cloneElement(trigger as any, {
      ref: refs.setReference,
      ...getReferenceProps(),
    })
  ) : (
    <span
      ref={refs.setReference}
      {...getReferenceProps()}
      className="inline-block"
    >
      {trigger}
    </span>
  )
  
  // Calculate width
  const popoverWidth = width || (matchTriggerWidth && refs.reference.current
    ? refs.reference.current.getBoundingClientRect().width
    : undefined)
  
  return (
    <>
      {triggerElement}
      <FloatingPortal>
        {isMounted && (
          <FloatingFocusManager
            context={context}
            modal={modal}
            initialFocus={-1}
          >
            <div
              ref={refs.setFloating}
              style={{
                ...floatingStyles,
                ...transitionStyles,
                zIndex,
                width: popoverWidth,
              }}
              className={cn(
                'bg-white rounded-lg shadow-lg border border-gray-200',
                'focus:outline-none',
                className
              )}
              {...getFloatingProps()}
            >
              {children}
            </div>
          </FloatingFocusManager>
        )}
      </FloatingPortal>
    </>
  )
}

/**
 * PopoverTrigger - Explicit trigger component
 */
export function PopoverTrigger({
  children,
  asChild = false,
  ...props
}: {
  children: ReactNode
  asChild?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  if (asChild && isValidElement(children)) {
    return children
  }
  
  return (
    <button type="button" {...props}>
      {children}
    </button>
  )
}

/**
 * PopoverContent - Content wrapper with common styles
 */
export function PopoverContent({
  children,
  className,
  ...props
}: {
  children: ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('p-4', className)}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * PopoverHeader - Header section for popover
 */
export function PopoverHeader({
  children,
  className,
  ...props
}: {
  children: ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'px-4 py-3 border-b border-gray-200',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * PopoverFooter - Footer section for popover
 */
export function PopoverFooter({
  children,
  className,
  ...props
}: {
  children: ReactNode
  className?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'px-4 py-3 border-t border-gray-200 bg-gray-50',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * PopoverMenu - Menu-style popover
 */
export function PopoverMenu({
  items,
  trigger,
  onItemClick,
  className,
  ...props
}: {
  items: Array<{
    key: string
    label: string
    icon?: ReactNode
    disabled?: boolean
    danger?: boolean
  }>
  trigger: ReactNode
  onItemClick?: (key: string) => void
} & Omit<PopoverProps, 'children'>) {
  const [open, setOpen] = useState(false)
  
  const handleItemClick = (key: string) => {
    onItemClick?.(key)
    setOpen(false)
  }
  
  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      className={cn('p-1', className)}
      {...props}
    >
      <div className="min-w-[180px]">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => !item.disabled && handleItemClick(item.key)}
            disabled={item.disabled}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md',
              'hover:bg-gray-100 focus:bg-gray-100 focus:outline-none',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              item.danger && 'text-red-600 hover:bg-red-50 focus:bg-red-50'
            )}
          >
            {item.icon && (
              <span className="flex-shrink-0 h-5 w-5">
                {item.icon}
              </span>
            )}
            <span className="flex-1 text-left">
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </Popover>
  )
}