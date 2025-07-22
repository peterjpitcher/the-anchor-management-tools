'use client'

/**
 * Drawer Component
 * 
 * Used on 35/107 pages (33%)
 * 
 * Slide-out panel with swipe support and multiple positions.
 * Ideal for mobile navigation, filters, and secondary content.
 */

import { Fragment, ReactNode, useEffect, useRef } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { cn } from '@/lib/utils'
import { XMarkIcon } from '@heroicons/react/24/outline'

export interface DrawerProps {
  /**
   * Whether the drawer is open
   */
  open: boolean
  
  /**
   * Callback when drawer should close
   */
  onClose: () => void
  
  /**
   * Position of the drawer
   * @default 'right'
   */
  position?: 'left' | 'right' | 'top' | 'bottom'
  
  /**
   * Size of the drawer
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  
  /**
   * Title for the drawer
   */
  title?: string
  
  /**
   * Description for the drawer
   */
  description?: string
  
  /**
   * Content of the drawer
   */
  children: ReactNode
  
  /**
   * Footer content
   */
  footer?: ReactNode
  
  /**
   * Whether to show close button
   * @default true
   */
  showCloseButton?: boolean
  
  /**
   * Whether clicking backdrop closes drawer
   * @default true
   */
  closeOnBackdrop?: boolean
  
  /**
   * Whether to show backdrop
   * @default true
   */
  showBackdrop?: boolean
  
  /**
   * Whether to enable swipe to close (mobile)
   * @default true
   */
  swipeToClose?: boolean
  
  /**
   * Custom classes for the drawer panel
   */
  className?: string
  
  /**
   * Custom classes for the overlay
   */
  overlayClassName?: string
  
  /**
   * Z-index for the drawer
   * @default 50
   */
  zIndex?: number
  
  /**
   * Whether to unmount on close
   * @default true
   */
  unmount?: boolean
  
  /**
   * Sticky header/footer
   * @default true
   */
  stickyHeaderFooter?: boolean
}

export function Drawer({
  open,
  onClose,
  position = 'right',
  size = 'md',
  title,
  description,
  children,
  footer,
  showCloseButton = true,
  closeOnBackdrop = true,
  showBackdrop = true,
  swipeToClose = true,
  className,
  overlayClassName,
  zIndex = 50,
  unmount = true,
  stickyHeaderFooter = true,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  
  // Size classes based on position
  const sizeClasses = {
    left: {
      sm: 'max-w-xs',
      md: 'max-w-md',
      lg: 'max-w-2xl',
      xl: 'max-w-4xl',
      full: 'max-w-full',
    },
    right: {
      sm: 'max-w-xs',
      md: 'max-w-md',
      lg: 'max-w-2xl',
      xl: 'max-w-4xl',
      full: 'max-w-full',
    },
    top: {
      sm: 'max-h-[25vh]',
      md: 'max-h-[50vh]',
      lg: 'max-h-[75vh]',
      xl: 'max-h-[90vh]',
      full: 'max-h-full',
    },
    bottom: {
      sm: 'max-h-[25vh]',
      md: 'max-h-[50vh]',
      lg: 'max-h-[75vh]',
      xl: 'max-h-[90vh]',
      full: 'max-h-full',
    },
  }
  
  // Position classes
  const positionClasses = {
    left: 'inset-y-0 left-0',
    right: 'inset-y-0 right-0',
    top: 'inset-x-0 top-0',
    bottom: 'inset-x-0 bottom-0',
  }
  
  // Animation classes
  const animationClasses = {
    left: {
      enter: '-translate-x-full',
      enterTo: 'translate-x-0',
    },
    right: {
      enter: 'translate-x-full',
      enterTo: 'translate-x-0',
    },
    top: {
      enter: '-translate-y-full',
      enterTo: 'translate-y-0',
    },
    bottom: {
      enter: 'translate-y-full',
      enterTo: 'translate-y-0',
    },
  }
  
  // Handle swipe gestures
  useEffect(() => {
    if (!swipeToClose || !open) return
    
    const panel = panelRef.current
    if (!panel) return
    
    const handleTouchStart = (e: TouchEvent) => {
      startXRef.current = e.touches[0].clientX
      startYRef.current = e.touches[0].clientY
    }
    
    const handleTouchEnd = (e: TouchEvent) => {
      if (startXRef.current === null || startYRef.current === null) return
      
      const endX = e.changedTouches[0].clientX
      const endY = e.changedTouches[0].clientY
      const deltaX = endX - startXRef.current
      const deltaY = endY - startYRef.current
      
      // Determine swipe direction and threshold
      const threshold = 75
      
      switch (position) {
        case 'left':
          if (deltaX < -threshold) onClose()
          break
        case 'right':
          if (deltaX > threshold) onClose()
          break
        case 'top':
          if (deltaY < -threshold) onClose()
          break
        case 'bottom':
          if (deltaY > threshold) onClose()
          break
      }
      
      startXRef.current = null
      startYRef.current = null
    }
    
    panel.addEventListener('touchstart', handleTouchStart)
    panel.addEventListener('touchend', handleTouchEnd)
    
    return () => {
      panel.removeEventListener('touchstart', handleTouchStart)
      panel.removeEventListener('touchend', handleTouchEnd)
    }
  }, [open, position, swipeToClose, onClose])
  
  // Panel classes
  const panelClasses = cn(
    'fixed bg-white shadow-xl flex flex-col',
    positionClasses[position],
    position === 'left' || position === 'right' 
      ? cn('h-full w-full', sizeClasses[position][size])
      : cn('w-full h-auto', sizeClasses[position][size]),
    'overflow-hidden',
    className
  )
  
  return (
    <Transition.Root show={open} as={Fragment} unmount={unmount}>
      <Dialog
        as="div"
        className="relative"
        style={{ zIndex }}
        onClose={closeOnBackdrop ? onClose : () => {}}
      >
        {/* Backdrop */}
        {showBackdrop && (
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className={cn(
              'fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity',
              overlayClassName
            )} />
          </Transition.Child>
        )}
        
        {/* Panel */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 overflow-hidden">
            <div className={cn(
              'pointer-events-none fixed flex',
              positionClasses[position],
              position === 'left' && 'justify-start',
              position === 'right' && 'justify-end',
              position === 'top' && 'items-start',
              position === 'bottom' && 'items-end'
            )}>
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-300"
                enterFrom={animationClasses[position].enter}
                enterTo={animationClasses[position].enterTo}
                leave="transform transition ease-in-out duration-300"
                leaveFrom={animationClasses[position].enterTo}
                leaveTo={animationClasses[position].enter}
              >
                <Dialog.Panel
                  ref={panelRef}
                  className={cn(panelClasses, 'pointer-events-auto')}
                >
                  {/* Header */}
                  {(title || showCloseButton) && (
                    <div className={cn(
                      'flex items-center justify-between px-4 py-6 sm:px-6',
                      stickyHeaderFooter && 'flex-shrink-0',
                      'border-b border-gray-200'
                    )}>
                      <div>
                        {title && (
                          <Dialog.Title className="text-lg font-semibold leading-6 text-gray-900">
                            {title}
                          </Dialog.Title>
                        )}
                        {description && (
                          <p className="mt-1 text-sm text-gray-500">
                            {description}
                          </p>
                        )}
                      </div>
                      {showCloseButton && (
                        <button
                          type="button"
                          className="rounded-full p-2 -m-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                          onClick={onClose}
                        >
                          <span className="sr-only">Close panel</span>
                          <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                  
                  {/* Content */}
                  <div className="relative flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                    {/* Swipe indicator for mobile */}
                    {swipeToClose && (
                      <div className={cn(
                        'absolute inset-x-0 flex justify-center',
                        position === 'top' && 'bottom-2',
                        position === 'bottom' && 'top-2',
                        position === 'left' && 'right-2 inset-y-0 items-center',
                        position === 'right' && 'left-2 inset-y-0 items-center'
                      )}>
                        <div className={cn(
                          'bg-gray-300 rounded-full',
                          position === 'left' || position === 'right' 
                            ? 'w-1 h-12'
                            : 'w-12 h-1'
                        )} />
                      </div>
                    )}
                    
                    {children}
                  </div>
                  
                  {/* Footer */}
                  {footer && (
                    <div className={cn(
                      'flex-shrink-0 bg-gray-50 px-4 py-4 sm:px-6',
                      'border-t border-gray-200'
                    )}>
                      {footer}
                    </div>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}

/**
 * DrawerActions - Consistent drawer footer actions
 */
export function DrawerActions({
  children,
  align = 'right',
  className,
}: {
  children: ReactNode
  align?: 'left' | 'center' | 'right' | 'between'
  className?: string
}) {
  const alignClasses = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
    between: 'justify-between',
  }
  
  return (
    <div className={cn(
      'flex flex-col-reverse sm:flex-row gap-3',
      alignClasses[align],
      className
    )}>
      {children}
    </div>
  )
}

/**
 * MobileDrawer - Mobile-optimized drawer
 */
export function MobileDrawer({
  position = 'bottom',
  size = 'md',
  handleIndicator = true,
  ...props
}: DrawerProps & {
  handleIndicator?: boolean
}) {
  return (
    <Drawer
      position={position}
      size={size}
      swipeToClose
      className={cn(
        position === 'bottom' && 'rounded-t-xl',
        position === 'top' && 'rounded-b-xl'
      )}
      {...props}
    >
      {handleIndicator && (position === 'bottom' || position === 'top') && (
        <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-gray-300 mb-4" />
      )}
      {props.children}
    </Drawer>
  )
}